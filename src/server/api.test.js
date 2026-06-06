import { describe, it, expect, vi } from 'vitest';
import { createDeckStore, handleApiRequest, MCP_MANIFEST } from './api.js';

function deck() {
  return {
    id: 'd1',
    title: 'Demo',
    theme: 'indigo',
    sections: [
      { id: 's1', name: 'Intro', slides: ['a'] },
      { id: 's2', name: 'Body', slides: ['b', 'c'] },
    ],
    slides: [
      { id: 'a', layout: 'cover', title: 'A' },
      { id: 'b', layout: 'text', title: 'B' },
      { id: 'c', layout: 'text', title: 'C' },
    ],
  };
}

const req = (method, url, body = null) => ({ method, url, body });

describe('routing basics', () => {
  it('health responds', async () => {
    const r = await handleApiRequest(createDeckStore(), req('GET', '/api/health'));
    expect(r).toEqual({ status: 200, body: { ok: true, version: '1.0.0' } });
  });

  it('returns null for unhandled routes (falls through to next)', async () => {
    expect(await handleApiRequest(createDeckStore(), req('GET', '/api/nope'))).toBeNull();
    // known path, wrong method
    expect(await handleApiRequest(createDeckStore(), req('PATCH', '/api/deck'))).toBeNull();
  });

  it('ignores the query string when matching', async () => {
    const r = await handleApiRequest(createDeckStore(), req('GET', '/api/health?cb=1'));
    expect(r.status).toBe(200);
  });

  it('serves the MCP manifest with all six tools', async () => {
    const r = await handleApiRequest(createDeckStore(), req('GET', '/api/mcp'));
    expect(r.body).toBe(MCP_MANIFEST);
    expect(r.body.tools.map((t) => t.name)).toEqual([
      'get_deck', 'add_slide', 'update_slide', 'delete_slide', 'reorder_slides', 'set_theme',
    ]);
  });
});

describe('deck REST', () => {
  it('GET /api/deck returns {} when empty, deck once set', async () => {
    const store = createDeckStore();
    expect((await handleApiRequest(store, req('GET', '/api/deck'))).body).toEqual({});
    await handleApiRequest(store, req('PUT', '/api/deck', deck()));
    expect((await handleApiRequest(store, req('GET', '/api/deck'))).body.title).toBe('Demo');
  });
});

