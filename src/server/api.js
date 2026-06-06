// Stagecraft API handler — the logic behind the /api/* routes.
//
// Extracted from the Vite middleware (see vite.config.js) so it can be unit-tested
// without booting a server. `handleApiRequest` is a pure async function over an
// in-memory store: given a request, it returns { status, body } or null when the
// route is unhandled (the caller then falls through to next()).

export function createDeckStore(initialDeck = null) {
  return { deck: initialDeck };
}

export const MCP_MANIFEST = {
  version: '1.0',
  name: 'Stagecraft',
  description: 'Presentation editor MCP server',
  tools: [
    { name: 'get_deck', description: 'Get the current presentation deck', inputSchema: {} },
    { name: 'add_slide', description: 'Add a new slide', inputSchema: { type: 'object', properties: { layout: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } } } },
    { name: 'update_slide', description: 'Update a slide', inputSchema: { type: 'object', properties: { id: { type: 'string' }, updates: { type: 'object' } } } },
    { name: 'delete_slide', description: 'Delete a slide', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
    { name: 'reorder_slides', description: 'Reorder slides', inputSchema: { type: 'object', properties: { order: { type: 'array', items: { type: 'string' } } } } },
    { name: 'set_theme', description: 'Change deck theme', inputSchema: { type: 'object', properties: { theme: { type: 'string', enum: ['indigo', 'emerald', 'amber', 'coral', 'magenta', 'slate'] } } } },
  ],
};

function newSlideId() {
  return `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function proxyLLM(body, fetchFn) {
  const { messages, provider, model, apiKey, baseUrl, temperature, maxTokens, system } = body || {};
  if (provider === 'anthropic' || !provider) {
    const reqBody = { model: model || 'claude-sonnet-4', max_tokens: maxTokens || 2048, temperature: temperature ?? 0.7, messages: messages || [] };
    if (system != null) reqBody.system = system;
    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(reqBody),
    });
    const data = await res.json();
    return data.content?.[0]?.text || data.error?.message || 'No response';
  }
  const apiBase = baseUrl || 'https://api.openai.com/v1';
  const reqBody = { model: model || 'gpt-4o', max_tokens: maxTokens || 2048, temperature: temperature ?? 0.7, messages: messages || [] };
  if (system != null) {
    // Avoid duplicate system messages by filtering out any existing ones before prepending
    const userMessages = (messages || []).filter((m) => m.role !== 'system');
    reqBody.messages = [{ role: 'system', content: system }, ...userMessages];
  }
  const res = await fetchFn(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey || ''}` },
    body: JSON.stringify(reqBody),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || data.error?.message || 'No response';
}

function runTool(store, name, args = {}) {
  // get_deck is the only tool that works without a loaded deck.
  if (name === 'get_deck') return { status: 200, body: { result: store.deck } };
  if (!store.deck) return { status: 400, body: { error: 'No deck loaded' } };

  switch (name) {
    case 'add_slide': {
      const s = { id: newSlideId(), layout: 'text', title: 'New slide', ...args };
      store.deck.slides.push(s);
      if (store.deck.sections?.length) store.deck.sections[store.deck.sections.length - 1].slides.push(s.id);
      return { status: 200, body: { result: s } };
    }
    case 'update_slide': {
      const idx = store.deck.slides.findIndex((s) => s.id === args.id);
      if (idx < 0) return { status: 404, body: { error: 'Not found' } };
      store.deck.slides[idx] = { ...store.deck.slides[idx], ...args.updates };
      return { status: 200, body: { result: store.deck.slides[idx] } };
    }
    case 'delete_slide': {
      store.deck.slides = store.deck.slides.filter((s) => s.id !== args.id);
      store.deck.sections = (store.deck.sections || []).map((sec) => ({ ...sec, slides: sec.slides.filter((sid) => sid !== args.id) }));
      return { status: 200, body: { result: { ok: true } } };
    }
    case 'reorder_slides': {
      if (!Array.isArray(args.order)) return { status: 400, body: { error: 'order must be an array' } };
      const order = args.order;
      const reordered = order.map((id) => store.deck.slides.find((s) => s.id === id)).filter(Boolean);
      store.deck.slides = reordered;

      // The deck renders by walking sections[] then each section's slides[], so
      // honoring a global order across section boundaries means re-sequencing
      // BOTH the slides within a section AND the sections themselves. Rank each
      // section by the global index of its first remaining slide; sort slides
      // within a section the same way. Sections that lose all their slides keep
      // their original relative order and sink to the end. (Sections render as
      // contiguous blocks, so a request that would interleave two multi-slide
      // sections is resolved by keeping each section's slides together.)
      const slideIndex = new Map(reordered.map((s, i) => [s.id, i]));
      const ranked = (store.deck.sections || []).map((sec, origIdx) => {
        const slides = (sec && Array.isArray(sec.slides) ? sec.slides : [])
          .filter((id) => slideIndex.has(id))
          .sort((a, b) => slideIndex.get(a) - slideIndex.get(b));
        const rank = slides.length ? slideIndex.get(slides[0]) : Infinity;
        return { sec, slides, rank, origIdx };
      });
      ranked.sort((x, y) => (x.rank - y.rank) || (x.origIdx - y.origIdx));
      store.deck.sections = ranked.map(({ sec, slides }) => ({ ...(sec || {}), slides }));
      return { status: 200, body: { result: { ok: true } } };
    }
    case 'set_theme': {
      store.deck.theme = args.theme;
      return { status: 200, body: { result: { ok: true } } };
    }
    default:
      return { status: 400, body: { error: `Unknown tool: ${name}` } };
  }
}

