import { useEffect, useRef, useState, useCallback } from 'react';

const DEFAULT_POLL_MS = 1500;

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
 * - Local edits are pushed via `PUT /api/deck`; the server-assigned `rev` is
 *   remembered as "ours".
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
  const { intervalMs = DEFAULT_POLL_MS, fetchFn } = options;

  // Keep the latest fetch + callback in refs so the effects stay stable (the
  // poll interval isn't torn down when an inline fetchFn/callback is passed).
  const fetchRef = useRef(null);
  fetchRef.current = fetchFn || ((...a) => globalThis.fetch(...a));
  const onExternalRef = useRef(onExternalDeck);
  onExternalRef.current = onExternalDeck;

  const lastRev = useRef(null);  // the rev we last wrote or saw
  const adopted = useRef(null);  // the exact deck object we last adopted (skip its echo PUT)
  const [initialized, setInitialized] = useState(false);

  const adopt = useCallback((serverDeck, rev) => {
    lastRev.current = rev;
    adopted.current = serverDeck;
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
        if (!cancelled && data && typeof data.rev === 'number' && data.deck) {
          adopt(data.deck, data.rev);
        }
      } catch {
        // Server not running (static build/preview) — sync is a no-op.
      }
      if (!cancelled) setInitialized(true);
    })();
    return () => { cancelled = true; };
  }, [adopt]);

  // Push the current deck once initialized, and on every later local edit —
  // skipping the exact object we just adopted so there's no echo loop.
  useEffect(() => {
    if (!initialized || deck === adopted.current) return;
    let cancelled = false;
    fetchRef.current('/api/deck', putInit(deck))
      .then((r) => r.json())
      .then((body) => { if (!cancelled && body && typeof body.rev === 'number') lastRev.current = body.rev; })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deck, initialized]);

  // Poll for external edits.
  useEffect(() => {
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const data = await (await fetchRef.current('/api/deck/state')).json();
        if (stopped || !data || typeof data.rev !== 'number' || data.rev === lastRev.current) return;
        // rev changed: keep lastRev in step even on a server reset (rev → 0 with
        // no deck, e.g. a dev-server restart) so later edits aren't missed.
        lastRev.current = data.rev;
        if (data.deck) adopt(data.deck, data.rev);
      } catch {
        // transient — try again next tick
      }
    }, intervalMs);
    return () => { stopped = true; clearInterval(id); };
  }, [intervalMs, adopt]);
}
