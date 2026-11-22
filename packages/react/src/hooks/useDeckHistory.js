import { useCallback, useState } from 'react';

// Cap the undo depth so a long session can't grow the snapshot stack unbounded.
export const MAX_HISTORY = 50;
// Edits landing within this window of the previous one coalesce into the same
// undo step, so typing a word is one undo (not one-per-keystroke). Drags already
// commit once on pointer-up; this mainly groups per-keystroke text edits.
export const COALESCE_MS = 500;

// Undo/redo over the app's deck state. Deck updaters already return fresh
// immutable objects, so each snapshot is a distinct frozen-in-time reference —
// the stack stores references, no cloning needed.
//
// Two setters by design (see App wiring):
//   - `commit`  records an edit (undoable), coalescing rapid bursts.
//   - `reset`   replaces the deck WITHOUT history (deck open / external MCP
//               adoption) — you can't sanely undo across a different document.
export function useDeckHistory(initial) {
  const [hist, setHist] = useState(() => ({
    past: [],
    present: typeof initial === 'function' ? initial() : initial,
    future: [],
    at: null, // timestamp of the last commit (null = none / boundary), drives coalescing
  }));

  // `now` is read once per call (outside the updater) so the updater stays pure
  // and StrictMode's double-invocation is identical.
  const commit = useCallback((updater) => {
    const now = Date.now();
    setHist((h) => {
      const next = typeof updater === 'function' ? updater(h.present) : updater;
      if (next === h.present) return h; // no-op edit — don't record
      const sameStep = h.at !== null && now - h.at <= COALESCE_MS;
      return {
        past: sameStep ? h.past : [...h.past, h.present].slice(-MAX_HISTORY),
        present: next,
        future: [],
        at: now,
      };
    });
  }, []);

  const undo = useCallback(() => setHist((h) => {
    if (!h.past.length) return h;
    return {
      past: h.past.slice(0, -1),
      present: h.past[h.past.length - 1],
      future: [h.present, ...h.future],
      at: null, // a post-undo edit starts a fresh step, never coalesces into the undone burst
    };
  }), []);

  const redo = useCallback(() => setHist((h) => {
    if (!h.future.length) return h;
    return {
      past: [...h.past, h.present],
      present: h.future[0],
      future: h.future.slice(1),
      at: null,
    };
  }), []);

  const reset = useCallback((deck) => {
    setHist({ past: [], present: deck, future: [], at: null });
  }, []);

  return {
    deck: hist.present,
    commit,
    undo,
    redo,
    reset,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
  };
}
