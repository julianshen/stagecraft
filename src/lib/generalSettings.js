// Settings→General persistence: SettingsView writes it; the canvas surfaces
// read it (CanvasSlide gates grid snapping, Ruler gates itself). The key,
// defaults, and reader are single-sourced here so the writer and the readers
// can never disagree.
export const GENERAL_STORAGE_KEY = 'stagecraft.general';

// Both default ON — the canvas behaved this way before the toggles existed, so
// an absent/malformed store preserves today's behavior.
export const GENERAL_DEFAULTS = Object.freeze({
  snapToGrid: true,
  showRulers: true,
});

// The persisted `{ snapToGrid, showRulers }` booleans. Each key falls back to
// its default when the store is absent, unreadable, malformed JSON, or carries
// a non-boolean value; legacy inert keys are dropped, not carried.
export function readGeneralSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(GENERAL_STORAGE_KEY)) || {};
  } catch { /* unavailable storage / malformed JSON → defaults */ }
  return Object.fromEntries(Object.entries(GENERAL_DEFAULTS).map(
    ([k, dflt]) => [k, typeof stored[k] === 'boolean' ? stored[k] : dflt],
  ));
}
