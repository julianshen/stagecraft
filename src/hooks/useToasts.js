import { useCallback, useEffect, useRef, useState } from 'react';

// Default time a toast stays on screen before auto-dismissing (ms).
export const TOAST_DURATION = 5000;
// Cap the visible stack so a runaway producer can't pile up unbounded; the
// oldest toasts fall off the top.
export const MAX_TOASTS = 4;

// A tiny transient-notification queue. `notify` pushes a message (with an
// optional tone) and returns its id; `dismiss` removes one by id. Toasts
// auto-dismiss after TOAST_DURATION. State only — pair with <Toaster> for the UI.
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const notify = useCallback((message, { tone = 'info' } = {}) => {
    const id = ++idRef.current;
    setToasts((ts) => [...ts, { id, message, tone }].slice(-MAX_TOASTS));
    timersRef.current.set(id, setTimeout(() => dismiss(id), TOAST_DURATION));
    // Evict timers for any toasts the cap just dropped (Map keeps insertion
    // order, so the oldest entries are first) — otherwise they'd fire a late
    // no-op dismiss after their row is already gone.
    while (timersRef.current.size > MAX_TOASTS) {
      const [oldId, oldTimer] = timersRef.current.entries().next().value;
      clearTimeout(oldTimer);
      timersRef.current.delete(oldId);
    }
    return id;
  }, [dismiss]);

  // Clear any pending timers on unmount so they can't fire into a dead component.
  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
  }, []);

  return { toasts, notify, dismiss };
}
