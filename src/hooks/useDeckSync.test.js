import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDeckSync } from './useDeckSync.js';

const localDeck = { id: 'local', theme: 'indigo', slides: [], sections: [] };

// Build a fetch double backed by a mutable in-memory { deck, rev } the test can
// poke to simulate external MCP edits between polls.
function makeServer(initial = { deck: null, rev: 0 }) {
  const state = { ...initial };
  const puts = [];
  const fetchFn = vi.fn((url, init) => {
    if (url === '/api/deck/state') {
      return Promise.resolve({ json: async () => ({ deck: state.deck, rev: state.rev }) });
    }
    if (url === '/api/deck' && init?.method === 'PUT') {
      const body = JSON.parse(init.body);
      puts.push(body);
      state.deck = body;
      state.rev += 1;
      return Promise.resolve({ json: async () => ({ ok: true, rev: state.rev }) });
    }
    return Promise.resolve({ json: async () => ({}) });
  });
  return { state, puts, fetchFn };
}

describe('useDeckSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('seeds the server with the local deck when the server has none', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const onExternal = vi.fn();
    renderHook(() => useDeckSync(localDeck, onExternal, { intervalMs: 1000, fetchFn: srv.fetchFn }));
    await vi.advanceTimersByTimeAsync(0);
    expect(srv.puts).toEqual([localDeck]);
    expect(onExternal).not.toHaveBeenCalled();
  });

  it('adopts a pre-existing server deck on mount instead of overwriting it', async () => {
    const serverDeck = { id: 'agent', theme: 'emerald', slides: [], sections: [] };
    const srv = makeServer({ deck: serverDeck, rev: 3 });
    const onExternal = vi.fn();
    renderHook(() => useDeckSync(localDeck, onExternal, { intervalMs: 1000, fetchFn: srv.fetchFn }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onExternal).toHaveBeenCalledWith(serverDeck);
    expect(srv.puts).toEqual([]); // did NOT clobber the agent's deck
  });

  it('adopts an external edit surfaced by polling', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const onExternal = vi.fn();
    renderHook(() => useDeckSync(localDeck, onExternal, { intervalMs: 1000, fetchFn: srv.fetchFn }));
    await vi.advanceTimersByTimeAsync(0); // mount seed → rev 1
    // An external MCP client edits the deck:
    srv.state.deck = { id: 'edited', theme: 'amber', slides: [], sections: [] };
    srv.state.rev = 9;
    await vi.advanceTimersByTimeAsync(1000); // one poll tick
    expect(onExternal).toHaveBeenCalledWith({ id: 'edited', theme: 'amber', slides: [], sections: [] });
  });

  it('does not adopt its own writes (no echo loop)', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const onExternal = vi.fn();
    renderHook(() => useDeckSync(localDeck, onExternal, { intervalMs: 1000, fetchFn: srv.fetchFn }));
    await vi.advanceTimersByTimeAsync(0); // seed → rev 1, lastRev = 1
    await vi.advanceTimersByTimeAsync(1000); // poll sees rev 1 == lastRev
    expect(onExternal).not.toHaveBeenCalled();
  });

  it('pushes a local edit to the server', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const onExternal = vi.fn();
    const { rerender } = renderHook(
      ({ d }) => useDeckSync(d, onExternal, { intervalMs: 1000, fetchFn: srv.fetchFn }),
      { initialProps: { d: localDeck } }
    );
    await vi.advanceTimersByTimeAsync(0); // mount seed → puts: [localDeck]
    const edited = { id: 'local', theme: 'magenta', slides: [], sections: [] };
    rerender({ d: edited });
    await vi.advanceTimersByTimeAsync(0); // push effect fires for the new deck
    expect(srv.puts).toEqual([localDeck, edited]);
  });

  it('does not echo-PUT a deck it just adopted', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    let current = localDeck;
    const onExternal = vi.fn((d) => { current = d; }); // mimic App's setDeck
    const { rerender } = renderHook(
      ({ d }) => useDeckSync(d, onExternal, { intervalMs: 1000, fetchFn: srv.fetchFn }),
      { initialProps: { d: localDeck } }
    );
    await vi.advanceTimersByTimeAsync(0); // seed → puts: [localDeck]
    srv.state.deck = { id: 'ext', theme: 'amber', slides: [], sections: [] };
    srv.state.rev = 7;
    await vi.advanceTimersByTimeAsync(1000); // poll adopts → onExternal(ext)
    rerender({ d: current });               // App re-renders with the adopted deck
    await vi.advanceTimersByTimeAsync(0);    // push effect must skip the echo
    expect(srv.puts).toEqual([localDeck]);   // no PUT of the adopted deck
  });

  it('is a no-op when the server is unreachable', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('offline')));
    const onExternal = vi.fn();
    expect(() =>
      renderHook(() => useDeckSync(localDeck, onExternal, { intervalMs: 1000, fetchFn }))
    ).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);    // mount reconcile rejects → caught
    await vi.advanceTimersByTimeAsync(1000); // poll rejects → caught
    expect(onExternal).not.toHaveBeenCalled();
  });

  it('re-syncs after the server rev resets (dev-server restart)', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const onExternal = vi.fn();
    renderHook(() => useDeckSync(localDeck, onExternal, { intervalMs: 1000, fetchFn: srv.fetchFn }));
    await vi.advanceTimersByTimeAsync(0); // seed → rev 1, lastRev = 1

    // Server restarts: fresh store at rev 0, no deck. lastRev must not get stuck at 1.
    srv.state.deck = null;
    srv.state.rev = 0;
    await vi.advanceTimersByTimeAsync(1000); // poll: rev 0 ≠ 1, no deck → resync, no adopt
    expect(onExternal).not.toHaveBeenCalled();

    // A later external edit at rev 1 must now be adopted (would be missed if stuck).
    srv.state.deck = { id: 'after-restart', theme: 'coral', slides: [], sections: [] };
    srv.state.rev = 1;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onExternal).toHaveBeenCalledWith({ id: 'after-restart', theme: 'coral', slides: [], sections: [] });
  });

  it('falls back to global fetch when no fetchFn is provided', async () => {
    const g = vi.fn(() => Promise.resolve({ json: async () => ({ deck: null, rev: 0 }) }));
    vi.stubGlobal('fetch', g);
    const onExternal = vi.fn();
    renderHook(() => useDeckSync(localDeck, onExternal, { intervalMs: 1000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(g).toHaveBeenCalledWith('/api/deck/state');
    vi.unstubAllGlobals();
  });

  it('stops polling after unmount', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const onExternal = vi.fn();
    const { unmount } = renderHook(() => useDeckSync(localDeck, onExternal, { intervalMs: 1000, fetchFn: srv.fetchFn }));
    await vi.advanceTimersByTimeAsync(0); // seed
    unmount();
    srv.state.deck = { id: 'late', theme: 'slate', slides: [], sections: [] };
    srv.state.rev = 5;
    await vi.advanceTimersByTimeAsync(3000); // would adopt if still polling
    expect(onExternal).not.toHaveBeenCalled();
  });
});
