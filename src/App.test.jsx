import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import App from './App.jsx';
import { importPptx } from './lib/pptxImport.js';

// The .pptx parser is unit-tested on its own (lib/pptxImport.test.js); here it's
// stubbed so the App test pins only the wiring: parse → create → open → notify.
vi.mock('./lib/pptxImport.js', () => ({ importPptx: vi.fn() }));
// The AI deck builder is unit-tested in lib/aiDeck.test.js; stubbed here to pin
// the Home → dialog → create → open wiring.
vi.mock('./lib/aiDeck.js', () => ({ draftOutline: vi.fn(), buildDeck: vi.fn() }));
import { draftOutline, buildDeck } from './lib/aiDeck.js';
import { stubLocalStorage } from './test/localStorage.js';

// App-level wiring smoke: the real <App/> (TopBar + Editor + useDeckSync) over
// a stubbed fetch, proving the save badge is wired end-to-end — not just that
// the hook and the badge each work in isolation.

// CanvasSlide (rendered deep inside Editor) needs ResizeObserver, which jsdom
// lacks. Stub it for this file and restore after (same as Editor.test.jsx).
const origRO = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterAll(() => { globalThis.ResizeObserver = origRO; });

const store = stubLocalStorage();

// The same in-memory server double as useDeckSync.test.jsx's makeServer, plus
// the deck-library endpoints App may hit (/api/decks list).
function makeServer(initial = { deck: null, rev: 0, activeId: null }) {
  const state = { ...initial };
  const fetchFn = vi.fn((url, init) => {
    const path = String(url).split('?')[0];
    if (path === '/api/deck/state') {
      return Promise.resolve({ ok: true, json: async () => ({ deck: state.deck, rev: state.rev, activeId: state.activeId }) });
    }
    if (path === '/api/deck' && init?.method === 'PUT') {
      state.deck = JSON.parse(init.body);
      if (state.activeId == null) state.activeId = 'seeded';
      state.rev += 1;
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, rev: state.rev, activeId: state.activeId }) });
    }
    if (path === '/api/decks') {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  return { state, fetchFn };
}

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('App wiring smoke', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows Saved after mount, then Saving… → Saved through a real UI edit [AC-2.4][AC-2.1][AC-2.2]', async () => {
    store.set('stagecraft.view', 'editor'); // land on the editor topbar branch
    const srv = makeServer();
    vi.stubGlobal('fetch', srv.fetchFn);

    render(<App />);
    await flush(); // mount reconcile (empty server) + immediate seed PUT ack

    // Scope to the topbar: the editor StatusBar has its own (static) "Saved ·
    // autosave on" text; the badge under test is the sync-driven topbar one.
    const topbar = within(document.querySelector('.topbar'));

    // [AC-2.4] the seed round-trip settled: the topbar reports Saved (a real
    // server was seen — not the badge-less 'unsupported' branch).
    expect(topbar.getByText(/^Saved/)).toBeInTheDocument();
    expect(srv.state.rev).toBe(1); // the seed actually committed server-side

    // [AC-2.1] a real UI edit — the Design-panel emerald theme swatch — flips
    // the badge to Saving… while the debounced PUT is pending.
    fireEvent.click(screen.getByRole('button', { name: 'emerald theme' }));
    await flush(0);
    expect(topbar.getByText('Saving…')).toBeInTheDocument();
    expect(topbar.queryByText(/^Saved/)).not.toBeInTheDocument();

    // [AC-2.2] after the debounce fires and the PUT acks, Saved returns and the
    // edit is on the server.
    await flush(300);
    expect(topbar.getByText(/^Saved/)).toBeInTheDocument();
    expect(srv.state.deck.theme).toBe('emerald');
  });
});

