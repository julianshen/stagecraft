// Stagecraft API handler — the logic behind the /api/* routes.
//
// Extracted from the Vite middleware (see vite.config.js) so it can be unit-tested
// without booting a server. `handleApiRequest` is a pure async function over an
// in-memory store: given a request, it returns { status, body } or null when the
// route is unhandled (the caller then falls through to next()).

let deckSeq = 0;
function newDeckId() {
  return `deck-${Date.now().toString(36)}-${(deckSeq++).toString(36)}`;
}
function deckName(deck) {
  return (deck && (deck.title || deck.name)) || 'Untitled deck';
}
function makeRecord(id, deck, name) {
  return { id, name: name || deckName(deck), deck, updatedAt: Date.now() };
}
// A minimal but valid empty deck (one section, no slides) for "new deck".
function blankDeck() {
  return { theme: 'indigo', sections: [{ id: `sec-${newDeckId()}`, name: 'Section 1', slides: [] }], slides: [] };
}

/**
 * The store holds many decks keyed by id, plus an `activeId`. `store.deck` is a
 * getter/setter onto the active deck's content, so every existing route and MCP
 * tool keeps operating on "the deck" unchanged while the library lives underneath.
 *
 * `createDeckStore()` — empty. `createDeckStore(deck)` — wrap a legacy deck as the
 * active one. `createDeckStore({ decks, activeId })` — restore a persisted snapshot.
 */
export function createDeckStore(initial = null) {
  // `rev` is a monotonic revision counter bumped on every mutation. Clients poll
  // it (GET /api/deck/state) to detect external edits without diffing the deck.
  const store = {
    // Null-prototype map so a deck id from the URL (e.g. "__proto__") can never
    // reach Object.prototype — no prototype pollution, and unknown ids read as
    // undefined (→ 404) rather than inherited members.
    decks: Object.create(null),
    activeId: null,
    rev: 0,
    get deck() {
      return this.activeId != null ? (this.decks[this.activeId]?.deck ?? null) : null;
    },
    set deck(d) {
      if (this.activeId != null && this.decks[this.activeId]) {
        const rec = this.decks[this.activeId];
        rec.deck = d;
        // The deck's title is its name — keep the library record in step on a
        // content write (Phase 3 rename will likewise set deck.title, so the two
        // never diverge). Fall back to the existing name when the deck is untitled.
        rec.name = (d && (d.title || d.name)) || rec.name;
        rec.updatedAt = Date.now();
      } else {
        const id = newDeckId();
        this.decks[id] = makeRecord(id, d);
        this.activeId = id;
      }
    },
  };
  if (initial && initial.decks) {
    // Copy into the null-prototype map (a parsed-JSON snapshot has Object.prototype).
    for (const [k, v] of Object.entries(initial.decks)) store.decks[k] = v;
    store.activeId = initial.activeId ?? Object.keys(store.decks)[0] ?? null;
  } else if (initial) {
    store.deck = initial; // wrap a legacy deck as the active one
  }
  return store;
}

// Advance the revision and stamp a record's modified time. `rec` defaults to the
// active deck (content mutations); pass a specific record to stamp it instead, or
// `null` to bump the revision without stamping (activate / delete).
function bump(store, rec) {
  store.rev += 1;
  const target = rec === undefined
    ? (store.activeId != null ? store.decks[store.activeId] : null)
    : rec;
  if (target) target.updatedAt = Date.now();
}

