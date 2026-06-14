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
// The discriminated-union layouts the renderer/exporter understand. An AI patch
// setting `layout` to anything else would fall through to the default render
// path and silently lose the slide's content, so it's rejected.
export const SLIDE_LAYOUTS = new Set([
  'cover', 'agenda', 'divider', 'kpi', 'chart', 'split',
  'table', 'text', 'roadmap', 'risks', 'list', 'thanks',
]);
// The slide fields an AI patch may set — exactly what the renderer/exporter
// read (id is immutable; num/total/sectionName are injected at render time). A
// plausible-but-unsupported field (speakerNotes, headline, content…) is rejected
// so it can't persist and be falsely reported as applied while nothing renders.
const SLIDE_FIELDS = new Set([
  'layout', 'title', 'subtitle', 'sub', 'body', 'eyebrow', 'kicker',
  'chapter', 'note', 'notes', 'bg', 'chartType',
  'items', 'kpis', 'stats', 'rows', 'columns',
  'chart', 'lanes', 'months', 'todayIndex', 'fmt',
]);
const isPrimitive = (x) => x === null || typeof x !== 'object';
// A flat record: a non-array object whose own values are all primitives. Used
// for agenda/risk items and kpi/stat entries, which the renderer reads field by
// field (it.t, k.label, st.val) — a nested object would render as a React child.
const isFlatRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.values(x).every(isPrimitive);
const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
// chart: { categories: primitive[], series: { name?, values: primitive[] }[] }
// — exactly what chartData (canvas + export) reads. Both keys are REQUIRED:
// the patch replaces the whole object, so a plausible-but-different shape
// (e.g. { labels, datasets }) would silently blank the chart into the demo
// fallback while the Co-pilot claims the edit applied.
const isChartShape = (v) => isPlainObject(v)
  // non-empty required: chartData treats empty arrays as missing and falls
  // back to the demo data — an "applied" edit would show fabricated numbers.
  && Array.isArray(v.categories) && v.categories.length > 0 && v.categories.every(isPrimitive)
  && Array.isArray(v.series) && v.series.length > 0 && v.series.every((s) =>
    isPlainObject(s) && Array.isArray(s.values) && s.values.every(isPrimitive)
    && (s.name === undefined || isPrimitive(s.name)));
// lane: { name?, items: flat-record[] } — what roadmapModel reads; `items` is
// REQUIRED for the same replace-not-merge reason ({ title, tasks } would
// normalize to an empty lane and blank the roadmap). Item positions t/d must
// be numbers when present — roadmapModel normalizes a string "3" to t:0/d:1,
// silently misplacing the bar while the edit reports as applied.
const isLaneItem = (it) => isFlatRecord(it)
  && (it.t === undefined || Number.isFinite(it.t))
  && (it.d === undefined || Number.isFinite(it.d));
const isLane = (l) => isPlainObject(l)
  && (l.name === undefined || isPrimitive(l.name))
  && Array.isArray(l.items) && l.items.every(isLaneItem);

// fmt: a map from a field path-key to a formatting record. Each record may only
// carry the known props with the right type — an unknown or wrong-typed prop
// (e.g. bold:'yes', fontSize:'64') is rejected so junk can't persist and the
// renderer (which spreads these into a style) never gets a bad value.
const FMT_PROP_OK = {
  bold: (v) => typeof v === 'boolean',
  italic: (v) => typeof v === 'boolean',
  underline: (v) => typeof v === 'boolean',
  fontSize: (v) => Number.isFinite(v),
  color: (v) => typeof v === 'string',
};
const isFmtEntry = (e) => isPlainObject(e)
  && Object.entries(e).every(([k, v]) => FMT_PROP_OK[k]?.(v));
const isFmtMap = (v) => isPlainObject(v) && Object.values(v).every(isFmtEntry);

// Accept a patch field only if its value matches the slide schema's shape for
// the target layout — a value of the wrong shape (e.g. `title: { text }`, a
// table cell of `{ text }`, primitive `kpis`, or object items in a `list`)
// would crash React or render blank, so it's dropped before it can persist.
function fieldOk(key, value, layout) {
  if (!SLIDE_FIELDS.has(key)) return false;
  if (key === 'layout') return typeof value === 'string' && SLIDE_LAYOUTS.has(value);
  if (key === 'rows') return Array.isArray(value) && value.every((row) => Array.isArray(row) && row.every(isPrimitive));
  if (key === 'columns') return Array.isArray(value) && value.every(isPrimitive);
  // `list` renders items as plain text (primitives); agenda/risks render object
  // fields, so for any other layout items must be flat records.
  if (key === 'items') return Array.isArray(value) && value.every(layout === 'list' ? isPrimitive : isFlatRecord);
  // kpis/stats are always object-backed (k.label/k.val, st.lbl/st.val).
  if (key === 'kpis' || key === 'stats') return Array.isArray(value) && value.every(isFlatRecord);
  // The data fields below only render on their own layout (the effective
  // layout includes a same-patch switch) — accepting them elsewhere would
  // persist an invisible "applied" edit.
  if (key === 'chart') return layout === 'chart' && isChartShape(value);
  if (key === 'lanes') return layout === 'roadmap' && Array.isArray(value) && value.every(isLane);
  if (key === 'months') return layout === 'roadmap' && Array.isArray(value) && value.every(isPrimitive);
  // roadmapModel only honors finite numbers (explicit null = "no marker");
  // a string "3" would pass as a primitive but silently render nothing.
  if (key === 'todayIndex') return layout === 'roadmap' && (value === null || Number.isFinite(value));
  // fmt is layout-agnostic — any template field on any layout can be formatted.
  if (key === 'fmt') return isFmtMap(value);
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

const COLLECTION_FIELDS = ['items', 'kpis', 'stats', 'rows', 'columns'];

function mergeSlide(slide, safe) {
  const merged = { ...slide, ...safe };
  // On a layout change, clear pre-existing collections that don't fit the new
  // layout (e.g. agenda object items left on a slide switched to `list`), so the
  // renderer doesn't show blank cards from carried-over content.
  if (safe.layout && safe.layout !== slide.layout) {
    for (const key of COLLECTION_FIELDS) {
      if (key in merged && !(key in safe) && !fieldOk(key, merged[key], merged.layout)) {
        delete merged[key];
      }
    }
  }
  return merged;
}

export function applySlidePatch(deck, curId, patch) {
  if (!deck || !curId || !patch) return deck;
  const current = (deck.slides || []).find((s) => s.id === curId);
  const safe = sanitizeSlidePatch(patch, current?.layout);
  return {
    ...deck,
    slides: (deck.slides || []).map((s) => (s.id === curId ? mergeSlide(s, safe) : s)),
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
