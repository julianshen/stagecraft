export function getFlatSlideIds(deck) {
  if (!deck) return [];
  const flat = [];
  (deck.sections || []).forEach(sec => (sec?.slides || []).forEach(sid => flat.push(sid)));
  return flat;
}

/**
 * Decide which slide should be selected after the deck changes.
 *
 * @param flat     flattened slide-id order of the new deck (getFlatSlideIds)
 * @param curId    the currently-selected slide id (or null)
 * @param deleting { id, idx } when the change was the editor deleting `id` at
 *                 flat position `idx`, else null
 * @returns the slide id to select (or null)
 *
 * - On a local delete of the selected slide, keep the position (the slide that
 *   slid into `idx`, else the previous one).
 * - If the selected slide vanished for any other reason — e.g. a live MCP/agent
 *   edit removed it — fall back to the first slide.
 * - Otherwise leave the selection unchanged.
 */
// Keys a slide patch may never set: the immutable id and prototype-pollution
// vectors. The patch is untrusted LLM output, so we sanitize before merging.
const UNSAFE_PATCH_KEYS = new Set(['id', '__proto__', 'constructor', 'prototype']);

// Slide fields that must be arrays. A patch that sets one of these to a truthy
// non-array (e.g. `items: "one\ntwo"`) is dropped so the malformed shape never
// persists and breaks a downstream consumer (renderer, PPTX export). `rows` is
// stricter: each row must itself be an array of cells (the renderer/exporter do
// `row.map(...)`), so a flat `['North','South']` is rejected too.
const ARRAY_SLIDE_FIELDS = new Set(['items', 'kpis', 'stats', 'columns']);

// Accept a patch field only if its value matches the slide schema's shape:
// array collections are validated as arrays (rows as an array of row arrays),
// and every other field must be a primitive — an object/array for a scalar
// field (e.g. `title: { text }`) would crash React's "object as child" render.
function fieldOk(key, value) {
  if (key === 'rows') return Array.isArray(value) && value.every((row) => Array.isArray(row));
  if (ARRAY_SLIDE_FIELDS.has(key)) return Array.isArray(value);
  return value === null || typeof value !== 'object';
}

/**
 * Merge a partial-slide `patch` into the slide `curId` (used to apply AI edits).
 * The slide id is immutable, unsafe keys and malformed (non-array) collection
 * fields are dropped; every other field overrides. Returns a new deck
 * (immutable) or the deck unchanged when there's nothing to do.
 */
export function applySlidePatch(deck, curId, patch) {
  if (!deck || !curId || !patch) return deck;
  const safe = {};
  for (const [k, v] of Object.entries(patch)) {
    if (UNSAFE_PATCH_KEYS.has(k)) continue;
    if (!fieldOk(k, v)) continue;
    safe[k] = v;
  }
  return {
    ...deck,
    slides: (deck.slides || []).map((s) => (s.id === curId ? { ...s, ...safe } : s)),
  };
}

export function reconcileCurId(flat, curId, deleting) {
  if (deleting && curId === deleting.id) {
    return flat[deleting.idx] ?? flat[deleting.idx - 1] ?? flat[0] ?? null;
  }
  if (curId && !flat.includes(curId)) {
    return flat[0] ?? null;
  }
  return curId;
}
