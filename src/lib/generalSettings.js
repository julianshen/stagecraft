// Settings → General persistence: SettingsView writes it; the canvas surfaces
// read it (CanvasSlide gates grid snapping, Ruler gates itself, the status bar
// reports both) and the presenter reads the talk target.
import { createSettingsStore } from './storedSettings.js';

export const MAX_PRESENT_TARGET = 600; // minutes

const isTargetMinutes = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_PRESENT_TARGET;

// Both toggles default ON — the canvas behaved this way before the toggles
// existed, so an absent/malformed store preserves today's behavior.
// `presentTarget` is the presenter's talk target in whole minutes; 0 = none.
export const generalSettings = createSettingsStore(
  'stagecraft.general',
  Object.freeze({ snapToGrid: true, showRulers: true, presentTarget: 0 }),
  {
    snapToGrid: (v) => typeof v === 'boolean',
    showRulers: (v) => typeof v === 'boolean',
    presentTarget: isTargetMinutes,
  },
);

export const GENERAL_STORAGE_KEY = generalSettings.key;
export const GENERAL_DEFAULTS = generalSettings.defaults;
export const readGeneralSettings = generalSettings.read;

// A typed talk target → whole minutes in [0, MAX_PRESENT_TARGET]; empty or
// unparseable means none (0).
export function toTargetMinutes(raw) {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.min(MAX_PRESENT_TARGET, Math.max(0, n)) : 0;
}
