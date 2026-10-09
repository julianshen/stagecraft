// One persisted-settings contract for every Settings group: a localStorage key,
// frozen defaults, and a per-key validator. `read()` returns exactly the default
// keys, each falling back when absent, invalid, or the store is unreadable
// (unknown/legacy keys are dropped); `write(values)` persists, ignoring storage
// failures (the in-memory state stays authoritative for the session).
export function createSettingsStore(key, defaults, valid) {
  const read = () => {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(key)) || {};
    } catch { /* unavailable storage / malformed JSON → defaults */ }
    return Object.fromEntries(Object.entries(defaults).map(
      ([k, dflt]) => [k, valid[k](stored[k]) ? stored[k] : dflt],
    ));
  };
  const write = (values) => {
    try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* storage unavailable */ }
  };
  return { key, defaults, read, write };
}
