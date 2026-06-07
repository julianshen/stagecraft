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
});
