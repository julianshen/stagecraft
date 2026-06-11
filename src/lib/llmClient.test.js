import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callLLM, generateSlide, rewriteText, suggestImprovements, editSlide, suggestSlideOrder, LLMError, describeLLMError } from './llmClient.js';
import { stubLocalStorage } from '../test/localStorage.js';

function res(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

stubLocalStorage();

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('callLLM', () => {
  it('posts to /api/llm and returns text from the proxy shape', async () => {
    fetchMock.mockResolvedValue(res({ text: 'hello' }));
    const out = await callLLM([{ role: 'user', content: 'hi' }]);
    expect(out).toBe('hello');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/llm');
    expect(JSON.parse(opts.body)).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4' });
  });

  it('uses settings from localStorage', async () => {
    localStorage.setItem('stagecraft.ai', JSON.stringify({ provider: 'openai', model: 'gpt-4o', apiKey: 'k', maxTokens: 100, temperature: 0.2 }));
    fetchMock.mockResolvedValue(res({ text: 'x' }));
    await callLLM([]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ provider: 'openai', model: 'gpt-4o', apiKey: 'k', maxTokens: 100, temperature: 0.2 });
  });

  it('lets explicit options override settings', async () => {
    localStorage.setItem('stagecraft.ai', JSON.stringify({ provider: 'openai', model: 'gpt-4o' }));
    fetchMock.mockResolvedValue(res({ text: 'x' }));
    await callLLM([], { provider: 'google', model: 'gemini', maxTokens: 7, temperature: 0 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ provider: 'google', model: 'gemini', maxTokens: 7, temperature: 0 });
  });

  it('tolerates corrupt settings JSON (falls back to defaults)', async () => {
    localStorage.setItem('stagecraft.ai', 'not json{');
    fetchMock.mockResolvedValue(res({ text: 'ok' }));
    expect(await callLLM([])).toBe('ok');
  });

  it('normalizes the Anthropic response shape', async () => {
    fetchMock.mockResolvedValue(res({ content: [{ text: 'a' }, { text: 'b' }] }));
    expect(await callLLM([])).toBe('ab');
  });

  it('normalizes the OpenAI response shape', async () => {
    fetchMock.mockResolvedValue(res({ choices: [{ message: { content: 'gpt says hi' } }] }));
    expect(await callLLM([])).toBe('gpt says hi');
  });

  it('falls back to data.message when no known shape', async () => {
    fetchMock.mockResolvedValue(res({ message: 'fallback' }));
    expect(await callLLM([])).toBe('fallback');
  });

  it('handles an Anthropic content block missing its text field', async () => {
    fetchMock.mockResolvedValue(res({ content: [{}, { text: 'b' }] }));
    expect(await callLLM([])).toBe('b');
  });

  it('handles OpenAI choices with an empty message', async () => {
    fetchMock.mockResolvedValue(res({ choices: [{ message: {} }] }));
    expect(await callLLM([])).toBe('');
  });

  it('throws on a non-ok response', async () => {
    fetchMock.mockResolvedValue(res('boom', { ok: false, status: 502 }));
    await expect(callLLM([])).rejects.toThrow(/502/);
  });

  it('classifies the proxy "unconfigured" reason', async () => {
    fetchMock.mockResolvedValue(res({ error: 'No API key configured', reason: 'unconfigured' }, { ok: false, status: 401 }));
    const err = await callLLM([]).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.reason).toBe('unconfigured');
    expect(err.message).toBe('No API key configured');
  });

  it('adopts the proxy-classified reason from the error body (auth)', async () => {
    fetchMock.mockResolvedValue(res({ error: 'invalid x-api-key', reason: 'auth' }, { ok: false, status: 401 }));
    const err = await callLLM([]).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.reason).toBe('auth');
    expect(err.message).toBe('invalid x-api-key');
  });

  it('adopts the proxy-classified rate-limit reason', async () => {
    fetchMock.mockResolvedValue(res({ error: 'slow down', reason: 'rate-limit' }, { ok: false, status: 429 }));
    const err = await callLLM([]).catch((e) => e);
    expect(err.reason).toBe('rate-limit');
  });

  it('falls back to provider when the error body carries no reason', async () => {
    fetchMock.mockResolvedValue(res({ error: 'overloaded' }, { ok: false, status: 502 }));
    const err = await callLLM([]).catch((e) => e);
    expect(err.reason).toBe('provider');
    expect(err.message).toBe('overloaded');
  });

  it('classifies a fetch rejection as network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await callLLM([]).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.reason).toBe('network');
  });

  it('does not throw on a 200 whose body is literal null or not JSON', async () => {
    fetchMock.mockResolvedValue(res(null));
    await expect(callLLM([])).resolves.toBeTypeOf('string');
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
    await expect(callLLM([])).resolves.toBeTypeOf('string');
  });

  it('classifies a non-proxy error response (non-JSON body) as network', async () => {
    // The /api/* middleware only exists under `npm run dev` — a static server
    // answers /api/llm with an HTML 404. That's "couldn't reach the backend",
    // not a provider failure.
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => { throw new Error('not json'); } });
    const err = await callLLM([]).catch((e) => e);
    expect(err.reason).toBe('network');
    expect(err.message).toMatch(/404/);
  });

  it('forwards a configured baseUrl to the proxy (keyless local servers)', async () => {
    localStorage.setItem('stagecraft.ai', JSON.stringify({ provider: 'local', baseUrl: 'http://localhost:11434/v1' }));
    fetchMock.mockResolvedValue(res({ text: 'ok' }));
    await callLLM([]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).baseUrl).toBe('http://localhost:11434/v1');
  });

  it('omits baseUrl from the body when none is configured', async () => {
    fetchMock.mockResolvedValue(res({ text: 'ok' }));
    await callLLM([]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('baseUrl');
  });

  it('forwards system prompt in the request body', async () => {
    fetchMock.mockResolvedValue(res({ text: 'ok' }));
    await callLLM([], { system: 'You are a helpful assistant.' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toBe('You are a helpful assistant.');
  });

  it('forwards empty-string system prompt in the request body', async () => {
    fetchMock.mockResolvedValue(res({ text: 'ok' }));
    await callLLM([], { system: '' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toHaveProperty('system', '');
  });

  it('omits system from the body when undefined', async () => {
    fetchMock.mockResolvedValue(res({ text: 'ok' }));
    await callLLM([]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('system');
  });

  it('falls back to data.text when response has no content or choices', async () => {
    fetchMock.mockResolvedValue(res({ text: 'plain text' }));
    expect(await callLLM([])).toBe('plain text');
  });

  it('falls back to stringifying the entire response when no known shape', async () => {
    fetchMock.mockResolvedValue(res('just a string'));
    // The string 'just a string' is valid JSON but not an object with .text or .message
    // callLLM will parse it, and the final fallback returns String(data || '')
    expect(await callLLM([])).toBe('just a string');
  });
});

describe('generateSlide', () => {
  it('parses a JSON slide object from the reply', async () => {
    fetchMock.mockResolvedValue(res({ text: '{"id":"x","layout":"kpi","title":"Q"}' }));
    expect(await generateSlide('a kpi slide')).toMatchObject({ layout: 'kpi', title: 'Q' });
  });

  it('strips ```json code fences before parsing', async () => {
    fetchMock.mockResolvedValue(res({ text: '```json\n{"layout":"text","title":"T"}\n```' }));
    expect(await generateSlide('x')).toMatchObject({ layout: 'text', title: 'T' });
  });

  it('falls back to a text slide when the reply is not JSON', async () => {
    fetchMock.mockResolvedValue(res({ text: 'just prose, not json' }));
    const slide = await generateSlide('summary');
    expect(slide).toMatchObject({ layout: 'text', title: 'summary', body: 'just prose, not json' });
    expect(slide.id).toMatch(/^ai-/);
  });

  it('falls back to a text slide when the reply is valid JSON but not an object', async () => {
    fetchMock.mockResolvedValue(res({ text: '[1, 2, 3]' }));
    const slide = await generateSlide('summary');
    expect(slide).toMatchObject({ layout: 'text', title: 'summary' });
    expect(slide.id).toMatch(/^ai-/);
  });
});

describe('rewriteText & suggestImprovements', () => {
  it('rewriteText returns the model text', async () => {
    fetchMock.mockResolvedValue(res({ text: 'crisper copy' }));
    expect(await rewriteText('wordy copy', 'make it crisp')).toBe('crisper copy');
  });

  it('suggestImprovements returns the model text', async () => {
    fetchMock.mockResolvedValue(res({ text: '1. do x\n2. do y' }));
    expect(await suggestImprovements({ layout: 'kpi' })).toMatch(/do x/);
  });
});

describe('editSlide', () => {
  it('returns a parsed patch from the model reply', async () => {
    fetchMock.mockResolvedValue(res({ text: '{"title":"New title","body":"New body"}' }));
    const patch = await editSlide({ id: 'a', layout: 'text', title: 'Old' }, 'make it punchier');
    expect(patch).toEqual({ title: 'New title', body: 'New body' });
  });

  it('strips markdown code fences', async () => {
    fetchMock.mockResolvedValue(res({ text: '```json\n{"layout":"list","items":["x"]}\n```' }));
    expect(await editSlide({ id: 'a' }, 'as a list')).toEqual({ layout: 'list', items: ['x'] });
  });

  it('parses a reply with leading whitespace before the code fence', async () => {
    fetchMock.mockResolvedValue(res({ text: '\n\n```json\n{"title":"X"}\n```' }));
    expect(await editSlide({ id: 'a' }, 'x')).toEqual({ title: 'X' });
  });

  it('never returns an id in the patch', async () => {
    fetchMock.mockResolvedValue(res({ text: '{"id":"evil","title":"T"}' }));
    const patch = await editSlide({ id: 'a' }, 'x');
    expect(patch).not.toHaveProperty('id');
    expect(patch.title).toBe('T');
  });

  it('returns null when the reply is not valid JSON', async () => {
    fetchMock.mockResolvedValue(res({ text: 'Sure! I changed the title for you.' }));
    expect(await editSlide({ id: 'a' }, 'x')).toBeNull();
  });

  it('sends the current slide and instruction to the model', async () => {
    fetchMock.mockResolvedValue(res({ text: '{}' }));
    await editSlide({ id: 'a', layout: 'text', title: 'Hi' }, 'shorten');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('shorten');
    expect(body.messages[0].content).toContain('"title":"Hi"');
    expect(body.system).toMatch(/patch/i);
  });
});

describe('editSlide non-object replies', () => {
  it('returns null when the reply is valid JSON but not an object', async () => {
    fetchMock.mockResolvedValue(res({ text: '[1, 2, 3]' }));
    expect(await editSlide({ id: 'a' }, 'x')).toBeNull();
  });
});

describe('suggestSlideOrder', () => {
  const deck = {
    title: 'D',
    sections: [
      { id: 's1', name: 'Intro', slides: ['a', 'b'] },
      { id: 's2', name: 'End', slides: ['c'] },
    ],
    slides: [
      { id: 'a', layout: 'cover', title: 'Welcome' },
      { id: 'b', layout: 'text', title: 'Context' },
      { id: 'c', layout: 'thanks', title: 'Bye' },
    ],
  };

  it('sends the deck outline (ids + titles) and returns the proposed id array', async () => {
    fetchMock.mockResolvedValue(res({ text: '["b","a","c"]' }));
    expect(await suggestSlideOrder(deck)).toEqual(['b', 'a', 'c']);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('"a"');
    expect(body.messages[0].content).toContain('Welcome');
    expect(body.system).toMatch(/order/i);
  });

  it('strips markdown code fences around the array', async () => {
    fetchMock.mockResolvedValue(res({ text: '```json\n["c","b","a"]\n```' }));
    expect(await suggestSlideOrder(deck)).toEqual(['c', 'b', 'a']);
  });

  it('keeps only string entries from a mixed reply', async () => {
    fetchMock.mockResolvedValue(res({ text: '["a", 2, null, "b"]' }));
    expect(await suggestSlideOrder(deck)).toEqual(['a', 'b']);
  });

  it('returns null for a non-array or unparseable reply', async () => {
    fetchMock.mockResolvedValue(res({ text: '{"order":["a"]}' }));
    expect(await suggestSlideOrder(deck)).toBeNull();
    fetchMock.mockResolvedValue(res({ text: 'Sure! Here is a better order: a, b, c' }));
    expect(await suggestSlideOrder(deck)).toBeNull();
  });

  it('returns null when the reply is an array with no usable ids', async () => {
    fetchMock.mockResolvedValue(res({ text: '[1, 2]' }));
    expect(await suggestSlideOrder(deck)).toBeNull();
  });
});

describe('describeLLMError', () => {
  it.each([
    ['unconfigured', /add one in Settings/i],
    ['auth', /rejected your API key/i],
    ['rate-limit', /rate.limiting/i],
    ['network', /reach the Stagecraft server/i],
    ['provider', /provider returned an error/i],
  ])('maps reason %s to an actionable message', (reason, pattern) => {
    expect(describeLLMError(new LLMError(reason, 'raw detail'))).toMatch(pattern);
  });

  it('falls back to a generic message for a plain Error, an unknown reason, and undefined', () => {
    expect(describeLLMError(new Error('boom'))).toMatch(/try again/i);
    expect(describeLLMError(new LLMError('mystery', 'x'))).toMatch(/try again/i);
    expect(describeLLMError(undefined)).toMatch(/try again/i);
  });

  it('surfaces the provider detail for provider failures (deterministic 4xxs are actionable)', () => {
    const msg = describeLLMError(new LLMError('provider', 'model claude-haiku-3.5 not found'));
    expect(msg).toMatch(/model claude-haiku-3.5 not found/);
    // and still falls back to canned copy when there is no detail
    expect(describeLLMError(new LLMError('provider', ''))).toMatch(/provider returned an error/i);
  });
});
