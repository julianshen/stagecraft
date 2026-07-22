import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import App from './App.jsx';
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
