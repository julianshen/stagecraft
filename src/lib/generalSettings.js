// Settings→General persistence: SettingsView writes it; the canvas surfaces
// read it (CanvasSlide gates grid snapping, Ruler gates itself, the status bar
// reports both) and the presenter reads the talk target. The key,
// defaults, and reader are single-sourced here so the writer and the readers
// can never disagree.
export const GENERAL_STORAGE_KEY = 'stagecraft.general';

// Both toggles default ON — the canvas behaved this way before the toggles
// existed, so an absent/malformed store preserves today's behavior.
// `presentTarget` is the presenter's talk target in whole minutes; 0 = none.
export const GENERAL_DEFAULTS = Object.freeze({
  snapToGrid: true,
  showRulers: true,
  presentTarget: 0,
});

export const MAX_PRESENT_TARGET = 600; // minutes

// Per-key validators: a stored value is kept only when its default's validator
// accepts it.
const VALID = {
  snapToGrid: (v) => typeof v === 'boolean',
  showRulers: (v) => typeof v === 'boolean',
  presentTarget: (v) => Number.isInteger(v) && v >= 0 && v <= MAX_PRESENT_TARGET,
};

// The persisted settings. Each key falls back to its default when the store is
// absent, unreadable, malformed JSON, or carries an invalid value; legacy inert
// keys are dropped, not carried.
export function readGeneralSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(GENERAL_STORAGE_KEY)) || {};
  } catch { /* unavailable storage / malformed JSON → defaults */ }
  return Object.fromEntries(Object.entries(GENERAL_DEFAULTS).map(
    ([k, dflt]) => [k, VALID[k](stored[k]) ? stored[k] : dflt],
  ));
}
