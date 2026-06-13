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
 *   The very first push (the seed, when the server holds nothing) is immediate
 *   so a fresh deck is visible to agents right away. The server-assigned `rev`
 *   is remembered as "ours".
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
 * @param deck            the current deck (app-owned state)
 * @param onExternalDeck  setter invoked when an external edit is adopted
 * @param options         { intervalMs, fetchFn }
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
  const adopted = useRef(null);  // the exact deck object we last adopted (skip its echo PUT)
  const activeId = useRef(null); // the deck our writes are for (tags PUTs so a stale write can't clobber a switched deck)
  const [initialized, setInitialized] = useState(false);

  const adopt = useCallback((serverDeck, rev, forId) => {
    lastRev.current = rev;
    adopted.current = serverDeck;
    if (forId !== undefined) activeId.current = forId;
    onExternalRef.current(serverDeck);
  }, []);

  // Mount reconcile: adopt a pre-existing server deck, then mark initialized so
  // the push effect can seed (when we didn't adopt) or stay quiet (when we did).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await (await fetchRef.current('/api/deck/state')).json();
        // Any deck the server already holds wins — including one preloaded at
        // rev 0 (createDeckStore(initialDeck) or a future durable load). Its
        // presence, not the rev, distinguishes a loaded server from an empty one.
        if (!cancelled && data && typeof data.rev === 'number') {
          if (data.activeId !== undefined) activeId.current = data.activeId;
          if (data.deck) adopt(data.deck, data.rev, data.activeId);
        }
      } catch {
        // Server not running (static build/preview) — sync is a no-op.
      }
      if (!cancelled) setInitialized(true);
    })();
    return () => { cancelled = true; };
  }, [adopt]);

  // Push the current deck once initialized, and on every later local edit —
  // skipping the exact object we just adopted so there's no echo loop. Edits
  // are debounced (trailing): a new edit inside the window cancels the pending
  // push and restarts it with the fresher deck, so rapid typing costs one PUT.
  // The seed (nothing written or seen yet — lastRev null) goes out immediately.
  useEffect(() => {
    if (!initialized || deck === adopted.current) return;
    let cancelled = false;
    const push = () => {
      // Tag the write with the deck it's for so the server drops it if the active
      // deck has since switched (prevents a stale PUT clobbering a just-opened deck).
      const url = activeId.current != null ? `/api/deck?forId=${encodeURIComponent(activeId.current)}` : '/api/deck';
      fetchRef.current(url, putInit(deck))
        .then((r) => r.json())
        .then((body) => {
          if (cancelled || !body) return;
          // Learn the active id from the write response (e.g. right after a seed
          // created it) so the very next edit is tagged without waiting for a poll.
          if (body.activeId !== undefined) activeId.current = body.activeId;
          // A dropped (stale-tagged) write didn't take effect — don't advance
          // lastRev, or the next poll would skip adopting the actually-active deck.
          if (body.ignored) return;
          if (typeof body.rev === 'number') lastRev.current = body.rev;
        })
        .catch(() => {});
    };
    if (lastRev.current === null) { push(); return () => { cancelled = true; }; }
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
  return adopt;
}
