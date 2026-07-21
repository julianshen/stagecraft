import { useEffect, useRef, useState, useCallback } from 'react';

const DEFAULT_POLL_MS = 1500;
const DEFAULT_PUSH_DEBOUNCE_MS = 300;

function putInit(deck) {
  return {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deck),
  };
}

/**
 * Two-way sync between the app's deck state and the in-memory MCP server.
 *
 * - On mount it reconciles once: if the server already holds a deck (an agent
 *   pre-loaded one) it adopts that; otherwise the push effect seeds ours.
 * - Local edits are pushed via `PUT /api/deck`, debounced (trailing,
 *   `pushDebounceMs`) so per-keystroke editing — the inspector Data tab, the
 *   Co-pilot — coalesces into one write per pause instead of one per character.
 *   Only the very first push (the seed, when the server holds nothing) is
 *   immediate, so a fresh deck is visible to agents right away. The
 *   server-assigned `rev` is remembered as "ours".
 * - It polls `GET /api/deck/state`; when the server `rev` differs from the last
 *   one we wrote, an external (MCP/agent) edit happened, so it adopts that deck
 *   via `onExternalDeck` — skipping the echo PUT for the exact object adopted.
 *
 * Seeding is just the push effect's first run after `initialized` flips, so it
 * always pushes the *current* deck — an edit made while the mount request was
 * still in flight is seeded correctly, not the stale mount-time deck.
 *
 * `onExternalDeck` should store the deck by reference (e.g. a `useState`
 * setter); the echo guard relies on object identity. `fetchFn`/`onExternalDeck`
 * may change between renders without disrupting the poll interval.
 *
 * Alongside the sync itself it exposes an honest save-status for the UI:
 *   - 'unsupported' — the mount `GET /api/deck/state` never succeeded (a static
 *     build/preview has no `/api` middleware). A missing server is NOT an error,
 *     so a later failed PUT in this mode stays 'unsupported'.
 *   - 'saving'      — local edits diverge from the last acked state and a PUT is
 *     debounce-pending or in flight (set the moment the push effect schedules).
 *   - 'saved'       — the last local edit was acknowledged (a PUT committed with
 *     the rev advanced), or a server deck was adopted (server-authoritative).
 *   - 'error'       — the server was seen at least once, then a PUT rejected.
 * `savedAt` is `Date.now()` stamped on a confirmed commit (a PUT that resolved
 * with a rev, not `body.ignored`) or an adopt; it is `null` before the first ack.
 * These are React state so consumers re-render; every async setter is guarded by
 * a mounted ref (StrictMode/teardown-safe, like the effects' cancelled flags).
 *
 * @param deck            the current deck (app-owned state)
 * @param onExternalDeck  setter invoked when an external edit is adopted
 * @param options         { intervalMs, fetchFn }
 * @returns { adopt, status, savedAt }
 */