/**
 * @param store  result of createDeckStore()
 * @param req    { method, url, body }  — body is the parsed JSON (or null)
 * @param deps   { fetch } — injectable for tests
 * @returns { status, body } | null  (null = route not handled)
 */
export async function handleApiRequest(store, req, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const { method, body } = req;
  const path = (req.url || '').split('?')[0];
  const ok = (data, status = 200) => ({ status, body: data });

  if (path === '/api/health' && method === 'GET') return ok({ ok: true, version: '1.0.0' });

  if (path === '/api/deck') {
    if (method === 'GET') return ok(store.deck || {});
    if (method === 'PUT') { store.deck = body; return ok({ ok: true }); }
  }

  if (path === '/api/slides') {
    if (method === 'GET') return ok(store.deck?.slides || []);
    if (method === 'POST') {
      if (!store.deck) return ok({ error: 'No deck loaded' }, 400);
      const slide = { id: newSlideId(), layout: 'text', title: 'New slide', ...body };
      store.deck.slides.push(slide);
      if (store.deck.sections?.length) store.deck.sections[store.deck.sections.length - 1].slides.push(slide.id);
      return ok(slide);
    }
  }

  const slideMatch = path.match(/^\/api\/slides\/(.+)$/);
  if (slideMatch) {
    const id = slideMatch[1];
    if (!store.deck) return ok({ error: 'No deck loaded' }, 400);
    if (method === 'PUT') {
      const idx = store.deck.slides.findIndex((s) => s.id === id);
      if (idx < 0) return ok({ error: 'Not found' }, 404);
      store.deck.slides[idx] = { ...store.deck.slides[idx], ...body };
      return ok(store.deck.slides[idx]);
    }
    if (method === 'DELETE') {
      store.deck.slides = store.deck.slides.filter((s) => s.id !== id);
      store.deck.sections = (store.deck.sections || []).map((sec) => ({ ...sec, slides: sec.slides.filter((sid) => sid !== id) }));
      return ok({ ok: true });
    }
  }

  if (path === '/api/export/pptx' && method === 'POST') {
    return ok({ ok: true, message: 'Export triggered — use client-side exportToPPTX()' });
  }

  if (path === '/api/llm' && method === 'POST') {
    try {
      return ok({ text: await proxyLLM(body, fetchFn) });
    } catch (err) {
      return ok({ error: err.message || String(err) }, 500);
    }
  }

  if (path === '/api/mcp' && method === 'GET') return ok(MCP_MANIFEST);

  if (path === '/api/mcp/tools/call' && method === 'POST') {
    const { name, arguments: args } = body || {};
    return runTool(store, name, args);
  }

  return null;
}