describe('slides REST', () => {
  it('GET /api/slides is [] without a deck', async () => {
    const r = await handleApiRequest(createDeckStore(), req('GET', '/api/slides'));
    expect(r.body).toEqual([]);
  });

  it('POST without a deck → 400', async () => {
    const r = await handleApiRequest(createDeckStore(), req('POST', '/api/slides', { title: 'X' }));
    expect(r).toEqual({ status: 400, body: { error: 'No deck loaded' } });
  });

  it('GET /api/slides returns the pool when a deck is loaded', async () => {
    const store = createDeckStore(deck());
    const r = await handleApiRequest(store, req('GET', '/api/slides'));
    expect(r.body.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('POST appends a slide and registers it in the last section', async () => {
    const store = createDeckStore(deck());
    const r = await handleApiRequest(store, req('POST', '/api/slides', { layout: 'kpi', title: 'New' }));
    expect(r.body.layout).toBe('kpi');
    expect(store.deck.slides).toHaveLength(4);
    expect(store.deck.sections[1].slides).toContain(r.body.id);
  });

  it('PUT/DELETE on a missing deck → 400', async () => {
    expect((await handleApiRequest(createDeckStore(), req('PUT', '/api/slides/a', { title: 'Z' }))).status).toBe(400);
    expect((await handleApiRequest(createDeckStore(), req('DELETE', '/api/slides/a'))).status).toBe(400);
  });

  it('PUT merges updates; unknown id → 404', async () => {
    const store = createDeckStore(deck());
    const r = await handleApiRequest(store, req('PUT', '/api/slides/b', { title: 'B2' }));
    expect(r.body.title).toBe('B2');
    expect(store.deck.slides.find((s) => s.id === 'b').title).toBe('B2');
    expect((await handleApiRequest(store, req('PUT', '/api/slides/zzz', {}))).status).toBe(404);
  });

  it('DELETE removes the slide from pool and sections', async () => {
    const store = createDeckStore(deck());
    const r = await handleApiRequest(store, req('DELETE', '/api/slides/b'));
    expect(r.body).toEqual({ ok: true });
    expect(store.deck.slides.map((s) => s.id)).toEqual(['a', 'c']);
    expect(store.deck.sections[1].slides).toEqual(['c']);
  });
});

describe('export trigger', () => {
  it('acknowledges POST /api/export/pptx', async () => {
    const r = await handleApiRequest(createDeckStore(), req('POST', '/api/export/pptx'));
    expect(r.body.ok).toBe(true);
  });
});

describe('MCP tools/call', () => {
  it('get_deck returns the current deck', async () => {
    const store = createDeckStore(deck());
    const r = await handleApiRequest(store, req('POST', '/api/mcp/tools/call', { name: 'get_deck' }));
    expect(r.body.result.title).toBe('Demo');
  });

  it('add_slide appends with defaults and merges args', async () => {
    const store = createDeckStore(deck());
    const r = await handleApiRequest(store, req('POST', '/api/mcp/tools/call', { name: 'add_slide', arguments: { title: 'T' } }));
    expect(r.body.result).toMatchObject({ layout: 'text', title: 'T' });
    expect(store.deck.sections[1].slides).toContain(r.body.result.id);
  });

  it('update_slide merges; missing id → 404', async () => {
    const store = createDeckStore(deck());
    const ok = await handleApiRequest(store, req('POST', '/api/mcp/tools/call', { name: 'update_slide', arguments: { id: 'a', updates: { title: 'A2' } } }));
    expect(ok.body.result.title).toBe('A2');
    const miss = await handleApiRequest(store, req('POST', '/api/mcp/tools/call', { name: 'update_slide', arguments: { id: 'x', updates: {} } }));
    expect(miss.status).toBe(404);
  });

  it('delete_slide and reorder_slides mutate order', async () => {
    const store = createDeckStore(deck());
    await handleApiRequest(store, req('POST', '/api/mcp/tools/call', { name: 'delete_slide', arguments: { id: 'a' } }));
    expect(store.deck.slides.map((s) => s.id)).toEqual(['b', 'c']);
    await handleApiRequest(store, req('POST', '/api/mcp/tools/call', { name: 'reorder_slides', arguments: { order: ['c', 'b'] } }));
    expect(store.deck.slides.map((s) => s.id)).toEqual(['c', 'b']);
  });

  it('reorder_slides updates section slide order to match global order', async () => {
    const store = createDeckStore(deck());
    // deck has sections: s1=[a], s2=[b,c]; reorder to [c,b,a]
    await handleApiRequest(store, req('POST', '/api/mcp/tools/call', { name: 'reorder_slides', arguments: { order: ['c', 'b', 'a'] } }));
    expect(store.deck.slides.map((s) => s.id)).toEqual(['c', 'b', 'a']);
    // sections should remain intact (s1 still has 'a', s2 still has 'b','c')
    // but their internal order should match the global order
    expect(store.deck.sections[0].slides).toEqual(['a']);
    expect(store.deck.sections[1].slides).toEqual(['c', 'b']);
  });

  it('reorder_slides omits slide IDs not in the order (drops them)', async () => {
    const store = createDeckStore(deck());
    // Reorder with only [b] — slides a and c should be dropped from pool
    await handleApiRequest(store, req('POST', '/api/mcp/tools/call', { name: 'reorder_slides', arguments: { order: ['b'] } }));
    expect(store.deck.slides.map((s) => s.id)).toEqual(['b']);
    // sections should no longer reference the removed slides
    expect(store.deck.sections[0].slides).toEqual([]);
    expect(store.deck.sections[1].slides).toEqual(['b']);
  });

  it('set_theme updates the deck theme', async () => {
    const store = createDeckStore(deck());
    await handleApiRequest(store, req('POST', '/api/mcp/tools/call', { name: 'set_theme', arguments: { theme: 'emerald' } }));
    expect(store.deck.theme).toBe('emerald');
  });

  it('tools require a loaded deck → 400', async () => {
    const r = await handleApiRequest(createDeckStore(), req('POST', '/api/mcp/tools/call', { name: 'add_slide', arguments: {} }));
    expect(r).toEqual({ status: 400, body: { error: 'No deck loaded' } });
  });

  it('unknown tool → 400', async () => {
    const store = createDeckStore(deck());
    const r = await handleApiRequest(store, req('POST', '/api/mcp/tools/call', { name: 'frobnicate' }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Unknown tool/);
  });

  it('add_slide pushes to pool only when sections is empty', async () => {
    const d = { ...deck(), sections: [] };
    const store = createDeckStore(d);
    const r = await handleApiRequest(store, req('POST', '/api/mcp/tools/call', { name: 'add_slide', arguments: { title: 'Orphan' } }));
    expect(r.body.result.title).toBe('Orphan');
    // Slide added to pool but not to any section (sections is empty)
    expect(store.deck.slides).toHaveLength(4);
    expect(store.deck.sections).toHaveLength(0);
  });

  it('DELETE slide with null sections', async () => {
    const d = { ...deck(), sections: null };
    const store = createDeckStore(d);
    const r = await handleApiRequest(store, req('DELETE', '/api/slides/b'));
    expect(r.body).toEqual({ ok: true });
    // Should not throw even when sections is null
    expect(store.deck.slides.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('MCP tool call with null body falls back to empty args', async () => {
    const store = createDeckStore(deck());
    // body is null → arguments is undefined → args defaults to {}
    const r = await handleApiRequest(store, req('POST', '/api/mcp/tools/call', null));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Unknown tool/);
  });
});

describe('LLM proxy', () => {
  it('routes anthropic and extracts content text', async () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => ({ content: [{ text: 'hi from claude' }] }) });
    const r = await handleApiRequest(createDeckStore(), req('POST', '/api/llm', { provider: 'anthropic', apiKey: 'k', messages: [] }), { fetch });
    expect(fetch.mock.calls[0][0]).toContain('api.anthropic.com');
    expect(r.body).toEqual({ text: 'hi from claude' });
  });

  it('defaults to anthropic when provider is omitted', async () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => ({ content: [{ text: 'x' }] }) });
    await handleApiRequest(createDeckStore(), req('POST', '/api/llm', { messages: [] }), { fetch });
    expect(fetch.mock.calls[0][0]).toContain('anthropic');
  });

  it('routes OpenAI-compatible providers and honors baseUrl', async () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => ({ choices: [{ message: { content: 'hi from gpt' } }] }) });
    const r = await handleApiRequest(createDeckStore(), req('POST', '/api/llm', { provider: 'openai', baseUrl: 'http://local:1234/v1', messages: [] }), { fetch });
    expect(fetch.mock.calls[0][0]).toBe('http://local:1234/v1/chat/completions');
    expect(r.body).toEqual({ text: 'hi from gpt' });
  });

  it('forwards explicit model / maxTokens / temperature to anthropic', async () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => ({ content: [{ text: 'x' }] }) });
    await handleApiRequest(createDeckStore(), req('POST', '/api/llm', { provider: 'anthropic', model: 'claude-opus-4', maxTokens: 512, temperature: 0.1, apiKey: 'k', messages: [] }), { fetch });
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent).toMatchObject({ model: 'claude-opus-4', max_tokens: 512, temperature: 0.1 });
  });

  it('forwards explicit model / maxTokens / temperature to openai-compatible', async () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
    await handleApiRequest(createDeckStore(), req('POST', '/api/llm', { provider: 'openai', model: 'gpt-4.1', maxTokens: 256, temperature: 0.9, apiKey: 'k', messages: [] }), { fetch });
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent).toMatchObject({ model: 'gpt-4.1', max_tokens: 256, temperature: 0.9 });
  });

  it('uses globalThis.fetch when no fetch dependency is injected', async () => {
    const g = vi.fn().mockResolvedValue({ json: async () => ({ content: [{ text: 'global' }] }) });
    vi.stubGlobal('fetch', g);
    const r = await handleApiRequest(createDeckStore(), req('POST', '/api/llm', { provider: 'anthropic', messages: [] }));
    expect(g).toHaveBeenCalled();
    expect(r.body).toEqual({ text: 'global' });
    vi.unstubAllGlobals();
  });

  it('surfaces provider error messages from the body', async () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => ({ error: { message: 'bad key' } }) });
    const r = await handleApiRequest(createDeckStore(), req('POST', '/api/llm', { provider: 'anthropic' }), { fetch });
    expect(r.body.text).toBe('bad key');
  });

  it('returns 500 when the upstream call throws', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const r = await handleApiRequest(createDeckStore(), req('POST', '/api/llm', { provider: 'anthropic' }), { fetch });
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('network down');
  });

  it('returns 500 with stringified error when thrown value has no message', async () => {
    const fetch = vi.fn().mockRejectedValue('raw error string');
    const r = await handleApiRequest(createDeckStore(), req('POST', '/api/llm', { provider: 'anthropic' }), { fetch });
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('raw error string');
  });

  it('forwards system prompt to Anthropic', async () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => ({ content: [{ text: 'hi' }] }) });
    await handleApiRequest(createDeckStore(), req('POST', '/api/llm', { provider: 'anthropic', apiKey: 'k', messages: [], system: 'You are a slide assistant.' }), { fetch });
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.system).toBe('You are a slide assistant.');
  });

  it('converts system prompt to a system message for OpenAI-compatible providers', async () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => ({ choices: [{ message: { content: 'hi' } }] }) });
    await handleApiRequest(createDeckStore(), req('POST', '/api/llm', { provider: 'openai', apiKey: 'k', messages: [{ role: 'user', content: 'test' }], system: 'You are a slide assistant.' }), { fetch });
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'You are a slide assistant.' });
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'test' });
    expect(sent).not.toHaveProperty('system');
  });
});
