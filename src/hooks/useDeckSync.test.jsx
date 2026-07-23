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
  const sync = useDeckSync(deck, setDeck, { intervalMs, pushDebounceMs, fetchFn });
  if (controls) { controls.deck = deck; controls.setDeck = setDeck; controls.adopt = sync.adopt; controls.sync = sync; }
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

  it('pushes an undo revert that lands before the prior edit PUT acks', async () => {
    // The race: edit E's PUT has fired and is in-flight (lastRev not yet
    // advanced); undo back to the adopted reference lands before the ack. The
    // revert must still push — divergence drops the fresh-adoption suppression
    // immediately, not only once a newer rev acks.
    const serverDeck = { id: 'agent', theme: 'emerald', slides: [], sections: [] };
    const state = { deck: serverDeck, rev: 3, activeId: 'agent' };
    const puts = [];
    const resolvers = []; // hold every PUT ack so we can act mid-flight
    const fetchFn = vi.fn((url, init) => {
      const path = url.split('?')[0];
      if (path === '/api/deck/state') return Promise.resolve({ json: async () => ({ ...state }) });
      if (path === '/api/deck' && init?.method === 'PUT') {
        puts.push(JSON.parse(init.body));
        state.rev += 1;
        const rev = state.rev;
        return new Promise((res) => resolvers.push(() => res({ json: async () => ({ rev, activeId: state.activeId }) })));
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    const controls = {};
    render(<Harness fetchFn={fetchFn} pushDebounceMs={50} controls={controls} />);
    await flush();
    const adoptedRef = controls.deck;

    act(() => { controls.setDeck({ ...serverDeck, theme: 'amber' }); });
    await flush(60);                       // edit PUT fires; ack held (lastRev still 3)
    expect(puts).toHaveLength(1);

    act(() => { controls.setDeck(adoptedRef); }); // undo BEFORE the edit acks
    await flush(60);
    expect(puts).toHaveLength(2);          // revert pushed despite the in-flight, un-acked edit
    expect(puts[1]).toEqual(adoptedRef);   // PUT body is serialized, so compare by value

    act(() => { resolvers.forEach((r) => r()); }); // drain held acks
  });
});

// A PUT double whose acks are deferred: each PUT registers a resolver in
// `pending` that the test releases explicitly, so we can observe the 'saving'
// window and prove savedAt is stamped at ack time (not edit time).
function makeDeferredServer(initial = { deck: null, rev: 0, activeId: null }) {
  const state = { ...initial };
  const pending = [];
  const fetchFn = vi.fn((url, init) => {
    if (url.split('?')[0] === '/api/deck/state') {
      return Promise.resolve({ json: async () => ({ deck: state.deck, rev: state.rev, activeId: state.activeId }) });
    }
    if (init?.method === 'PUT') {
      state.deck = JSON.parse(init.body);
      if (state.activeId == null) state.activeId = 'seeded';
      state.rev += 1;
      const rev = state.rev, activeId = state.activeId;
      return new Promise((res) => pending.push(() => res({ json: async () => ({ ok: true, rev, activeId }) })));
    }
    return Promise.resolve({ json: async () => ({}) });
  });
  return { state, pending, fetchFn };
}

describe('sync status', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('AC-1.1: reports "saving" while a PUT is debounce-pending/in-flight after an edit', async () => {
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(); // mount (server seen) + seed acked immediately
    expect(controls.sync.status).toBe('saved');
    await act(async () => { controls.setDeck({ ...localDeck, title: 'edit' }); });
    await flush(0); // effect ran, debounce timer pending, PUT not yet fired
    expect(controls.sync.status).toBe('saving');
  });

  it('AC-1.2: stamps savedAt at PUT ack time, not edit time', async () => {
    const srv = makeDeferredServer();
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(0); // mount: server seen (empty); seed PUT dispatched but ack deferred
    expect(controls.sync.savedAt).toBeNull(); // no commit acked yet
    await act(async () => { controls.setDeck({ ...localDeck, title: 'e' }); });
    await flush(300); // debounce fires: edit PUT dispatched, ack still deferred
    expect(controls.sync.status).toBe('saving');
    expect(controls.sync.savedAt).toBeNull(); // NOT stamped at edit time
    await act(async () => { srv.pending.forEach((r) => r()); srv.pending.length = 0; });
    await flush(0); // acks land
    expect(controls.sync.status).toBe('saved');
    expect(controls.sync.savedAt).not.toBeNull(); // stamped only once the PUT resolved
  });

  it('AC-1.3: transitions to "error" when the server was seen on mount and a later PUT rejects', async () => {
    let putFails = false;
    const state = { deck: null, rev: 0, activeId: null };
    const fetchFn = vi.fn((url, init) => {
      if (url.split('?')[0] === '/api/deck/state') {
        return Promise.resolve({ json: async () => ({ ...state }) });
      }
      if (init?.method === 'PUT') {
        if (putFails) return Promise.reject(new Error('write failed'));
        state.deck = JSON.parse(init.body);
        if (state.activeId == null) state.activeId = 'seeded';
        state.rev += 1;
        return Promise.resolve({ json: async () => ({ ok: true, rev: state.rev, activeId: state.activeId }) });
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    const controls = {};
    render(<Harness fetchFn={fetchFn} controls={controls} />);
    await flush(); // mount: server seen; seed acks → saved
    expect(controls.sync.status).toBe('saved');
    putFails = true;
    await act(async () => { controls.setDeck({ ...localDeck, title: 'boom' }); });
    await flush(300); // edit PUT rejects
    expect(controls.sync.status).toBe('error');
  });

  it('AC-1.4: stays "unsupported" (never "error") when the initial state fetch never succeeds', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('offline')));
    const controls = {};
    render(<Harness fetchFn={fetchFn} controls={controls} />);
    await flush(); // mount GET rejects (server never seen); seed PUT also rejects
    expect(controls.sync.status).toBe('unsupported');
    await act(async () => { controls.setDeck({ ...localDeck, title: 'x' }); });
    await flush(300); // edit PUT rejects too — a missing server is not an error
    expect(controls.sync.status).toBe('unsupported');
  });

  it('does not show "saved" when the server recovers with an edit still unpushed — it re-pushes first [AC-1.3]', async () => {
    // The server is down at mount (GET + seed PUT reject). The user edits while
    // offline (that PUT rejects too). When the server later comes back, a naive
    // poll flip to "saved" would LIE: the edit lives only in this tab and is not
    // on the server. The recovery must re-push the pending edit and only report
    // "saved" once the server actually ACKs it.
    let down = true;
    const state = { deck: null, rev: 0, activeId: null };
    const puts = [];
    const fetchFn = vi.fn((url, init) => {
      if (down) return Promise.reject(new Error('offline'));
      const path = url.split('?')[0];
      if (path === '/api/deck/state') {
        return Promise.resolve({ json: async () => ({ deck: state.deck, rev: state.rev, activeId: state.activeId }) });
      }
      if (path === '/api/deck' && init?.method === 'PUT') {
        const body = JSON.parse(init.body); puts.push(body); state.deck = body;
        if (state.activeId == null) state.activeId = 'seeded';
        state.rev += 1;
        return Promise.resolve({ json: async () => ({ ok: true, rev: state.rev, activeId: state.activeId }) });
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    const controls = {};
    render(<Harness fetchFn={fetchFn} intervalMs={1000} controls={controls} />);
    await flush();                       // mount GET + seed PUT reject → 'unsupported'
    await act(async () => { controls.setDeck({ ...localDeck, title: 'edited offline' }); });
    await flush(300);                    // that edit's PUT rejects too
    expect(controls.sync.status).toBe('unsupported');
    expect(puts).toEqual([]);            // nothing has reached the server yet

    down = false;                        // server comes back up
    await flush(1000);                   // next poll succeeds → must retry the pending edit
    await flush(300);                    // the retried PUT is debounced then acks
    // the badge is honest: the edit was actually pushed, THEN 'saved'
    expect(puts.at(-1)).toMatchObject({ title: 'edited offline' });
    expect(controls.sync.status).toBe('saved');
    expect(controls.sync.savedAt).not.toBeNull();
  });

  it('AC-1.3/AC-1.4: a successful PUT after a failed mount GET marks the server seen, so a later failed PUT is an error', async () => {
    // Transient mount failure: the server was down when the page loaded (mount
    // GET + seed PUT reject), then came up. A successful PUT is a real server
    // round-trip — a later failed PUT must surface 'error', not be swallowed
    // behind a stale "never saw a server" latch showing 'saved'/'unsupported'.
    let down = true;
    let putFails = false;
    const state = { deck: null, rev: 0, activeId: null };
    const fetchFn = vi.fn((url, init) => {
      if (down) return Promise.reject(new Error('server down'));
      if (url.split('?')[0] === '/api/deck/state') {
        return Promise.resolve({ json: async () => ({ ...state }) });
      }
      if (init?.method === 'PUT') {
        if (putFails) return Promise.reject(new Error('write failed'));
        state.deck = JSON.parse(init.body);
        if (state.activeId == null) state.activeId = 'seeded';
        state.rev += 1;
        return Promise.resolve({ json: async () => ({ ok: true, rev: state.rev, activeId: state.activeId }) });
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    const controls = {};
    render(<Harness fetchFn={fetchFn} controls={controls} />);
    await flush(); // mount GET rejects; immediate seed PUT rejects too
    expect(controls.sync.status).toBe('unsupported');
    down = false; // the server came up
    await act(async () => { controls.setDeck({ ...localDeck, title: 'first' }); });
    await flush(300); // PUT succeeds — a real round-trip
    expect(controls.sync.status).toBe('saved');
    putFails = true;
    await act(async () => { controls.setDeck({ ...localDeck, title: 'boom' }); });
    await flush(300); // this PUT rejects — must NOT be swallowed
    expect(controls.sync.status).toBe('error');
  });

  it('AC-1.4: a successful poll marks the server seen — the pending seed re-pushes to "saved", then a later failed PUT is "error"', async () => {
    // Transient-mount scenario where the POLL is the first round-trip to succeed.
    // It must NOT blindly settle 'unsupported'→'saved' (the seed never landed);
    // it re-pushes the pending seed and only reaches 'saved' once that ACKs —
    // after which a later failed PUT is an honest 'error', not swallowed.
    let down = true;
    let putFails = false;
    const state = { deck: null, rev: 0, activeId: null };
    const fetchFn = vi.fn((url, init) => {
      if (down) return Promise.reject(new Error('server down'));
      if (url.split('?')[0] === '/api/deck/state') {
        return Promise.resolve({ json: async () => ({ ...state }) });
      }
      if (init?.method === 'PUT') {
        if (putFails) return Promise.reject(new Error('write failed'));
        state.rev += 1; if (state.activeId == null) state.activeId = 'seeded';
        return Promise.resolve({ json: async () => ({ ok: true, rev: state.rev, activeId: state.activeId }) });
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    const controls = {};
    render(<Harness fetchFn={fetchFn} controls={controls} />);
    await flush(); // mount GET + seed PUT reject
    expect(controls.sync.status).toBe('unsupported');
    down = false;
    await flush(1000); // poll succeeds → server seen → pending seed re-pushes
    await flush(300);  // the retried seed PUT acks
    expect(controls.sync.status).toBe('saved'); // honest: the seed actually landed
    putFails = true;
    await act(async () => { controls.setDeck({ ...localDeck, title: 'x' }); });
    await flush(300); // PUT rejects — now an honest error
    expect(controls.sync.status).toBe('error');
  });

  it('AC-1.3: a superseded write rejecting late does not overwrite a newer push\'s "saved"', async () => {
    // The first PUT's ack is held; a second edit supersedes it and its PUT acks.
    // Only then does the first PUT reject — a stale failure for a write that no
    // longer represents the latest edit must not flip 'saved' to 'error'.
    const state = { deck: null, rev: 0, activeId: null };
    let rejectFirstPut = null;
    let puts = 0;
    const fetchFn = vi.fn((url, init) => {
      if (url.split('?')[0] === '/api/deck/state') {
        return Promise.resolve({ json: async () => ({ ...state }) });
      }
      if (init?.method === 'PUT') {
        puts += 1;
        if (puts === 1) return new Promise((_res, rej) => { rejectFirstPut = () => rej(new Error('late failure')); });
        state.deck = JSON.parse(init.body);
        if (state.activeId == null) state.activeId = 'seeded';
        state.rev += 1;
        return Promise.resolve({ json: async () => ({ ok: true, rev: state.rev, activeId: state.activeId }) });
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    const controls = {};
    render(<Harness fetchFn={fetchFn} controls={controls} />);
    await flush(0); // mount GET ok (server seen); seed PUT #1 dispatched, held
    // A newer edit supersedes the seed; its PUT #2 acks → 'saved'.
    await act(async () => { controls.setDeck({ ...localDeck, title: 'newer' }); });
    await flush(300);
    expect(controls.sync.status).toBe('saved');
    // Now the superseded PUT #1 rejects, late.
    await act(async () => { rejectFirstPut(); });
    await flush(0);
    expect(controls.sync.status).toBe('saved'); // NOT a false 'error'
  });

  it('AC-1.3: a rev-less (non-ignored) PUT ack reports "error" instead of wedging at "saving"', async () => {
    const state = { deck: null, rev: 0, activeId: null };
    let putBroken = false;
    const fetchFn = vi.fn((url, init) => {
      if (url.split('?')[0] === '/api/deck/state') {
        return Promise.resolve({ json: async () => ({ ...state }) });
      }
      if (init?.method === 'PUT') {
        if (putBroken) return Promise.resolve({ json: async () => ({}) }); // no rev, not ignored
        state.deck = JSON.parse(init.body);
        if (state.activeId == null) state.activeId = 'seeded';
        state.rev += 1;
        return Promise.resolve({ json: async () => ({ ok: true, rev: state.rev, activeId: state.activeId }) });
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    const controls = {};
    render(<Harness fetchFn={fetchFn} controls={controls} />);
    await flush(); // mount + healthy seed → saved
    expect(controls.sync.status).toBe('saved');
    putBroken = true;
    await act(async () => { controls.setDeck({ ...localDeck, title: 'x' }); });
    await flush(300); // PUT resolves {} — unconfirmable write
    expect(controls.sync.status).toBe('error'); // not stuck at 'saving'
  });

  it('AC-1.3: recovers "error" → "saving" → "saved" with a fresh savedAt once the server is healthy again', async () => {
    let putFails = false;
    const state = { deck: null, rev: 0, activeId: null };
    const fetchFn = vi.fn((url, init) => {
      if (url.split('?')[0] === '/api/deck/state') {
        return Promise.resolve({ json: async () => ({ ...state }) });
      }
      if (init?.method === 'PUT') {
        if (putFails) return Promise.reject(new Error('write failed'));
        state.deck = JSON.parse(init.body);
        if (state.activeId == null) state.activeId = 'seeded';
        state.rev += 1;
        return Promise.resolve({ json: async () => ({ ok: true, rev: state.rev, activeId: state.activeId }) });
      }
      return Promise.resolve({ json: async () => ({}) });
    });
    const controls = {};
    render(<Harness fetchFn={fetchFn} controls={controls} />);
    await flush(); // mount + seed acked
    const seedSavedAt = controls.sync.savedAt;
    expect(seedSavedAt).not.toBeNull();
    putFails = true;
    await act(async () => { controls.setDeck({ ...localDeck, title: 'boom' }); });
    await flush(300);
    expect(controls.sync.status).toBe('error');
    // Server healthy again: the next edit must recover (error is not sticky).
    putFails = false;
    await act(async () => { controls.setDeck({ ...localDeck, title: 'recovered' }); });
    await flush(0);
    expect(controls.sync.status).toBe('saving');
    await flush(300);
    expect(controls.sync.status).toBe('saved');
    expect(controls.sync.savedAt).toBeGreaterThan(seedSavedAt); // freshly stamped
  });

  it('stamps savedAt and reports "saved" when an external deck is adopted', async () => {
    const serverDeck = { id: 'agent', theme: 'emerald', slides: [], sections: [] };
    const srv = makeServer({ deck: serverDeck, rev: 3 });
    const controls = {};
    render(<Harness fetchFn={srv.fetchFn} controls={controls} />);
    await flush(); // mount adopts the server deck
    expect(controls.sync.status).toBe('saved');
    expect(controls.sync.savedAt).not.toBeNull();
  });
});

// AC-1.5 — the sync hook's logic must sit under the ≥90% coverage gate: the
// vitest config's coverage.include lists src/hooks/useDeckSync.js (CLAUDE.md:
// "when you add tests for more of the app, widen that include list").
describe('coverage gate config (AC-1.5)', () => {
  it('keeps src/hooks/useDeckSync.js in vitest coverage.include [AC-1.5]', async () => {
    const { readFile } = await import('node:fs/promises');
    const cfg = await readFile('vitest.config.js', 'utf8'); // vitest cwd = project root
    expect(cfg).toMatch(/['"]src\/hooks\/useDeckSync\.js['"]/);
  });
});

// AC-1.2 / AC-1.1 regression (StrictMode) — main.jsx renders under
// React.StrictMode, whose dev-mode mount→cleanup→remount permanently latched
// the `mounted` teardown guard at false, silently suppressing every status
// update in the real app while the non-StrictMode tests stayed green. Caught
// by browser verification; this pins the fix (the guard must re-arm on mount).
describe('useDeckSync under StrictMode', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports "saved" after the mount fetch and "saving"→"saved" on an edit under StrictMode [AC-1.1][AC-1.2]', async () => {
    const { StrictMode } = await import('react');
    const srv = makeServer({ deck: null, rev: 0 });
    const controls = {};
    render(<StrictMode><Harness fetchFn={srv.fetchFn} controls={controls} /></StrictMode>);
    await flush(); // mount fetch + seed PUT settle
    expect(controls.sync.status).toBe('saved'); // not stuck 'unsupported'
    await act(async () => { controls.setDeck({ ...localDeck, title: 'edited' }); });
    await flush(0);
    expect(controls.sync.status).toBe('saving');
    await flush(300); // debounce + ack
    expect(controls.sync.status).toBe('saved');
    expect(controls.sync.savedAt).not.toBeNull();
  });
});