export function useDeckSync(deck, onExternalDeck, options = {}) {
  const { intervalMs = DEFAULT_POLL_MS, pushDebounceMs = DEFAULT_PUSH_DEBOUNCE_MS, fetchFn } = options;

  // Keep the latest fetch + callback in refs so the effects stay stable (the
  // poll interval isn't torn down when an inline fetchFn/callback is passed).
  const fetchRef = useRef(null);
  fetchRef.current = fetchFn || ((...a) => globalThis.fetch(...a));
  const onExternalRef = useRef(onExternalDeck);
  onExternalRef.current = onExternalDeck;

  const lastRev = useRef(null);  // the rev we last wrote or saw
  const seeded = useRef(false);  // first push dispatched (flips synchronously, even if it fails)
  const adopted = useRef(null);  // the exact deck object we last adopted (skip its echo PUT)
  const adoptedRev = useRef(null); // the rev at which we adopted it (the echo guard is valid only until we push something newer)
  const activeId = useRef(null); // the deck our writes are for (tags PUTs so a stale write can't clobber a switched deck)
  const [initialized, setInitialized] = useState(false);

  // Honest save-status surfaced to the UI (see the JSDoc for the state machine).
  const [status, setStatus] = useState('unsupported');
  const [savedAt, setSavedAt] = useState(null);
  const serverSeen = useRef(false); // did the mount state fetch ever succeed?
  const mounted = useRef(true);     // guards async setState after teardown
  useEffect(() => () => { mounted.current = false; }, []);

  const adopt = useCallback((serverDeck, rev, forId) => {
    lastRev.current = rev;
    adopted.current = serverDeck;
    adoptedRev.current = rev;
    if (forId !== undefined) activeId.current = forId;
    onExternalRef.current(serverDeck);
    // Adopting is server-authoritative: the local state now matches the server,
    // so it counts as a confirmed save.
    if (mounted.current) { setStatus('saved'); setSavedAt(Date.now()); }
  }, []);

  // Mount reconcile: adopt a pre-existing server deck, then mark initialized so
  // the push effect can seed (when we didn't adopt) or stay quiet (when we did).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await (await fetchRef.current('/api/deck/state')).json();
        // The GET resolving proves the `/api` middleware is present — leave
        // 'unsupported' behind. A deck present is adopted (which stamps 'saved');
        // an empty server settles to 'saved' too (nothing local has diverged yet).
        if (!cancelled) serverSeen.current = true;
        // Any deck the server already holds wins — including one preloaded at
        // rev 0 (createDeckStore(initialDeck) or a future durable load). Its
        // presence, not the rev, distinguishes a loaded server from an empty one.
        if (!cancelled && data && typeof data.rev === 'number') {
          if (data.activeId !== undefined) activeId.current = data.activeId;
          if (data.deck) adopt(data.deck, data.rev, data.activeId);
        }
        if (!cancelled && mounted.current) setStatus((s) => (s === 'unsupported' ? 'saved' : s));
      } catch {
        // Server not running (static build/preview) — sync is a no-op and the
        // status stays 'unsupported' (a missing server is never an 'error').
      }
      if (!cancelled) setInitialized(true);
    })();
    return () => { cancelled = true; };
  }, [adopt]);

  // Push the current deck once initialized, and on every later local edit —
  // skipping the exact object we just adopted so there's no echo loop. Edits
  // after the first push are debounced (trailing). `seeded` flips when the
  // first push is DISPATCHED (not when it responds), so the debounce engages
  // even while the seed is in flight or when the server is unreachable.
  // Loss windows (both consistent with the last-write-wins policy): an edit
  // made within pushDebounceMs of (a) the tab closing, or (b) an adopt that
  // supersedes it — a deck switch, or an external edit picked up by the poll —
  // is dropped with the pending timer rather than pushed. (b) only bites a
  // *buffer* of edits during sustained typing, since an isolated edit's timer
  // fires well before any UI-driven deck switch.
  useEffect(() => {
    // Skip the echo PUT for the deck we just adopted — but ONLY while it's the
    // freshly-adopted deck and nothing local has diverged from it yet. The first
    // time `deck` differs from the adopted reference (any local edit), drop that
    // suppression for good (`adoptedRev = null`) — otherwise an undo/redo that
    // lands back on the adopted object's reference would be wrongly swallowed,
    // even in the window before the prior edit's PUT acks. (No timing dependence,
    // so it's StrictMode-idempotent.)
    if (!initialized) return;
    if (deck !== adopted.current) adoptedRev.current = null;
    if (deck === adopted.current && lastRev.current === adoptedRev.current) return;
    let cancelled = false; // a newer edit/adopt has superseded this push
    // We are about to push (seed or debounced edit): the local state diverges
    // from the last ack. Only report 'saving' when a server was actually seen —
    // in 'unsupported' mode (no `/api` middleware) every PUT is a doomed no-op,
    // so surfacing 'saving'/'error' there would be dishonest.
    if (serverSeen.current && mounted.current) setStatus('saving');
    const push = () => {
      // Tag the write with the deck it's for so the server drops it if the active
      // deck has since switched (prevents a stale PUT clobbering a just-opened deck).
      const url = activeId.current != null ? `/api/deck?forId=${encodeURIComponent(activeId.current)}` : '/api/deck';
      fetchRef.current(url, putInit(deck))
        .then((r) => r.json())
        .then((body) => {
          if (!body) return;
          // Learn the active id (e.g. right after a seed created it) so the very
          // next edit is tagged without waiting for a poll — but ONLY if this push
          // hasn't been superseded. A delayed ack from a write for the old deck
          // must not drag activeId back after a switch, or the first edit to the
          // new deck would be PUT with the stale forId and dropped by the server.
          if (!cancelled && body.activeId !== undefined) activeId.current = body.activeId;
          // A dropped (stale-tagged) write didn't take effect — don't advance
          // lastRev, or the next poll would skip adopting the actually-active deck.
          if (body.ignored) return;
          // Record the rev even for a superseded (cancelled) write: it still
          // COMMITTED, so the rev is "ours" — skipping it would let the next poll
          // mistake our own write for an external edit and adopt it over live
          // typing. Advance MONOTONICALLY so a late ack can't drag lastRev below a
          // newer write's rev that already landed. (Refs only, never React state,
          // so it's safe after teardown.)
          if (typeof body.rev === 'number' && (lastRev.current === null || body.rev > lastRev.current)) {
            lastRev.current = body.rev;
          }
          // A confirmed commit (rev present, not dropped) stamps savedAt. Only
          // the LATEST push (not one superseded by a newer edit) settles the
          // status to 'saved' — a superseded write isn't the "last edit", and a
          // newer push has already re-set 'saving'.
          if (typeof body.rev === 'number' && mounted.current) {
            setSavedAt(Date.now());
            if (!cancelled) setStatus('saved');
          }
        })
        .catch(() => {
          // The server was reachable at mount but this write failed — a real,
          // reportable error (distinct from the never-had-a-server 'unsupported').
          if (serverSeen.current && mounted.current) setStatus('error');
        });
    };
    if (!seeded.current && lastRev.current === null) {
      seeded.current = true;
      push();
      return () => { cancelled = true; };
    }
    const t = setTimeout(push, pushDebounceMs);
    return () => { cancelled = true; clearTimeout(t); };
  }, [deck, initialized, pushDebounceMs]);

  // Poll for external edits.
  useEffect(() => {
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const data = await (await fetchRef.current('/api/deck/state')).json();
        if (stopped) return;
        if (data && data.activeId !== undefined) activeId.current = data.activeId; // keep our write tag current
        if (!data || typeof data.rev !== 'number' || data.rev === lastRev.current) return;
        // rev changed: keep lastRev in step even on a server reset (rev → 0 with
        // no deck, e.g. a dev-server restart) so later edits aren't missed.
        lastRev.current = data.rev;
        if (data.deck) adopt(data.deck, data.rev, data.activeId);
      } catch {
        // transient — try again next tick
      }
    }, intervalMs);
    return () => { stopped = true; clearInterval(id); };
  }, [intervalMs, adopt]);

  // Expose `adopt` so callers that already hold an authoritative server deck+rev
  // (e.g. opening a deck via POST /api/decks/:id/activate) can adopt it directly
  // — marking it as ours so the push effect doesn't echo it back as a fresh edit.
  // `status`/`savedAt` let the UI report the sync state honestly.
  return { adopt, status, savedAt };
}
