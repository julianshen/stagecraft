// Per-field text formatting overrides for template slide fields (titles, bullets,
// …). A slide carries `fmt`, a map from a field's path-key to a flat record of
// formatting props; the renderer merges these over the field's template style.
// Single source of truth for the key encoding and the prop→CSS mapping, shared
// by the renderer, the floating toolbar, and the validation gate.

// The fixed top-level text fields that can carry formatting — the single-segment
// fields the renderer edits via E(). One part of the "what is formattable"
// vocabulary (the other is the per-item fields below), shared by the renderer
// (which tags/styles these) and the patch gate (which rejects fmt for anything
// else, so an AI patch can't report an unrenderable fmt key as applied).
export const FORMATTABLE_FIELDS = new Set([
  'title', 'subtitle', 'sub', 'body', 'eyebrow', 'kicker', 'note',
]);

// Per-item formattable fields: collection → the object sub-fields the renderer
// formats per item (exactly the per-item paths `E()` emits). `items` is special
// — agenda items are objects with these leaves, list items are primitives
// (`items.N`, no leaf). `columns.N` (table header) and `rows.N.M` (table cell)
// are index-only. Keep this in lockstep with the renderer's per-item `E([...])`
// calls and the patch gate (which validates fmt keys against it). Per-item fmt
// is index-keyed: stable through inline edits (no item reorder/add UI), and an
// AI wholesale item replacement re-applies it by position (acceptable).
const ITEM_FIELDS = {
  items: ['n', 't', 'd'],
  kpis: ['label', 'delta', 'val', 'target'],
  stats: ['lbl', 'val'],
};
const isIndexNum = (v) => Number.isInteger(v) && v >= 0;
const isIndexStr = (v) => /^(0|[1-9]\d*)$/.test(v);

// Is `leaf` a formattable sub-field of the object collection `coll`? Own-property
// guard before the lookup: `coll` can be an untrusted key (a stored fmt key is
// JSON-parsed, so `__proto__`/`constructor`/`toString`/`hasOwnProperty` arrive as
// own keys), and indexing ITEM_FIELDS with one would resolve up its prototype
// chain to a non-array and throw on `.includes`. Shared by both validators below.
const isItemLeaf = (coll, leaf) =>
  Object.prototype.hasOwnProperty.call(ITEM_FIELDS, coll) && ITEM_FIELDS[coll].includes(leaf);

// Is `path` (a render path — indices are NUMBERS) a formattable field? Used by
// the renderer's `E()`; works on the array so the hot read-only render needn't
// build the dotted key.
export function isFormattablePath(path) {
  if (path.length === 1) return FORMATTABLE_FIELDS.has(path[0]);
  const [coll, i, leaf] = path;
  if (!isIndexNum(i)) return false;
  if (path.length === 2) return coll === 'items' || coll === 'columns'; // primitive item / header
  if (path.length === 3) return coll === 'rows' ? isIndexNum(leaf) : isItemLeaf(coll, leaf);
  return false;
}

// Is `key` (a stored fmt key — `path.join('.')`, indices are DIGIT strings) a
// formattable field? Used by the patch gate so it accepts exactly what the
// renderer styles — no looser (an unrenderable key would report as applied).
export function isFormattableKey(key) {
  if (FORMATTABLE_FIELDS.has(key)) return true;
  const [coll, i, leaf, ...rest] = key.split('.');
  if (rest.length || !isIndexStr(i)) return false;
  if (leaf === undefined) return coll === 'items' || coll === 'columns';
  return coll === 'rows' ? isIndexStr(leaf) : isItemLeaf(coll, leaf);
}

// The stable map key for a field, derived from its render path. Joining with
// dots keeps it a primitive (so it survives the slide-patch validation as an
// object key) and matches the path the toolbar/renderer already know.
//   fmtKey(['title']) -> 'title'   fmtKey(['items', 2, 't']) -> 'items.2.t'
export function fmtKey(path) {
  return path.join('.');
}

// A valid formatting record: a plain object carrying only the known props, each
// with the right type — the validation analog of `fmtStyle`'s reads below. The
// own-property guard before the lookup keeps a prototype key (`__proto__`,
// `toString`) from a JSON-parsed fmt out of the table. Single source for "what is
// a valid fmt value", shared by the patch gate (`isFmtMap`) and the remappers
// below (which drop any entry it rejects, so their output stays gate-valid — the
// gate rejects the whole map if any one value is junk).
const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const FMT_PROP_OK = {
  bold: (v) => typeof v === 'boolean',
  italic: (v) => typeof v === 'boolean',
  underline: (v) => typeof v === 'boolean',
  fontSize: (v) => Number.isFinite(v),
  color: (v) => typeof v === 'string',
};
export function isFmtRecord(e) {
  return isPlainObject(e)
    && Object.entries(e).every(([k, v]) =>
      Object.prototype.hasOwnProperty.call(FMT_PROP_OK, k) && FMT_PROP_OK[k](v));
}

