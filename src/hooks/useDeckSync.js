import { useEffect, useRef } from 'react';

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
 *   pre-loaded one), it adopts that; otherwise it seeds the server with the
 *   local deck.
 * - Local edits are pushed via `PUT /api/deck`; the server-assigned `rev` is
 *   remembered as "ours".
 * - It polls `GET /api/deck/state`; when the server `rev` differs from the last
 *   one we wrote, an external (MCP/agent) edit happened, so it adopts that deck
 *   via `onExternalDeck` — skipping the echo PUT for the exact object adopted.
 *
 * `onExternalDeck` must be a stable setter that stores the passed deck object
 * by reference (e.g. a `useState` dispatcher) — the echo guard relies on object
 * identity, and an unstable callback would also rebuild the poll interval.
 *
 * @param deck            the current deck (app-owned state)
 * @param onExternalDeck  stable setter invoked when an external edit is adopted
 * @param options         { intervalMs, fetchFn }
 */
export function useDeckSync(deck, onExternalDeck, options = {}) {
  const { intervalMs = DEFAULT_POLL_MS, fetchFn } = options;
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));

  const lastRev = useRef(null);      // the rev we last wrote or saw
  const adopted = useRef(null);      // the exact deck object we last adopted (skip its echo PUT)
  const initialized = useRef(false); // becomes true after the mount reconcile

  // Adopt a deck the server reports as newer than ours.
  const adopt = (serverDeck, rev) => {
    lastRev.current = rev;
    adopted.current = serverDeck;
    onExternalDeck(serverDeck);
  };

  // Mount reconcile: adopt a pre-existing server deck, else seed with ours.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await (await doFetch('/api/deck/state')).json();
        if (cancelled) return;
        if (data && typeof data.rev === 'number' && data.rev > 0 && data.deck) {
          adopt(data.deck, data.rev);
        } else {
          const body = await (await doFetch('/api/deck', putInit(deck))).json();
          if (!cancelled && body && typeof body.rev === 'number') lastRev.current = body.rev;
        }
      } catch {
        // Server not running (static build/preview) — sync is a no-op.
      }
      if (!cancelled) initialized.current = true;
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push local edits (after the mount reconcile, never the adopted echo).
  useEffect(() => {
    if (!initialized.current || deck === adopted.current) return;
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
        const data = await (await doFetch('/api/deck/state')).json();
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
  }, [intervalMs, onExternalDeck]);
}
