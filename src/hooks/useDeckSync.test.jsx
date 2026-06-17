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
  const putUrls = [];
  const fetchFn = vi.fn((url, init) => {
    const path = url.split('?')[0];
    if (path === '/api/deck/state') {
      return Promise.resolve({ json: async () => ({ deck: state.deck, rev: state.rev, activeId: state.activeId }) });
    }
    if (path === '/api/deck' && init?.method === 'PUT') {
      const body = JSON.parse(init.body);
      puts.push(body);
      putUrls.push(url);
      state.deck = body;
      if (state.activeId == null) state.activeId = 'seeded'; // a seed creates + activates a deck
      state.rev += 1;
      return Promise.resolve({ json: async () => ({ ok: true, rev: state.rev, activeId: state.activeId }) });
    }
    return Promise.resolve({ json: async () => ({}) });
  });
  return { state, puts, putUrls, fetchFn };
}

// Mirrors App: owns deck state and feeds setDeck back into the hook as
// onExternalDeck. `controls` exposes the live deck + a setter to drive edits.
function Harness({ initialDeck = localDeck, intervalMs = 1000, pushDebounceMs, fetchFn, controls }) {
  const [deck, setDeck] = useState(initialDeck);
  const adopt = useDeckSync(deck, setDeck, { intervalMs, pushDebounceMs, fetchFn });
  if (controls) { controls.deck = deck; controls.setDeck = setDeck; controls.adopt = adopt; }
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

  it('returns an adopt() that adopts a server deck without echoing it back', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(); // seed → rev 1
    const putsAfterSeed = srv.puts.length;
    const opened = { id: 'opened', theme: 'amber', slides: [], sections: [] };
    // Simulate the server having activated `opened` (as openDeck() does server-side).
    srv.state.deck = opened; srv.state.rev = 42;
    await act(async () => { controls.adopt(opened, 42); });
    await flush(1000); // a poll tick
    expect(controls.deck).toBe(opened);          // adopted into local state
    expect(srv.puts).toHaveLength(putsAfterSeed); // and NOT echoed back as an edit
  });

  it('tags writes with the active deck id once known (stale-write guard)', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(); // seed — activeId unknown, so this PUT is untagged
    expect(srv.putUrls.at(-1)).toBe('/api/deck');
    // The server activated deck 'B'; the client opens it.
    srv.state.deck = { id: 'B', theme: 'amber', slides: [], sections: [] };
    srv.state.rev = 5; srv.state.activeId = 'B';
    await act(async () => { controls.adopt(srv.state.deck, 5, 'B'); });
    // A subsequent edit must be tagged for 'B'.
    const edited = { id: 'B', theme: 'coral', slides: [], sections: [] };
    await act(async () => { controls.setDeck(edited); });
    await flush(300);
    expect(srv.putUrls.at(-1)).toBe('/api/deck?forId=B');
  });

  it('tags writes immediately after a seed using the activeId from the PUT response', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(); // mount → seed PUT (untagged); its response carries the new activeId
    const edited = { id: 'local', theme: 'magenta', slides: [], sections: [] };
    await act(async () => { controls.setDeck(edited); });
    await flush(300);
    // No poll has run yet, but the seed response already taught us the active id.
    expect(srv.putUrls.at(-1)).toBe('/api/deck?forId=seeded');
  });

  it('does not let an ignored (dropped) write advance lastRev, so the poll still adopts the active deck', async () => {
    const state = { deck: { id: 'A', theme: 'indigo', slides: [], sections: [] }, rev: 5, activeId: 'A' };
    const fetchFn = vi.fn((url, init) => {
      const path = url.split('?')[0];
      if (path === '/api/deck/state') return Promise.resolve({ json: async () => ({ ...state }) });
      if (path === '/api/deck' && init?.method === 'PUT') {
        // While our tagged write was in flight, deck B became active at rev 9 — drop ours.
        state.deck = { id: 'B', theme: 'amber', slides: [], sections: [] }; state.rev = 9; state.activeId = 'B';
        return Promise.resolve({ json: async () => ({ ok: false, ignored: true, rev: 9, activeId: 'B' }) });
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    const controls = {};
    render(<Harness initialDeck={state.deck} fetchFn={fetchFn} controls={controls} />);
    await flush(); // mount adopts A @ rev 5
    await act(async () => { controls.setDeck({ id: 'A2', theme: 'coral', slides: [], sections: [] }); });
    await flush(300);
    await flush(1000); // poll
    expect(controls.deck.id).toBe('B'); // adopted the now-active deck, not stuck on the dropped edit
  });

  it('pushes a local edit to the server', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(); // seed
    const edited = { id: 'local', theme: 'magenta', slides: [], sections: [] };
    await act(async () => { controls.setDeck(edited); });
    await flush(300);
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

describe('push debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces rapid edits into one trailing PUT carrying the final deck', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(); // seed (immediate)
    expect(srv.puts).toHaveLength(1);
    // three keystrokes inside the window → one PUT with the final deck
    await act(async () => { controls.setDeck({ ...localDeck, title: 'a' }); });
    await flush(100);
    await act(async () => { controls.setDeck({ ...localDeck, title: 'ab' }); });
    await flush(100);
    await act(async () => { controls.setDeck({ ...localDeck, title: 'abc' }); });
    await flush(100);
    expect(srv.puts).toHaveLength(1); // still within the window — nothing pushed yet
    await flush(300);
    expect(srv.puts).toHaveLength(2);
    expect(srv.puts.at(-1).title).toBe('abc');
  });

  it('a single edit pushes after the debounce window, not immediately', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(); // seed
    await act(async () => { controls.setDeck({ ...localDeck, title: 'edit' }); });
    await flush(0);
    expect(srv.puts).toHaveLength(1); // not yet
    await flush(300);
    expect(srv.puts).toHaveLength(2);
  });

  it('the seed itself is immediate — a fresh deck is available to agents right away', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    render(<Harness fetchFn={srv.fetchFn} />);
    await flush(0);
    expect(srv.puts).toEqual([localDeck]);
  });

  it('honors a custom pushDebounceMs', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} pushDebounceMs={50} intervalMs={60000} controls={controls} />);
    await flush();
    await act(async () => { controls.setDeck({ ...localDeck, title: 'q' }); });
    await flush(50);
    expect(srv.puts).toHaveLength(2);
  });

  it('records the rev of a superseded (cancelled) write so the poll does not re-adopt it over local edits', async () => {
    // Regression: a write whose response arrives after a newer edit cancelled it
    // still COMMITTED on the server (rev advanced). If we skip recording that rev
    // because `cancelled` is set, the next poll sees rev != lastRev, mistakes our
    // own write for an external edit, and adopts it — reverting what the user is
    // still typing. A deferred-PUT server lets us supersede before the ack lands.
    const state = { deck: null, rev: 0, activeId: null };
    const pendingPuts = [];
    const fetchFn = vi.fn((url, init) => {
      if (url.split('?')[0] === '/api/deck/state') {
        return Promise.resolve({ json: async () => ({ deck: state.deck, rev: state.rev, activeId: state.activeId }) });
      }
      if (init?.method === 'PUT') {
        state.deck = JSON.parse(init.body);
        if (state.activeId == null) state.activeId = 'seeded';
        state.rev += 1;
        const rev = state.rev, activeId = state.activeId;
        return new Promise((res) => pendingPuts.push(() => res({ json: async () => ({ ok: true, rev, activeId }) })));
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    const controls = {};
    // intervalMs (20) < pushDebounceMs (1000): we can fire a poll without the
    // pending edit's debounce timer firing.
    render(<Harness fetchFn={fetchFn} intervalMs={20} pushDebounceMs={1000} controls={controls} />);
    await flush(0); // mount reconcile (server empty) → immediate seed PUT (deferred), server.rev=1
    // Supersede the seed before its ack lands: the user starts typing.
    await act(async () => { controls.setDeck({ ...localDeck, title: 'a' }); });
    pendingPuts[0](); // release the seed ack — but it was cancelled by the edit above
    await flush(0);
    await flush(20); // a poll tick (the 'a' debounce timer, at 1000, stays pending)
    expect(controls.deck.title).toBe('a'); // not reverted to the seeded deck
  });

  it('ignores a stale active id from a superseded PUT, so the first edit after a deck switch is tagged for the new deck', async () => {
    // Regression: recording rev from a cancelled write (above) must NOT also let
    // it relearn activeId. A deck-A write whose ack is delayed past a switch to
    // deck B would otherwise drag activeId back to A; the next edit to B is then
    // PUT with ?forId=A, which the server's stale-write guard drops — silently
    // losing the first edit after the switch.
    const state = { deck: null, rev: 0, activeId: null };
    const pendingPuts = [];
    const putUrls = [];
    const fetchFn = vi.fn((url, init) => {
      if (url.split('?')[0] === '/api/deck/state') {
        return Promise.resolve({ json: async () => ({ deck: state.deck, rev: state.rev, activeId: state.activeId }) });
      }
      if (init?.method === 'PUT') {
        putUrls.push(url);
        state.deck = JSON.parse(init.body);
        if (state.activeId == null) state.activeId = 'A';
        state.rev += 1;
        const rev = state.rev, activeId = state.activeId;
        return new Promise((res) => pendingPuts.push(() => res({ json: async () => ({ ok: true, rev, activeId }) })));
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    const controls = {};
    render(<Harness fetchFn={fetchFn} intervalMs={100000} pushDebounceMs={1000} controls={controls} />);
    await flush(0);                     // seed PUT for deck A (deferred)
    pendingPuts[0](); await flush(0);   // seed ack → activeId 'A'
    // Edit A; let the debounce fire, but hold its (deck-A) ack in flight.
    await act(async () => { controls.setDeck({ ...localDeck, title: 'a1' }); });
    await flush(1000);                  // PUT for A dispatched, response deferred (pendingPuts[1])
    // Switch to deck B (server-authoritative open): activeId → 'B'.
    await act(async () => { controls.adopt({ ...localDeck, title: 'B' }, 5, 'B'); });
    pendingPuts[1](); await flush(0);   // the delayed deck-A ack lands — must not relearn activeId 'A'
    // First edit to B must be tagged for B, not the superseded A.
    await act(async () => { controls.setDeck({ ...localDeck, title: 'B-edit' }); });
    await flush(1000);
    expect(putUrls.at(-1)).toBe('/api/deck?forId=B');
  });

  it('stays debounced when the server is unreachable (the seed never acked)', async () => {
    // Regression: keying "immediate" off lastRev===null left the debounce off
    // forever when every PUT fails — per-keystroke fetch attempts in exactly
    // the mode where coalescing matters most.
    const fetchFn = vi.fn(() => Promise.reject(new Error('offline')));
    const controls = {};
    render(<Harness fetchFn={fetchFn} controls={controls} />);
    await flush(); // mount + immediate seed attempt (fails)
    const callsAfterSeed = fetchFn.mock.calls.length;
    await act(async () => { controls.setDeck({ ...localDeck, title: 'x' }); });
    await flush(0);
    await act(async () => { controls.setDeck({ ...localDeck, title: 'xy' }); });
    await flush(0);
    expect(fetchFn.mock.calls.length).toBe(callsAfterSeed); // both edits still pending
    await flush(300);
    expect(fetchFn.mock.calls.length).toBe(callsAfterSeed + 1); // one coalesced attempt
  });

  it('pushes an undo/redo revert back to a previously adopted deck (no stale echo-guard skip)', async () => {
    // Regression: undo can restore the EXACT object reference we last adopted.
    // The identity-only echo guard used to swallow that revert, leaving the
    // server ahead of the UI. The guard is now rev-scoped: once a later edit has
    // pushed, the adopted reference is no longer "fresh" and a revert to it syncs.
    const serverDeck = { id: 'agent', theme: 'emerald', slides: [], sections: [] };
    const srv = makeServer({ deck: serverDeck, rev: 3 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} pushDebounceMs={50} controls={controls} />);
    await flush();
    const adoptedRef = controls.deck;       // the exact object adopted on mount
    expect(srv.puts).toEqual([]);           // adoption echo suppressed

    const edited = { ...serverDeck, theme: 'amber' };
    act(() => { controls.setDeck(edited); });
    await flush(60);
    expect(srv.puts).toEqual([edited]);     // local edit pushed; server rev advances

    act(() => { controls.setDeck(adoptedRef); }); // undo back to the adopted ref
    await flush(60);
    expect(srv.puts).toEqual([edited, adoptedRef]); // the revert is now pushed, not skipped
  });
});
