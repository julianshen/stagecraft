import { vi, beforeEach, afterEach } from 'vitest';

// jsdom in vitest doesn't expose localStorage unless --localstorage-file is
// set. Call this at a test file's top level: it installs a Map-backed stub
// (fresh per test) and returns the backing store for seeding/asserting.
export function stubLocalStorage() {
  const store = new Map();
  const mock = {
    getItem:    (k) => store.has(k) ? store.get(k) : null,
    setItem:    (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear:      () => store.clear(),
  };
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', mock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  return store;
}
