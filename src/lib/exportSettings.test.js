import { describe, it, expect, vi } from 'vitest';
import { stubLocalStorage } from '../test/localStorage.js';
import { EXPORT_STORAGE_KEY, EXPORT_DEFAULTS, readExportSettings } from './exportSettings.js';

const store = stubLocalStorage();

describe('readExportSettings', () => {
  it('uses its own storage key', () => {
    expect(EXPORT_STORAGE_KEY).toBe('stagecraft.export');
  });

  it('defaults to PPTX with speaker notes', () => {
    expect(readExportSettings()).toEqual({ format: 'pptx', includeNotes: true });
    expect(EXPORT_DEFAULTS).toEqual({ format: 'pptx', includeNotes: true });
  });

  it('returns stored, valid values', () => {
    store.set(EXPORT_STORAGE_KEY, JSON.stringify({ format: 'pdf', includeNotes: false }));
    expect(readExportSettings()).toEqual({ format: 'pdf', includeNotes: false });
  });

  it('accepts only formats the export dialog can produce', () => {
    store.set(EXPORT_STORAGE_KEY, JSON.stringify({ format: 'key', includeNotes: 'no' }));
    expect(readExportSettings()).toEqual(EXPORT_DEFAULTS);
  });

  it('drops unknown keys and survives malformed or unavailable storage', () => {
    store.set(EXPORT_STORAGE_KEY, JSON.stringify({ quality: 'max', format: 'pdf' }));
    expect(readExportSettings()).toEqual({ format: 'pdf', includeNotes: true });
    store.set(EXPORT_STORAGE_KEY, '{bad');
    expect(readExportSettings()).toEqual(EXPORT_DEFAULTS);
    vi.stubGlobal('localStorage', undefined);
    expect(readExportSettings()).toEqual(EXPORT_DEFAULTS);
  });
});