describe('App — Import PowerPoint', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.mocked(importPptx).mockReset(); });

  const pick = (file) => fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
  const pptxFile = () => {
    const f = new File(['zip'], 'Board.pptx');
    f.arrayBuffer = async () => new ArrayBuffer(3); // jsdom's File lacks arrayBuffer()
    return f;
  };

  it('parses the file, saves it as a library deck, opens it, and toasts any warnings', async () => {
    store.set('stagecraft.view', 'home');
    const imported = { title: 'Board', theme: 'slate', sections: [{ id: 's', name: 'Slides', slides: ['p1'] }], slides: [{ id: 'p1', layout: 'blank', title: 'One', bgColor: '#FFFFFF', elements: [] }] };
    vi.mocked(importPptx).mockResolvedValue({ deck: imported, warnings: ['A chart can\'t be imported yet.'] });
    const srv = makeServer();
    const created = [];
    const base = srv.fetchFn.getMockImplementation();
    srv.fetchFn.mockImplementation((url, init) => {
      const path = String(url).split('?')[0];
      if (path === '/api/decks' && init?.method === 'POST') {
        created.push(JSON.parse(init.body));
        return Promise.resolve({ ok: true, json: async () => ({ id: 'imp1', name: 'Board' }) });
      }
      if (path === '/api/decks/imp1/activate') {
        return Promise.resolve({ ok: true, json: async () => ({ deck: imported, rev: 5 }) });
      }
      return base(url, init);
    });
    vi.stubGlobal('fetch', srv.fetchFn);

    render(<App />);
    await flush();
    pick(pptxFile());
    await flush();

    expect(importPptx).toHaveBeenCalledWith(expect.any(ArrayBuffer), { fileName: 'Board.pptx' });
    expect(created).toEqual([{ name: 'Board', deck: imported }]);
    expect(store.get('stagecraft.view')).toBe('editor');
    expect(screen.getByText(/Imported 1 slide from Board\.pptx/)).toBeInTheDocument();
    expect(screen.getByText(/A chart can't be imported yet/)).toBeInTheDocument();
  });

  it('folds the result and every warning into one toast, so none is evicted', async () => {
    store.set('stagecraft.view', 'home');
    const imported = { title: 'Big', theme: 'slate', sections: [{ id: 's', name: 'S', slides: [] }], slides: [] };
    const warnings = ['w1.', 'w2.', 'w3.', 'w4.', 'w5.'];
    vi.mocked(importPptx).mockResolvedValue({ deck: imported, warnings });
    const srv = makeServer();
    const base = srv.fetchFn.getMockImplementation();
    srv.fetchFn.mockImplementation((url, init) => (String(url) === '/api/decks' && init?.method === 'POST'
      ? Promise.resolve({ ok: true, json: async () => ({ id: 'b1' }) })
      : String(url) === '/api/decks/b1/activate' ? Promise.resolve({ ok: true, json: async () => ({ deck: imported, rev: 1 }) })
        : base(url, init)));
    vi.stubGlobal('fetch', srv.fetchFn);
    render(<App />);
    await flush();
    pick(pptxFile());
    await flush();
    const msgs = [...document.querySelectorAll('.toast-msg')].map((n) => n.textContent);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/Imported 0 slides from Board\.pptx/);
    for (const w of warnings) expect(msgs[0]).toContain(w);
  });

  it('stays on Home and shows the parser error when the file is not a presentation', async () => {
    store.set('stagecraft.view', 'home');
    vi.mocked(importPptx).mockRejectedValue(new Error('Not a valid .pptx file (could not unzip it).'));
    vi.stubGlobal('fetch', makeServer().fetchFn);

    render(<App />);
    await flush();
    pick(pptxFile());
    await flush();

    expect(screen.getByText(/Not a valid \.pptx file/)).toBeInTheDocument();
    expect(store.get('stagecraft.view')).toBe('home');
  });
});

describe('App — Import PowerPoint (open failure)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.mocked(importPptx).mockReset(); });

  it('reports a failure when the created deck cannot be opened, instead of claiming success', async () => {
    store.set('stagecraft.view', 'home');
    const imported = { title: 'X', theme: 'slate', sections: [{ id: 's', name: 'S', slides: [] }], slides: [] };
    vi.mocked(importPptx).mockResolvedValue({ deck: imported, warnings: [] });
    const srv = makeServer();
    const base = srv.fetchFn.getMockImplementation();
    srv.fetchFn.mockImplementation((url, init) => (String(url) === '/api/decks' && init?.method === 'POST'
      ? Promise.resolve({ ok: true, json: async () => ({ id: 'x1' }) })
      : String(url) === '/api/decks/x1/activate' ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
        : base(url, init)));
    vi.stubGlobal('fetch', srv.fetchFn);
    render(<App />);
    await flush();
    const f = new File(['zip'], 'X.pptx');
    f.arrayBuffer = async () => new ArrayBuffer(3);
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [f] } });
    await flush();
    const msgs = [...document.querySelectorAll('.toast-msg')].map((n) => n.textContent);
    expect(msgs.join(' ')).toMatch(/Couldn't import X\.pptx/);
    expect(msgs.join(' ')).not.toMatch(/^Imported/);
    expect(store.get('stagecraft.view')).toBe('home');
  });
});

describe('App — slide-show shortcut', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('Ctrl+Enter starts the slide show (not just ⌘), and Escape ends it', async () => {
    store.set('stagecraft.view', 'editor');
    vi.stubGlobal('fetch', makeServer().fetchFn);
    render(<App />);
    await flush();
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(screen.getByText(/NOW PRESENTING/i)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/NOW PRESENTING/i)).not.toBeInTheDocument();
  });
});

describe('App — present shortcut vs text fields', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('Ctrl+Enter inside a text field does not start the slide show', async () => {
    store.set('stagecraft.view', 'editor');
    vi.stubGlobal('fetch', makeServer().fetchFn);
    render(<App />);
    await flush();
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    expect(screen.queryByText(/NOW PRESENTING/i)).not.toBeInTheDocument();
    ta.remove();
  });
});