function deckMeta(rec, activeId) {
  return {
    id: rec.id,
    name: rec.name,
    slides: rec.deck?.slides?.length ?? 0,
    theme: rec.deck?.theme,
    updatedAt: rec.updatedAt,
    active: rec.id === activeId,
  };
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

  // Common defaults shared by both providers
  const isAnthropic = provider === 'anthropic' || !provider;
  const reqBody = {
    model: model || (isAnthropic ? 'claude-sonnet-4' : 'gpt-4o'),
    max_tokens: maxTokens || 2048,
    temperature: temperature ?? 0.7,
    messages: messages || [],
  };

  if (isAnthropic) {
    if (system != null) reqBody.system = system;
    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(reqBody),
    });
    const data = await res.json();
    return data.content?.[0]?.text || data.error?.message || 'No response';
  }

  // OpenAI-compatible
  if (system != null) {
    // Filter existing system messages to prevent duplicates
    const userMessages = (messages || []).filter((m) => m.role !== 'system');
    reqBody.messages = [{ role: 'system', content: system }, ...userMessages];
  }
  const apiBase = baseUrl || 'https://api.openai.com/v1';
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
      bump(store);
      return { status: 200, body: { result: s } };
    }
    case 'update_slide': {
      const idx = store.deck.slides.findIndex((s) => s.id === args.id);
      if (idx < 0) return { status: 404, body: { error: 'Not found' } };
      store.deck.slides[idx] = { ...store.deck.slides[idx], ...args.updates };
      bump(store);
      return { status: 200, body: { result: store.deck.slides[idx] } };
    }
    case 'delete_slide': {
      store.deck.slides = store.deck.slides.filter((s) => s.id !== args.id);
      store.deck.sections = (store.deck.sections || []).map((sec) => ({ ...sec, slides: sec.slides.filter((sid) => sid !== args.id) }));
      bump(store);
      return { status: 200, body: { result: { ok: true } } };
    }
    case 'reorder_slides': {
      if (!Array.isArray(args.order)) return { status: 400, body: { error: 'order must be an array' } };
      const order = args.order;
      const reordered = order.map((id) => store.deck.slides.find((s) => s.id === id)).filter(Boolean);
      store.deck.slides = reordered;

      // The deck renders by walking sections[] then each section's slides[], so a
      // section can only ever be a contiguous block of the flat order. To honor an
      // ARBITRARY global order (including one that interleaves slides from
      // different sections), reassign membership: each slide follows its
      // predecessor into the first slide's section. Because that is transitive,
      // every slide lands in the first slide's original section and the others
      // empty out — a cross-section reorder collapses the deck into one section,
      // but the flatten then matches the requested order exactly.
      const sections = store.deck.sections || [];
      const sectionOf = new Map();
      sections.forEach((sec, i) => {
        if (sec && Array.isArray(sec.slides)) sec.slides.forEach((id) => sectionOf.set(id, i));
      });
      const home = reordered.length
        ? (sectionOf.has(reordered[0].id) ? sectionOf.get(reordered[0].id) : 0)
        : null;
      store.deck.sections = sections.map((sec, i) => ({
        ...(sec || {}),
        slides: i === home ? reordered.map((s) => s.id) : [],
      }));
      bump(store);
      return { status: 200, body: { result: { ok: true } } };
    }
    case 'set_theme': {
      store.deck.theme = args.theme;
      bump(store);
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

  // Round-trip polling endpoint: deck content + revision (+ active deck id) in one read.
  if (path === '/api/deck/state' && method === 'GET') return ok({ deck: store.deck ?? null, rev: store.rev, activeId: store.activeId });

  // ---- Multi-deck library ----
  if (path === '/api/decks') {
    if (method === 'GET') {
      return ok(Object.values(store.decks).map((r) => deckMeta(r, store.activeId)));
    }
    if (method === 'POST') {
      const id = newDeckId();
      const d = (body && body.deck) || blankDeck();
      store.decks[id] = makeRecord(id, d, body && body.name);
      store.activeId = id;
      bump(store);
      return ok(deckMeta(store.decks[id], store.activeId), 201);
    }
  }

  const activateMatch = path.match(/^\/api\/decks\/([^/]+)\/activate$/);
  if (activateMatch && method === 'POST') {
    const id = activateMatch[1];
    if (!store.decks[id]) return ok({ error: 'Not found' }, 404);
    store.activeId = id;
    bump(store, null); // activation advances rev (clients re-adopt) but isn't an edit
    return ok({ deck: store.deck, rev: store.rev });
  }

  const deckIdMatch = path.match(/^\/api\/decks\/([^/]+)$/);
  if (deckIdMatch) {
    const id = deckIdMatch[1];
    const rec = store.decks[id];
    if (method === 'GET') {
      if (!rec) return ok({ error: 'Not found' }, 404);
      return ok({ id, name: rec.name, deck: rec.deck });
    }
    if (method === 'PUT') {
      if (!rec) return ok({ error: 'Not found' }, 404);
      if (body && typeof body.name === 'string') {
        rec.name = body.name;
        bump(store, rec); // stamp the renamed deck, even if it isn't the active one
      }
      return ok({ id, name: rec.name });
    }
    if (method === 'DELETE') {
      if (!rec) return ok({ error: 'Not found' }, 404);
      delete store.decks[id];
      if (store.activeId === id) store.activeId = Object.keys(store.decks)[0] ?? null;
      bump(store, null); // a removal, not a content edit — don't stamp the survivor
      return ok({ ok: true });
    }
  }

  if (path === '/api/deck') {
    if (method === 'GET') return ok(store.deck || {});
    if (method === 'PUT') {
      // A write may be tagged with the deck it was issued for; ignore it if the
      // active deck has since switched, so a stale in-flight PUT can't clobber a
      // different deck the user just opened.
      const forId = new URLSearchParams(req.url.split('?')[1] || '').get('forId');
      if (forId != null && forId !== store.activeId) return ok({ ok: false, ignored: true, rev: store.rev });
      store.deck = body;
      bump(store);
      return ok({ ok: true, rev: store.rev });
    }
  }

  if (path === '/api/slides') {
    if (method === 'GET') return ok(store.deck?.slides || []);
    if (method === 'POST') {
      if (!store.deck) return ok({ error: 'No deck loaded' }, 400);
      const slide = { id: newSlideId(), layout: 'text', title: 'New slide', ...body };
      store.deck.slides.push(slide);
      if (store.deck.sections?.length) store.deck.sections[store.deck.sections.length - 1].slides.push(slide.id);
      bump(store);
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
      bump(store);
      return ok(store.deck.slides[idx]);
    }
    if (method === 'DELETE') {
      store.deck.slides = store.deck.slides.filter((s) => s.id !== id);
      store.deck.sections = (store.deck.sections || []).map((sec) => ({ ...sec, slides: sec.slides.filter((sid) => sid !== id) }));
      bump(store);
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
