import { describe, it, expect, vi } from 'vitest';
import { stubLocalStorage } from '../test/localStorage.js';
import { createSettingsStore } from './storedSettings.js';

const store = stubLocalStorage();
const s = createSettingsStore('k', { on: true, n: 1 }, {
  on: (v) => typeof v === 'boolean',
  n: (v) => Number.isInteger(v),
});

describe('createSettingsStore', () => {
  it('reads defaults, valid stored values, and drops invalid or unknown keys', () => {
    expect(s.read()).toEqual({ on: true, n: 1 });
    store.set('k', JSON.stringify({ on: false, n: 'x', extra: 1 }));
    expect(s.read()).toEqual({ on: false, n: 1 });
  });

  it('round-trips through write', () => {
    s.write({ on: false, n: 7 });
    expect(s.read()).toEqual({ on: false, n: 7 });
  });

  it('survives malformed JSON and unavailable storage on read and write', () => {
    store.set('k', '{bad');
    expect(s.read()).toEqual({ on: true, n: 1 });
    vi.stubGlobal('localStorage', undefined);
    expect(s.read()).toEqual({ on: true, n: 1 });
    expect(() => s.write({ on: true, n: 1 })).not.toThrow();
  });
});