describe('App — present shortcut vs modals', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('Ctrl+Enter does not start the slide show while a modal is open', async () => {
    store.set('stagecraft.view', 'editor');
    vi.stubGlobal('fetch', makeServer().fetchFn);
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    expect(screen.getByText(/Export ·/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(screen.queryByText(/NOW PRESENTING/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Export ·/)).toBeInTheDocument(); // the modal (and its choices) stays
  });
});

describe('Start with AI', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens the AI dialog from Home, then saves and opens the generated deck', async () => {
    store.set('stagecraft.view', 'home');
    const outline = { title: 'Q3', slides: [{ layout: 'cover', title: 'Q3', brief: '' }] };
    const generated = { title: 'Q3', theme: 'indigo', sections: [{ id: 's', name: 'Section 1', slides: ['ai1'] }], slides: [{ id: 'ai1', layout: 'cover', title: 'Q3' }] };
    vi.mocked(draftOutline).mockResolvedValue(outline);
    vi.mocked(buildDeck).mockResolvedValue(generated);
    const srv = makeServer();
    const created = [];
    const base = srv.fetchFn.getMockImplementation();
    srv.fetchFn.mockImplementation((url, init) => {
      const path = String(url).split('?')[0];
      if (path === '/api/decks' && init?.method === 'POST') {
        created.push(JSON.parse(init.body));
        return Promise.resolve({ ok: true, json: async () => ({ id: 'ai-deck', name: 'Q3' }) });
      }
      if (path === '/api/decks/ai-deck/activate') {
        return Promise.resolve({ ok: true, json: async () => ({ deck: generated, rev: 3 }) });
      }
      return base(url, init);
    });
    vi.stubGlobal('fetch', srv.fetchFn);

    render(<App />);
    await flush();
    fireEvent.click(screen.getByText('Start with AI'));
    const dialog = screen.getByRole('dialog', { name: 'Start with AI' });
    fireEvent.change(within(dialog).getByLabelText('Deck topic'), { target: { value: 'Q3 results' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Draft outline/ }));
    await flush();
    fireEvent.click(within(dialog).getByRole('button', { name: /Generate 1 slide/ }));
    await flush();

    expect(created).toEqual([{ name: 'Q3', deck: generated }]);
    expect(store.get('stagecraft.view')).toBe('editor');
    expect(screen.queryByRole('dialog', { name: 'Start with AI' })).toBeNull();
  });

  it('keeps the dialog open with an error when the new deck cannot be opened', async () => {
    store.set('stagecraft.view', 'home');
    vi.mocked(draftOutline).mockResolvedValue({ title: 'Q3', slides: [{ layout: 'cover', title: 'Q3', brief: '' }] });
    vi.mocked(buildDeck).mockResolvedValue({ title: 'Q3', sections: [], slides: [] });
    const srv = makeServer();
    const base = srv.fetchFn.getMockImplementation();
    srv.fetchFn.mockImplementation((url, init) => {
      const path = String(url).split('?')[0];
      if (path === '/api/decks' && init?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ id: 'x1' }) });
      if (path === '/api/decks/x1/activate') return Promise.resolve({ ok: true, json: async () => ({}) });
      return base(url, init);
    });
    vi.stubGlobal('fetch', srv.fetchFn);

    render(<App />);
    await flush();
    fireEvent.click(screen.getByText('Start with AI'));
    const dialog = screen.getByRole('dialog', { name: 'Start with AI' });
    fireEvent.change(within(dialog).getByLabelText('Deck topic'), { target: { value: 'Q3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Draft outline/ }));
    await flush();
    fireEvent.click(within(dialog).getByRole('button', { name: /Generate 1 slide/ }));
    await flush();

    expect(within(dialog).getByRole('alert')).toHaveTextContent(/saved to your library but could not be opened/);
    expect(store.get('stagecraft.view')).toBe('home');
  });

  it('retrying after an open failure reopens the saved deck instead of creating a duplicate', async () => {
    store.set('stagecraft.view', 'home');
    const generated = { title: 'Q3', sections: [], slides: [] };
    vi.mocked(draftOutline).mockResolvedValue({ title: 'Q3', slides: [{ layout: 'cover', title: 'Q3', brief: '' }] });
    vi.mocked(buildDeck).mockResolvedValue(generated);
    const srv = makeServer();
    const base = srv.fetchFn.getMockImplementation();
    let creates = 0;
    let activations = 0;
    srv.fetchFn.mockImplementation((url, init) => {
      const path = String(url).split('?')[0];
      if (path === '/api/decks' && init?.method === 'POST') { creates += 1; return Promise.resolve({ ok: true, json: async () => ({ id: 'x2' }) }); }
      if (path === '/api/decks/x2/activate') {
        activations += 1;
        return Promise.resolve({ ok: true, json: async () => (activations === 1 ? {} : { deck: generated, rev: 2 }) });
      }
      return base(url, init);
    });
    vi.stubGlobal('fetch', srv.fetchFn);

    render(<App />);
    await flush();
    fireEvent.click(screen.getByText('Start with AI'));
    const dialog = screen.getByRole('dialog', { name: 'Start with AI' });
    fireEvent.change(within(dialog).getByLabelText('Deck topic'), { target: { value: 'Q3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Draft outline/ }));
    await flush();
    fireEvent.click(within(dialog).getByRole('button', { name: /Generate 1 slide/ }));
    await flush();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry save' }));
    await flush();

    expect(creates).toBe(1);
    expect(activations).toBe(2);
    expect(store.get('stagecraft.view')).toBe('editor');
  });
});
