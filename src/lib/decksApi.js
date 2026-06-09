// Client for the multi-deck library API (see src/server/api.js). Thin fetch
// wrappers plus pure helpers that turn a deck's metadata into card view-model
// bits for the Home grid. `fetchFn` is injectable for tests.

const THEME_TINT = {
  indigo: 'oklch(0.62 0.17 265)',
  emerald: 'oklch(0.67 0.14 155)',
  amber: 'oklch(0.7 0.14 75)',
  coral: 'oklch(0.62 0.17 25)',
  magenta: 'oklch(0.6 0.18 335)',
  slate: 'oklch(0.55 0.05 260)',
};

// A deck cover tint from its theme (falls back to indigo for unknown/missing).
export function themeTint(theme) {
  return THEME_TINT[theme] || THEME_TINT.indigo;
}

// Up to three uppercase initials for a deck cover badge.
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '??';
  return words.slice(0, 3).map((w) => w[0].toUpperCase()).join('');
}

// Compact "edited" label from a timestamp (just now / Nm / Nh / Nd / Nw / Nmo).
export function relativeTime(ms, now = Date.now()) {
  const t = Number(ms);
  if (!Number.isFinite(t)) return '—';
  const sec = Math.floor(Math.max(0, now - t) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  return `${Math.floor(day / 30)}mo`;
}

// Parse a successful JSON response, throwing on a non-2xx status so callers'
// error handling fires instead of an error body silently parsing as data.
async function jsonOrThrow(res, label) {
  if (!res.ok) throw new Error(`${label}: ${res.status}`);
  return res.json();
}

export async function listDecks(fetchFn = globalThis.fetch) {
  return jsonOrThrow(await fetchFn('/api/decks'), 'listDecks');
}

export async function createDeck(name, fetchFn = globalThis.fetch) {
  const res = await fetchFn('/api/decks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  });
  return jsonOrThrow(res, 'createDeck');
}

// Activate a deck by id; the server returns { deck, rev } for the client to adopt.
export async function openDeck(id, fetchFn = globalThis.fetch) {
  const res = await fetchFn(`/api/decks/${encodeURIComponent(id)}/activate`, { method: 'POST' });
  return jsonOrThrow(res, 'openDeck');
}
