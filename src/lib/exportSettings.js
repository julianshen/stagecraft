// Settings → Export defaults persistence: SettingsView writes it; the export
// dialog reads it to preselect its options. Only what the dialog can honor is
// stored — formats it can't produce yet, quality and burned-in extras are not.
export const EXPORT_STORAGE_KEY = 'stagecraft.export';

export const EXPORT_FORMATS = Object.freeze(['pptx', 'pdf']);

export const EXPORT_DEFAULTS = Object.freeze({ format: 'pptx', includeNotes: true });

const VALID = {
  format: (v) => EXPORT_FORMATS.includes(v),
  includeNotes: (v) => typeof v === 'boolean',
};

// The persisted defaults, each key falling back when absent, invalid, or the
// store is unreadable; unknown keys are dropped.
export function readExportSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(EXPORT_STORAGE_KEY)) || {};
  } catch { /* unavailable storage / malformed JSON → defaults */ }
  return Object.fromEntries(Object.entries(EXPORT_DEFAULTS).map(
    ([k, dflt]) => [k, VALID[k](stored[k]) ? stored[k] : dflt],
  ));
}
