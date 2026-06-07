import { useEffect, useRef } from 'react';

const DEFAULT_POLL_MS = 1500;

const putInit = (deck) => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(deck),
});

/**
 * Two-way sync between the app's deck state and the in-memory MCP server.
 *
 * - On mount it reconciles once: if the server already holds a deck (an agent
 *   pre-loaded one), it adopts that; otherwise it seeds the server with the
 *   local deck.
 * - Local edits are pushed via `PUT /api/deck`; the server-assigned `rev` is
 *   remembered as "ours".
 * - It polls `GET /api/deck/state`; when the server `rev` differs from the last
 *   one we wrote, an external (MCP/agent) edit happened, so it adopts that deck
 *   via `onExternalDeck` — and suppresses the echo PUT so there's no loop.
 *
 * @param deck            the current deck (app-owned state)
 * @param onExternalDeck  stable setter invoked when an external edit is adopted
 * @param options         { intervalMs, fetchFn }
 */
export function useDeckSync(deck, onExternalDeck, options = {}) {
  const { intervalMs = DEFAULT_POLL_MS, fetchFn } = options;
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));

  const lastRev = useRef(null);     // the rev we last wrote or adopted
  const skipPush = useRef(false);   // set right before adopting, to skip the echo PUT
  const initialized = useRef(false); // becomes true after the mount reconcile
  const deckRef = useRef(deck);
  deckRef.current = deck;

  // Mount reconcile: adopt a pre-existing server deck, else seed with ours.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await doFetch('/api/deck/state');
        const data = await res.json();
        if (cancelled) return;
        if (data && typeof data.rev === 'number' && data.rev > 0 && data.deck) {
          lastRev.current = data.rev;
          skipPush.current = true;
          onExternalDeck(data.deck);
        } else {
          const put = await doFetch('/api/deck', putInit(deckRef.current));
          const body = await put.json();
          if (!cancelled && body && typeof body.rev === 'number') lastRev.current = body.rev;
        }
      } catch {
        // Server not running (static build/preview) — sync is a no-op.
      }
      if (!cancelled) initialized.current = true;
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push local edits (after the mount reconcile, and never the adopted echo).
  useEffect(() => {
    if (!initialized.current) return;
    if (skipPush.current) { skipPush.current = false; return; }
    let cancelled = false;
    doFetch('/api/deck', putInit(deck))
      .then((r) => r.json())
      .then((body) => { if (!cancelled && body && typeof body.rev === 'number') lastRev.current = body.rev; })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deck]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for external edits.
  useEffect(() => {
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const res = await doFetch('/api/deck/state');
        const data = await res.json();
        if (stopped || !data || typeof data.rev !== 'number' || !data.deck) return;
        if (data.rev !== lastRev.current) {
          lastRev.current = data.rev;
          skipPush.current = true;
          onExternalDeck(data.deck);
        }
      } catch {
        // transient — try again next tick
      }
    }, intervalMs);
    return () => { stopped = true; clearInterval(id); };
  }, [intervalMs, onExternalDeck]);
}
