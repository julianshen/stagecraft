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
// items/kpis/stats hold per-layout objects or strings, so only their array-ness
// is checked. `rows`/`columns` (table) and every scalar field render directly as
// React children, so their leaf values must be primitives.
const OBJECT_ARRAY_FIELDS = new Set(['items', 'kpis', 'stats']);
// The discriminated-union layouts the renderer/exporter understand. An AI patch
// setting `layout` to anything else would fall through to the default render
// path and silently lose the slide's content, so it's rejected.
const SLIDE_LAYOUTS = new Set([
  'cover', 'agenda', 'divider', 'kpi', 'chart', 'split',
  'table', 'text', 'roadmap', 'risks', 'list', 'thanks',
]);
const isPrimitive = (x) => x === null || typeof x !== 'object';
// A leaf of an object-array field: a primitive (list item) or a flat record
// whose own values are all primitives (agenda/kpi/stat objects). A nested
// object (e.g. `{ label: { text } }`) is rejected — the renderer would render
// that inner object directly as a React child and crash.
const isLeaf = (x) =>
  isPrimitive(x) || (typeof x === 'object' && !Array.isArray(x) && Object.values(x).every(isPrimitive));

// Accept a patch field only if its value matches the slide schema's shape — an
// object/array where a primitive is expected (e.g. `title: { text }`, a table
// cell of `{ text }`) would crash React's "object as child" render, so it's
// dropped before it can persist into the deck.
function fieldOk(key, value, layout) {
  if (key === 'layout') return typeof value === 'string' && SLIDE_LAYOUTS.has(value);
  if (key === 'rows') return Array.isArray(value) && value.every((row) => Array.isArray(row) && row.every(isPrimitive));
  if (key === 'columns') return Array.isArray(value) && value.every(isPrimitive);
  // The list layout renders items as plain text, so its items must be
  // primitives — an object item (valid for agenda/risks) would render blank.
  if (key === 'items' && layout === 'list') return Array.isArray(value) && value.every(isPrimitive);
  if (OBJECT_ARRAY_FIELDS.has(key)) return Array.isArray(value) && value.every(isLeaf);
  return isPrimitive(value);
}

/**
 * Merge a partial-slide `patch` into the slide `curId` (used to apply AI edits).
 * The slide id is immutable, unsafe keys and malformed (non-array) collection
 * fields are dropped; every other field overrides. Returns a new deck
 * (immutable) or the deck unchanged when there's nothing to do.
 */
/**
 * Return the subset of `patch` that is safe to merge — drops the immutable id,
 * prototype-pollution keys, and any field whose value doesn't match the slide
 * schema's shape. Exposed so the Co-pilot can tell what an edit will actually
 * change (and avoid claiming success for a fully-rejected patch).
 */
export function sanitizeSlidePatch(patch, currentLayout) {
  const safe = {};
  if (!patch || typeof patch !== 'object') return safe;
  // The effective layout is the (valid) one the patch switches to, else the
  // slide's current layout — it decides layout-specific field shapes.
  const layout = typeof patch.layout === 'string' && SLIDE_LAYOUTS.has(patch.layout) ? patch.layout : currentLayout;
  for (const [k, v] of Object.entries(patch)) {
    if (UNSAFE_PATCH_KEYS.has(k)) continue;
    if (!fieldOk(k, v, layout)) continue;
    safe[k] = v;
  }
  return safe;
}

export function applySlidePatch(deck, curId, patch) {
  if (!deck || !curId || !patch) return deck;
  const current = (deck.slides || []).find((s) => s.id === curId);
  const safe = sanitizeSlidePatch(patch, current?.layout);
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
