import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callLLM, generateSlide, rewriteText, suggestImprovements } from './llmClient.js';

function res(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

// Minimal localStorage mock — jsdom in vitest doesn't expose localStorage
// unless --localstorage-file is set; stub it ourselves.
const store = new Map();
const localStorageMock = {
  getItem:    (k) => store.has(k) ? store.get(k) : null,
  setItem:    (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear:      () => store.clear(),
};

let fetchMock;
beforeEach(() => {
  store.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', localStorageMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
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

  it('forwards system prompt in the request body', async () => {
    fetchMock.mockResolvedValue(res({ text: 'ok' }));
    await callLLM([], { system: 'You are a helpful assistant.' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toBe('You are a helpful assistant.');
  });

  it('omits system from the body when not provided', async () => {
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
