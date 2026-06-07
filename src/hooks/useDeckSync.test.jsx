import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useState } from 'react';
import { useDeckSync } from './useDeckSync.js';

const localDeck = { id: 'local', theme: 'indigo', slides: [], sections: [] };

// A fetch double backed by a mutable { deck, rev } the test can poke to simulate
// external MCP edits between polls.
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

// Mirrors App: owns deck state and feeds setDeck back into the hook as
// onExternalDeck. `controls` exposes the live deck + a setter to drive edits.
function Harness({ initialDeck = localDeck, intervalMs = 1000, fetchFn, controls }) {
  const [deck, setDeck] = useState(initialDeck);
  useDeckSync(deck, setDeck, { intervalMs, fetchFn });
  if (controls) { controls.deck = deck; controls.setDeck = setDeck; }
  return null;
}

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('useDeckSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('seeds the server with the local deck when the server has none', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    render(<Harness fetchFn={srv.fetchFn} />);
    await flush();
    expect(srv.puts).toEqual([localDeck]);
  });

  it('adopts a pre-existing server deck on mount instead of overwriting it', async () => {
    const serverDeck = { id: 'agent', theme: 'emerald', slides: [], sections: [] };
    const srv = makeServer({ deck: serverDeck, rev: 3 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush();
    expect(controls.deck).toEqual(serverDeck); // adopted
    expect(srv.puts).toEqual([]);              // did NOT clobber the agent's deck
  });

  it('adopts a deck the server was preloaded with, even at rev 0', async () => {
    const preloaded = { id: 'preloaded', theme: 'slate', slides: [], sections: [] };
    const srv = makeServer({ deck: preloaded, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush();
    expect(controls.deck).toEqual(preloaded); // adopted, not overwritten
    expect(srv.puts).toEqual([]);             // did not seed the sample deck over it
  });

  it('adopts an external edit surfaced by polling', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(); // seed → rev 1
    srv.state.deck = { id: 'edited', theme: 'amber', slides: [], sections: [] };
    srv.state.rev = 9;
    await flush(1000); // one poll tick
    expect(controls.deck).toEqual({ id: 'edited', theme: 'amber', slides: [], sections: [] });
  });

  it('does not adopt or echo its own writes', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    render(<Harness fetchFn={srv.fetchFn} />);
    await flush();      // seed → rev 1
    await flush(1000);  // poll sees rev 1 == lastRev
    expect(srv.puts).toEqual([localDeck]); // no echo PUT
  });

  it('pushes a local edit to the server', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(); // seed
    const edited = { id: 'local', theme: 'magenta', slides: [], sections: [] };
    await act(async () => { controls.setDeck(edited); await vi.advanceTimersByTimeAsync(0); });
    expect(srv.puts).toEqual([localDeck, edited]);
  });

  it('seeds the current deck even when edited before init completes', async () => {
    // codex race: an edit lands while the mount /api/deck/state is still in flight.
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    const edited = { id: 'pre-init', theme: 'coral', slides: [], sections: [] };
    await act(async () => { controls.setDeck(edited); }); // edit before flushing the mount request
    await flush();
    expect(srv.puts).toEqual([edited]); // seeded the edit, not the stale mount-time deck
  });

  it('re-syncs after the server rev resets (dev-server restart)', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(); // seed → rev 1
    srv.state.deck = null;
    srv.state.rev = 0; // server restarted: fresh store
    await flush(1000); // resync lastRev, no adopt
    srv.state.deck = { id: 'after-restart', theme: 'coral', slides: [], sections: [] };
    srv.state.rev = 1;
    await flush(1000);
    expect(controls.deck).toEqual({ id: 'after-restart', theme: 'coral', slides: [], sections: [] });
  });

  it('is a no-op when the server is unreachable', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('offline')));
    const controls = {};
    render(<Harness fetchFn={fetchFn} controls={controls} />);
    await flush();
    await flush(1000);
    expect(controls.deck).toEqual(localDeck); // unchanged, no throw
  });

  it('stops polling after unmount', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    const { unmount } = render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush();
    unmount();
    srv.state.deck = { id: 'late', theme: 'slate', slides: [], sections: [] };
    srv.state.rev = 5;
    await flush(3000); // would adopt if still polling
    expect(controls.deck).toEqual(localDeck);
  });

  it('falls back to global fetch when no fetchFn is provided', async () => {
    const g = vi.fn(() => Promise.resolve({ json: async () => ({ deck: null, rev: 0 }) }));
    vi.stubGlobal('fetch', g);
    render(<Harness fetchFn={undefined} />);
    await flush();
    expect(g).toHaveBeenCalledWith('/api/deck/state');
    vi.unstubAllGlobals();
  });
});
