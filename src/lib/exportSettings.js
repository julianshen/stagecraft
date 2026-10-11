// Settings → Export defaults: SettingsView writes it; the export dialog reads it
// to preselect its options. Only what the dialog can honor is stored — formats it
// can't produce yet, quality and burned-in extras are not.
import { createSettingsStore } from './storedSettings.js';

export const exportSettings = createSettingsStore(
  'stagecraft.export',
  Object.freeze({ format: 'pptx', includeNotes: true }),
  {
    format: (v) => v === 'pptx' || v === 'pdf',
    includeNotes: (v) => typeof v === 'boolean',
  },
);

export const EXPORT_STORAGE_KEY = exportSettings.key;
export const EXPORT_DEFAULTS = exportSettings.defaults;
export const readExportSettings = exportSettings.read;
