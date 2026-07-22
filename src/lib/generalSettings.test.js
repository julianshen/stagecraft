import { describe, it, expect, vi } from 'vitest';
import { stubLocalStorage } from '../test/localStorage.js';
import { GENERAL_STORAGE_KEY, GENERAL_DEFAULTS, readGeneralSettings } from './generalSettings.js';

const store = stubLocalStorage();

describe('readGeneralSettings', () => {
  it('exposes the storage key SettingsView writes (the shared contract)', () => {
    expect(GENERAL_STORAGE_KEY).toBe('stagecraft.general');
  });

  it('defaults both toggles to true when nothing is stored', () => {
    expect(readGeneralSettings()).toEqual({ snapToGrid: true, showRulers: true });
  });

  it('returns stored false values', () => {
    store.set(GENERAL_STORAGE_KEY, JSON.stringify({ snapToGrid: false, showRulers: false }));
    expect(readGeneralSettings()).toEqual({ snapToGrid: false, showRulers: false });
  });

  it('defaults a key missing from a partial stored object', () => {
    store.set(GENERAL_STORAGE_KEY, JSON.stringify({ showRulers: false }));
    expect(readGeneralSettings()).toEqual({ snapToGrid: true, showRulers: false });
  });

  it('falls back to the defaults on malformed JSON', () => {
    store.set(GENERAL_STORAGE_KEY, '{not json');
    expect(readGeneralSettings()).toEqual(GENERAL_DEFAULTS);
  });

  it('falls back to the defaults on a stored non-object', () => {
    store.set(GENERAL_STORAGE_KEY, 'null');
    expect(readGeneralSettings()).toEqual(GENERAL_DEFAULTS);
  });

  it('treats a non-boolean stored value as absent (defaults true)', () => {
    store.set(GENERAL_STORAGE_KEY, JSON.stringify({ snapToGrid: 'no', showRulers: 0 }));
    expect(readGeneralSettings()).toEqual({ snapToGrid: true, showRulers: true });
  });

  it('returns only the live keys (legacy inert keys are dropped)', () => {
    store.set(GENERAL_STORAGE_KEY, JSON.stringify({ snapToGrid: false, autosave: false, language: 'fr-FR' }));
    expect(readGeneralSettings()).toEqual({ snapToGrid: false, showRulers: true });
  });

  it('falls back to the defaults when storage itself throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); } });
    expect(readGeneralSettings()).toEqual(GENERAL_DEFAULTS);
  });

  it('falls back to the defaults when localStorage is unavailable entirely', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readGeneralSettings()).toEqual(GENERAL_DEFAULTS);
  });
});