// Remap a slide's index-keyed `fmt` when a per-item `collection` is reordered or
// an item is deleted, so formatting follows its item. `newOrder[newIndex] =
// oldIndex`; an old index absent from `newOrder` was deleted, so its keys are
// dropped. Only keys under `collection` (`items.0`, `items.0.t`, …) are rewritten
// — other collections and top-level fields pass through untouched. Splits the key
// like the gate's `isFormattableKey` ({collection}.{index}[.{leaf}]) and rejoins
// with the new index. Returns a new map (or the falsy input as-is).
export function remapCollectionFmt(fmt, collection, newOrder) {
  if (!fmt) return fmt;
  const out = {};
  for (const [key, val] of Object.entries(fmt)) {
    if (!isFmtRecord(val)) continue; // malformed value → drop (gate rejects the whole map)
    const [coll, idx, ...leaf] = key.split('.');
    if (coll !== collection) {
      if (isFormattableKey(key)) out[key] = val; // a valid other-collection / top-level key — preserve
      continue;
    }
    const newIdx = newOrder.indexOf(Number(idx)); // item's new position; -1 once deleted
    if (newIdx === -1) continue;
    const newKey = [collection, newIdx, ...leaf].join('.');
    if (isFormattableKey(newKey)) out[newKey] = val; // drop a malformed (e.g. bad-leaf) key
  }
  return out;
}

// Remap a table slide's 2D `fmt` when rows/columns are reordered or deleted:
// `columns.C` (header) and `rows.R.C` (cell). `rowOrder[newRow] = oldRow`,
// `colOrder[newCol] = oldCol`; an old index absent from its order was deleted, so
// its keys drop. A row op passes an identity `colOrder` (and vice-versa), so the
// untouched axis maps each index to itself. Because this REBUILDS the key, it
// matches only the exact `isFormattableKey` table shapes ({columns}.{i} /
// {rows}.{r}.{c}, index parts only) before remapping. A malformed key (extra
// segment, non-index part) is DROPPED — not "repaired" into a valid one (which
// would resurrect stale formatting), and not passed through (the gate's `isFmtMap`
// rejects the whole map if any key is unformattable, which would drop the valid
// remap with it). Valid non-table keys (a top-level field) pass through.
export function remapTableFmt(fmt, rowOrder, colOrder) {
  if (!fmt) return fmt;
  const out = {};
  for (const [key, val] of Object.entries(fmt)) {
    if (!isFmtRecord(val)) continue; // malformed value → drop (gate rejects the whole map)
    const parts = key.split('.');
    const [coll, a, b] = parts;
    if (coll === 'columns' && parts.length === 2 && isIndexStr(a)) {
      const nc = colOrder.indexOf(Number(a)); // columns.C
      if (nc !== -1) out[`columns.${nc}`] = val;
    } else if (coll === 'rows' && parts.length === 3 && isIndexStr(a) && isIndexStr(b)) {
      const nr = rowOrder.indexOf(Number(a)); // rows.R.C — remap both axes
      const nc = colOrder.indexOf(Number(b));
      if (nr !== -1 && nc !== -1) out[`rows.${nr}.${nc}`] = val;
    } else if (isFormattableKey(key)) {
      out[key] = val; // a valid non-table key (e.g. a top-level field) — preserve
    } // else: a malformed/unrenderable key — drop, keeping the output gate-valid
  }
  return out;
}

// Translate a formatting record into a CSS style object, emitting ONLY the props
// that are set. A toggle stored as `false` (or absent) contributes nothing, so
// un-bolding a field returns it to the template's baseline weight rather than
// forcing 400 — formatting is relative to the field, not absolute.
export function fmtStyle(fmt) {
  if (!fmt) return {};
  const style = {};
  if (fmt.bold) style.fontWeight = 700;
  if (fmt.italic) style.fontStyle = 'italic';
  if (fmt.underline) style.textDecoration = 'underline';
  // A bare number renders as px — matching the slide's fixed 1920×1080 px space
  // (a future PPTX consumer will need px→pt at the export boundary).
  if (fmt.fontSize != null) style.fontSize = fmt.fontSize;
  if (fmt.color != null) style.color = fmt.color;
  return style;
}
