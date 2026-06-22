// Pure geometry for free-form canvas elements (the overlay layer on a slide).
// All coordinates are in the slide's 1920×1080 authoring space.
import { shapeDef } from './shapes.js';
import { toHex, isHexColor } from './color.js';

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const GRID = 8;       // snapping grid
export const MIN_SIZE = 16;  // minimum element width/height
// A line's thickness is a real, adjustable dimension (its model height == the
// visual == the export). It may go thinner than MIN_SIZE — down to a hairline —
// so its height floors here instead.
export const MIN_LINE_THICKNESS = 2;
// Minimum click/selection target. A thin rule (down to MIN_LINE_THICKNESS) would
// otherwise be a near-unclickable sliver; its hit box pads up to this. Equal to
// MIN_SIZE — the floor every non-line element already resizes to — so in practice
// only a line (whose thickness floors lower) is ever below it and gets padded.
export const HIT_MIN = MIN_SIZE;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const snap = (v, grid = GRID) => Math.round(v / grid) * grid;

// Drop shadow: a per-element `{ color, blur, x, y }` (absent = no shadow). The
// softness is a fixed opacity shared by the canvas filter (an 8-digit hex alpha)
// and the PPTX export (a 0–1 opacity), so the two surfaces match. DEFAULT_SHADOW
// seeds the Properties toggle.
export const SHADOW_OPACITY = 0.35;
export const DEFAULT_SHADOW = Object.freeze({ color: '#000000', blur: 16, x: 0, y: 8 });
export const dropShadowCss = (s) => {
  const a = Math.round(SHADOW_OPACITY * 255).toString(16).padStart(2, '0');
  // toHex expands a shorthand (#abc → #aabbcc) so appending the 2-digit alpha
  // yields a valid 8-digit hex, not an invalid 5-digit one the browser ignores.
  return `drop-shadow(${s.x}px ${s.y}px ${s.blur}px ${toHex(s.color)}${a})`;
};
// Is this shadow safe for both render surfaces to draw? The server write paths
// (PUT /api/deck, MCP update_slide) bypass the deckUtils gate, so `shadow` can be
// any persisted JSON. The canvas relies on CSS dropping an invalid filter, but
// pptxgen turns NaN into a corrupt deck — so the export must skip a malformed
// shadow, and the canvas gates on the same predicate for parity. Looser than the
// gate's `isShadow` on purpose: extra keys still render, so they stay renderable.
export const isRenderableShadow = (s) => !!s && isHexColor(s.color)
  && Number.isFinite(s.blur) && s.blur >= 0
  && Number.isFinite(s.x) && Number.isFinite(s.y);

// Gradient fill: a per-element `{ from, to, angle }` 2-stop linear gradient
// (absent = the solid `fill`). The canvas renders a real CSS gradient; the PPTX
// export approximates it with the midpoint blend (pptxgen has no shape gradient
// — a documented degradation). DEFAULT_GRADIENT seeds the Properties toggle.
export const DEFAULT_GRADIENT = Object.freeze({ from: '#4f46e5', to: '#06b6d4', angle: 135 });
export const linearGradientCss = (g) => `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`;
// Is this gradient safe for both surfaces? Same gate-bypass reasoning as
// isRenderableShadow: a malformed gradient falls back to the solid fill on the
// canvas AND the export. Looser than the gate's isGradient (extra keys still
// render). The angle is any finite degrees (CSS wraps; the export ignores it).
export const isRenderableGradient = (g) => !!g && isHexColor(g.from) && isHexColor(g.to)
  && Number.isFinite(g.angle);

// A line's thickness (its height) floors at MIN_LINE_THICKNESS — deliberately
// lower than the caller's `min` (a rule may be a hairline). Non-lines use `min`.
const isLine = (el) => !!shapeDef(el.type)?.line;
const heightMin = (el, min) => (isLine(el) ? MIN_LINE_THICKNESS : min);

// Element centre (slide coords).
const centerOf = (el) => [el.x + el.w / 2, el.y + el.h / 2];
// Rotate vector (x, y) by `rad` radians (standard 2D rotation matrix).
const rotateVec = (x, y, rad) => {
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return [x * cos - y * sin, x * sin + y * cos];
};

const DEFAULTS = {
  text: { w: 480, h: 120, content: 'Text', fill: '#15171C' },
  rect: { w: 320, h: 200, fill: '#4f46e5' },
  ellipse: { w: 240, h: 240, fill: '#4f46e5' },
  circle: { w: 240, h: 240, fill: '#4f46e5' },
  image: { w: 480, h: 360 }, // a 4:3 box; carries `src` (a data URL), not a fill
  line: { w: 320, h: 8 }, // a thin rule by default; its height is an adjustable stroke thickness
  path: { w: 320, h: 200, stroke: '#15171C', strokeWidth: 2 }, // a freehand pen stroke; carries `points` (0..1, relative to the box), stroked not filled
};

// Build a new element of `type`, centered by default, with snapped position.
export function createElement(type, opts = {}) {
  const d = DEFAULTS[type] || DEFAULTS.rect;
  const w = opts.w ?? d.w;
  const h = opts.h ?? d.h;
  const el = {
    id: opts.id ?? `el-${type}`,
    type,
    x: snap(opts.x ?? (SLIDE_W - w) / 2),
    y: snap(opts.y ?? (SLIDE_H - h) / 2),
    w,
    h,
  };
  if (type === 'image') {
    el.src = opts.src ?? ''; // an image carries a `src` (data URL) instead of a colour fill
  } else if (type === 'path') {
    // A freehand stroke: 0..1 points relative to the box (see pathFromStroke),
    // stroked not filled — so no `fill`, mirroring image.
    el.points = opts.points ?? [];
    el.stroke = opts.stroke ?? d.stroke;       // DEFAULTS.path always carries stroke + strokeWidth
    el.strokeWidth = opts.strokeWidth ?? d.strokeWidth;
  } else {
    if (d.content !== undefined) el.content = opts.content ?? d.content;
    el.fill = opts.fill ?? d.fill ?? '#4f46e5'; // canonical hex so the inspector swatch matches the render
  }
  // Keep a new element on-slide and at/above its per-type minimum, like every
  // other element op (moveElement/resizeElement) — so a draw or click near the
  // edge can't create clipped or degenerate geometry.
  return clampElement(el);
}

// Snap a freshly DRAWN element box (raw pointer-sweep coords) to the grid and
// floor each dimension to its minimum, so a canvas draw aligns like the move/
// resize gestures and can't produce a degenerate (zero/sub-min) shape. A line's
// height is a thickness, so it floors at MIN_LINE_THICKNESS rather than MIN_SIZE.
export function snapDrawnBox(type, { x, y, w, h }) {
  return {
    x: snap(x),
    y: snap(y),
    w: Math.max(snap(w), MIN_SIZE),
    h: Math.max(snap(h), heightMin({ type }, MIN_SIZE)),
  };
}

// A renderable path vertex: a finite [x, y] pair. Single-sourced so the canvas
// polyline and the custGeom export drop the same malformed points (a non-gated /
// manual write can carry junk) — they read p[0]/p[1], so extra entries are ignored.
export const isFinitePoint = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

// Build a `path` element's geometry from a freehand stroke: the raw pointer
// points (absolute slide coords) → the stroke's bounding box + the points
// normalized to 0..1 within it. Storing points relative to the box lets the path
// ride every move/resize/rotate (which only touch x/y/w/h) untouched, while the
// renderer/export scale them back into the box. A zero-range axis (a perfectly
// straight stroke) floors to MIN_SIZE and collapses that axis to 0 (no NaN).
export function pathFromStroke(pts) {
  // Fold the bbox in one pass — never spread the points into Math.min/max, which
  // throws RangeError once a stroke runs to the thousands of points a pen emits.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of pts) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const rw = maxX - minX, rh = maxY - minY;
  const norm = (v, min, range) => (range > 0 ? (v - min) / range : 0);
  return {
    x: minX, y: minY,
    w: Math.max(rw, MIN_SIZE),
    h: Math.max(rh, MIN_SIZE),
    points: pts.map((p) => [norm(p[0], minX, rw), norm(p[1], minY, rh)]),
  };
}

// Move an element by (dx, dy), snapped to the grid and clamped to the slide.
export function moveElement(el, dx, dy, { grid = GRID, bounds = { w: SLIDE_W, h: SLIDE_H } } = {}) {
  return {
    ...el,
    x: clamp(snap(el.x + dx, grid), 0, bounds.w - el.w),
    y: clamp(snap(el.y + dy, grid), 0, bounds.h - el.h),
  };
}

// Bounding box of a set of elements (also drives the group transform frame).
export function selectionBounds(els) {
  const x1 = Math.min(...els.map((e) => e.x));
  const y1 = Math.min(...els.map((e) => e.y));
  const x2 = Math.max(...els.map((e) => e.x + e.w));
  const y2 = Math.max(...els.map((e) => e.y + e.h));
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}

// Align 2+ elements to their shared bounding box along `edge`
// ('left'|'right'|'hcenter'|'top'|'bottom'|'vmiddle'). The cross axis is left
// untouched. Returns the input unchanged for fewer than two elements.
export function alignElements(els, edge) {
  if (!els || els.length < 2) return els;
  const b = selectionBounds(els);
  // Exact alignment (no grid snapping — alignment must be pixel-precise).
  return els.map((e) => {
    switch (edge) {
      case 'left': return { ...e, x: b.x1 };
      case 'right': return { ...e, x: b.x2 - e.w };
      case 'hcenter': return { ...e, x: Math.round(b.cx - e.w / 2) };
      case 'top': return { ...e, y: b.y1 };
      case 'bottom': return { ...e, y: b.y2 - e.h };
      case 'vmiddle': return { ...e, y: Math.round(b.cy - e.h / 2) };
      default: return e;
    }
  });
}

// Distribute 3+ elements along `axis` ('h'|'v') so the gaps between adjacent
// elements are equal, holding the two outermost edges fixed. The cross axis is
// left untouched. Returns the input unchanged for fewer than three elements.
export function distributeElements(els, axis) {
  if (!els || els.length < 3) return els;
  const pos = axis === 'v' ? 'y' : 'x';
  const size = axis === 'v' ? 'h' : 'w';
  const sorted = [...els].sort((a, b) => a[pos] - b[pos]);
  const n = sorted.length;
  // Outer edges of the bounding box. The far edge is the max over ALL elements
  // — the element with the largest start may not be the one reaching furthest.
  const near = Math.min(...sorted.map((e) => e[pos]));
  const far = Math.max(...sorted.map((e) => e[pos] + e[size]));
  const sumSize = sorted.reduce((acc, e) => acc + e[size], 0);
  const gap = (far - near - sumSize) / (n - 1);
  const at = new Map();
  let cursor = near;
  sorted.forEach((e, i) => {
    // Pin both outer edges of the box exactly; reposition the interior elements
    // (rounded) so the gaps between adjacent elements are equal.
    if (i === 0) at.set(e.id, near);
    else if (i === n - 1) at.set(e.id, far - e[size]);
    else at.set(e.id, Math.round(cursor));
    cursor += e[size] + gap;
  });
  return els.map((e) => ({ ...e, [pos]: at.get(e.id) }));
}

// Ids of elements that overlap the marquee rectangle defined by two corners
// (any drag direction). Strict overlap — edge-only contact does not select.
export function elementsInMarquee(els, x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return (els || [])
    .filter((e) => e.x < right && e.x + e.w > left && e.y < bottom && e.y + e.h > top)
    .map((e) => e.id);
}

// Rotation (whole degrees, normalized to [0,360)) of element `el` so its top
// points toward the pointer (px, py) in slide coords. The +90 puts 0° at
// "pointer straight up" (the rotate handle sits above the element).
export function rotateElement(el, px, py) {
  const [cx, cy] = centerOf(el);
  const deg = Math.round(Math.atan2(py - cy, px - cx) * 180 / Math.PI + 90);
  return { ...el, rot: ((deg % 360) + 360) % 360 };
}

// Clone standalone element data (e.g. clipboard contents) into fresh elements:
// each `sources[i]` gets `newIds[i]` and the SAME (dx, dy) offset, so a copied
// group keeps its relative layout. Pure; sources are shallow-copied (canvas
// elements are flat — no nested mutable fields).
export function cloneElements(sources, newIds, { dx = GRID * 2, dy = GRID * 2 } = {}) {
  const src = (sources || []).filter(Boolean);
  // Re-key each source group to a fresh id (derived from the clone's own new
  // element id → caller-deterministic, StrictMode-safe) so a duplicated/pasted
  // group is its OWN group, not fused with the original it was copied from.
  const groupMap = new Map();
  src.forEach((s, i) => { if (s.groupId && !groupMap.has(s.groupId)) groupMap.set(s.groupId, `grp-${newIds[i]}`); });
  return src.map((s, i) => {
    const clone = { ...s, id: newIds[i], x: s.x + dx, y: s.y + dy };
    if (s.groupId) clone.groupId = groupMap.get(s.groupId);
    return clone;
  });
}

// Duplicate the elements whose ids are in `ids`: append an offset clone of each
// (in array order) carrying the matching `newIds` entry, so the copies land on
// top. Returns the SAME array ref when nothing matches (no-op). Pure. The caller
// supplies `newIds` (generated outside any reducer, so a StrictMode double-run
// is deterministic).
export function duplicateElements(elements, ids, newIds, opts = {}) {
  const sel = new Set(ids);
  // Selected elements in array order, capped at the supplied id count.
  const matched = (elements || []).filter((el) => el && sel.has(el.id)).slice(0, newIds.length);
  if (!matched.length) return elements;
  return [...elements, ...cloneElements(matched, newIds, opts)];
}

// --- Grouping: a group is the set of elements sharing a non-null `groupId`. It
// is a canvas-editing relationship only — selecting/moving/duplicating a member
// acts on the whole group, but the export flattens it (each element keeps its
// absolute geometry), so there is no group geometry to track. The caller
// supplies a fresh `groupId` (generated outside any reducer, like `newIds`).

// Expand a selection to whole groups: any selected member pulls in its
// group-mates. Returns ids in element order (deduped), so the selection always
// holds complete groups and the existing multi-element ops act on them as a unit.
export function expandToGroups(elements, ids) {
  if (!ids || !ids.length) return []; // no selection → skip iterating elements
  const sel = new Set(ids);
  const groups = new Set();
  // A truthy groupId is a real group; '' / null / undefined = ungrouped (so a
  // stray empty-string id can't couple unrelated elements).
  for (const el of elements || []) if (el && sel.has(el.id) && el.groupId) groups.add(el.groupId);
  return (elements || [])
    .filter((el) => el && (sel.has(el.id) || (el.groupId && groups.has(el.groupId))))
    .map((el) => el.id);
}

// Stamp `groupId` onto every selected element (reassigning any prior group).
// Unselected elements keep their reference (no needless deck churn).
export function groupElements(elements, ids, groupId) {
  const sel = new Set(ids || []);
  return (elements || []).map((el) => (el && sel.has(el.id) ? { ...el, groupId } : el));
}

// Remove the `groupId` key from selected grouped elements (the key, not a
// `undefined` value, so the gate stays clean). Ungrouped/unselected elements
// keep their reference.
export function ungroupElements(elements, ids) {
  const sel = new Set(ids || []);
  let changed = false;
  const out = (elements || []).map((el) => {
    if (!el || !sel.has(el.id) || !el.groupId) return el;
    changed = true;
    const { groupId, ...rest } = el;
    return rest;
  });
  // Same-reference on a no-op (like reorderElement) so ungrouping an already-
  // ungrouped selection doesn't trigger a redundant deck write / PUT.
  return changed ? out : (elements || []);
}

// --- Transform a multi-selection as a unit (a group, or any 2+ selection). The
// single-element handles still use resizeElement/rotateElement; these drive the
// group bounding-box handles. Both bake the result into each child's geometry,
// so the export (which reads absolute x/y/w/h) needs no group concept.

// Resize the selection's bounding box by dragging `handle` (dx/dy in slide
// space): every selected child scales proportionally, anchored to the edge
// OPPOSITE the handle. The scale is floored so the SMALLEST child stays >= min
// (matching the single-element resize) — which also keeps the bbox >= min and the
// scale positive, so the group can't collapse or invert. A zero-extent axis
// (bw/bh = 0, e.g. a degenerate gate-bypass element) can't scale and is skipped
// (no divide-by-zero). Rotated children scale their x/y/w/h (rot preserved) —
// exact for the common axis-aligned case. Fewer than two selected → unchanged.
export function resizeGroup(elements, ids, handle, dx, dy, { min = MIN_SIZE } = {}) {
  const sel = new Set(ids || []);
  const group = (elements || []).filter((e) => e && sel.has(e.id));
  if (group.length < 2) return elements;
  const edge = HANDLE_EDGES[handle] || {};
  const b = selectionBounds(group);
  const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
  // Floor each axis at the largest min/size ratio among the children, so every
  // child stays >= its own min — heightMin keeps a thin line at MIN_LINE_THICKNESS
  // rather than forcing the group up to MIN_SIZE. Zero-size children are skipped.
  const floorX = group.reduce((m, e) => (e.w > 0 ? Math.max(m, min / e.w) : m), 0);
  const floorY = group.reduce((m, e) => (e.h > 0 ? Math.max(m, heightMin(e, min) / e.h) : m), 0);
  let sx = 1, sy = 1, ax = b.x1, ay = b.y1;
  if (bw > 0 && edge.r) { sx = Math.max(floorX, (bw + dx) / bw); }              // drag right → left edge anchored
  else if (bw > 0 && edge.l) { sx = Math.max(floorX, (bw - dx) / bw); ax = b.x2; } // drag left → right edge anchored
  if (bh > 0 && edge.b) { sy = Math.max(floorY, (bh + dy) / bh); }             // drag bottom → top edge anchored
  else if (bh > 0 && edge.t) { sy = Math.max(floorY, (bh - dy) / bh); ay = b.y2; } // drag top → bottom edge anchored
  return (elements || []).map((el) => {
    if (!el || !sel.has(el.id)) return el;
    // Round the scaled EDGES (not x and w independently) and derive w/h from
    // them, so adjacent children keep their shared edge aligned — no 1px
    // gaps/overlaps when a row/grid of elements is group-resized.
    const x = Math.round(ax + (el.x - ax) * sx);
    const y = Math.round(ay + (el.y - ay) * sy);
    return { ...el, x, y, w: Math.round(ax + (el.x + el.w - ax) * sx) - x, h: Math.round(ay + (el.y + el.h - ay) * sy) - y };
  });
}

// Rotate the selection by `angleDelta` degrees about `center` ([cx, cy], the
// bbox centre captured at drag start): each child orbits the centre and its own
// `rot` advances by the delta. Applied to the pre-drag elements each move, so
// the total delta doesn't compound. Fewer than two → still valid (rotates one).
export function rotateGroup(elements, ids, angleDelta, center) {
  const sel = new Set(ids || []);
  const [cx, cy] = center;
  const t = (angleDelta * Math.PI) / 180;
  return (elements || []).map((el) => {
    if (!el || !sel.has(el.id)) return el;
    const [ox, oy] = rotateVec(el.x + el.w / 2 - cx, el.y + el.h / 2 - cy, t); // orbit the centre offset
    const rot = (((Math.round((+el.rot || 0) + angleDelta)) % 360) + 360) % 360; // coerce (a string rot would concatenate)
    return { ...el, x: Math.round(cx + ox - el.w / 2), y: Math.round(cy + oy - el.h / 2), rot };
  });
}

// Z-order: move element `id` within `elements` (paint order = array order, so
// the last element is on top). `op` is 'front' (to top) or 'back' (to bottom).
// Returns the SAME array reference when nothing moves (unknown id/op, or already
// at the target end), so a no-op doesn't trigger a deck write. Pure (no mutation).
export function reorderElement(elements, id, op) {
  const list = elements || [];
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return elements;
  if (op === 'front') {
    if (i === list.length - 1) return elements; // already on top
    const arr = list.slice();
    arr.push(arr.splice(i, 1)[0]);
    return arr;
  }
  if (op === 'back') {
    if (i === 0) return elements; // already on the bottom
    const arr = list.slice();
    arr.unshift(arr.splice(i, 1)[0]);
    return arr;
  }
  return elements; // unknown op
}

// Immutably transform the `elements` array of slide `slideId` via `fn`. When
// `fn` returns the SAME array reference (a no-op, e.g. reorderElement on an
// element already at the target end), the deck is returned UNCHANGED — so a
// no-op edit doesn't churn the deck rev or trigger a sync write.
export function updateSlideElements(deck, slideId, fn) {
  if (!deck) return deck;
  let changed = false;
  const slides = (deck.slides || []).map((s) => {
    if (s.id !== slideId) return s;
    const current = s.elements || [];
    const next = fn(current);
    if (next === current) return s; // fn no-op'd
    changed = true;
    return { ...s, elements: next };
  });
  return changed ? { ...deck, slides } : deck;
}

// Which edges a given resize handle moves.
const HANDLE_EDGES = {
  nw: { l: true, t: true }, n: { t: true }, ne: { r: true, t: true },
  w: { l: true }, e: { r: true },
  sw: { l: true, b: true }, s: { b: true }, se: { r: true, b: true },
};

// Resize a ROTATED element along its local (un-rotated) axes, keeping the edge
// opposite the dragged handle fixed in SCREEN space. The screen delta is rotated
// into the element's local frame; the new size is applied there; then the centre
// is recomputed so the anchored local edge's screen position doesn't move (the
// box rotates about its centre, so a size change would otherwise shift it). Only
// the resized dimension is grid-snapped. Slide-bounds clamping is skipped — an
// axis-aligned clamp is meaningless for a rotated box; min-size still applies.
function resizeRotated(el, edge, dx, dy, grid, min) {
  const t = (el.rot * Math.PI) / 180;
  const signX = edge.l ? 1 : edge.r ? -1 : 0; // which side stays anchored (opposite the drag)
  const signY = edge.t ? 1 : edge.b ? -1 : 0;
  if (!signX && !signY) return el; // unknown handle moves no edges — strict no-op
  const [cx0, cy0] = centerOf(el);
  // Drag delta in the element's local frame (the inverse rotation).
  const [ldx, ldy] = rotateVec(dx, dy, -t);
  // Edge→dimension mapping — keep in sync with the axis-aligned path below.
  let w = el.w, h = el.h;
  if (edge.l) w = el.w - ldx; else if (edge.r) w = el.w + ldx;
  if (edge.t) h = el.h - ldy; else if (edge.b) h = el.h + ldy;
  // Snap only the resized dimension; the other stays exact (it may be off-grid
  // from a Properties-panel edit). Min-size always applies (height uses the
  // line floor so a rotated rule can still be thinned).
  if (signX) w = Math.max(min, snap(w, grid));
  if (signY) h = Math.max(heightMin(el, min), snap(h, grid));
  // Hold the anchored local edge's screen point fixed across the size change.
  const [ax0, ay0] = rotateVec((signX * el.w) / 2, (signY * el.h) / 2, t);
  const px = cx0 + ax0, py = cy0 + ay0;
  const [ax1, ay1] = rotateVec((signX * w) / 2, (signY * h) / 2, t);
  return { ...el, x: Math.round(px - ax1 - w / 2), y: Math.round(py - ay1 - h / 2), w, h };
}

// Resize an element by dragging `handle` by (dx, dy). The dragged edge snaps to
// the grid while the OPPOSITE edge stays anchored (so a left/top resize doesn't
// drift the right/bottom edge), then min-size and slide bounds are enforced.
// A rotated element resizes along its own axes (see resizeRotated).
export function resizeElement(el, handle, dx, dy, { grid = GRID, min = MIN_SIZE, bounds = { w: SLIDE_W, h: SLIDE_H } } = {}) {
  const edge = HANDLE_EDGES[handle] || {};
  if (el.rot) return resizeRotated(el, edge, dx, dy, grid, min);
  // A line's height is its stroke thickness — it floors lower than other elements
  // so a rule can be thinned to a hairline. Width still uses the normal min.
  const hMin = heightMin(el, min);
  const right = el.x + el.w, bottom = el.y + el.h;
  let { x, y, w, h } = el;

  // Edge→dimension mapping — keep in sync with resizeRotated above.
  // For a moving start-edge, clamp the edge FIRST (into [0, opposite - min]) and
  // derive the size from the anchored opposite edge — so the opposite edge never
  // drifts, even when dragged past the slide boundary. For an end-edge, clamp the
  // size into [min, bounds - start]. Height uses hMin (the line floor).
  if (edge.l) { x = clamp(snap(el.x + dx, grid), 0, right - min); w = right - x; }
  else if (edge.r) { w = clamp(snap(el.w + dx, grid), min, bounds.w - el.x); }
  if (edge.t) { y = clamp(snap(el.y + dy, grid), 0, bottom - hMin); h = bottom - y; }
  else if (edge.b) { h = clamp(snap(el.h + dy, grid), hMin, bounds.h - el.y); }

  return { ...el, x, y, w, h };
}

// Clamp an element's geometry to the slide bounds + min size (no snapping) —
// used to sanitize direct numeric edits from the Properties panel.
export function clampElement(el, { bounds = { w: SLIDE_W, h: SLIDE_H }, min = MIN_SIZE } = {}) {
  // A line's height is its stroke thickness — a real dimension (model == visual
  // == export), just floored lower than other elements so a rule can be a
  // hairline. Width always honors the normal min/bounds.
  const w = clamp(el.w, min, bounds.w);
  const h = clamp(el.h, heightMin(el, min), bounds.h);
  const out = {
    ...el,
    w,
    h,
    x: clamp(el.x, 0, bounds.w - w),
    y: clamp(el.y, 0, bounds.h - h),
  };
  if (el.opacity != null) {
    const o = Number(el.opacity);
    out.opacity = Number.isFinite(o) ? clamp(o, 0, 100) : 100;
  }
  if (el.rot != null) {
    const r = Number(el.rot);
    out.rot = Number.isFinite(r) ? ((r % 360) + 360) % 360 : 0;
  }
  return out;
}

// The interactive hit/selection box for an element: at least `min` in each
// dimension, centred on the element, so a thin rule stays grabbable and shows a
// visible selection outline while its VISUAL still renders at el.w/el.h. Pure
// (un-rotated) geometry — the caller applies the element's rotation to it.
export function hitBox(el, min = HIT_MIN) {
  const w = Math.max(el.w, min);
  const h = Math.max(el.h, min);
  return { x: el.x - (w - el.w) / 2, y: el.y - (h - el.h) / 2, w, h };
}

// Mint a fresh unique id on each AI-authored element (`genId` injected, so it's
// deterministic in tests and minted outside any reducer → StrictMode-safe). Runs
// on the RAW elements BEFORE the validation gate — adding an id can't launder a
// bad geometry value, so the gate still validates raw x/y/w/h strictly; the
// validated elements are clamped separately (clampElement) afterwards. A
// non-object entry (LLM junk) passes through untouched for the gate to reject.
export function assignElementIds(elements, genId) {
  return elements.map((el) =>
    el && typeof el === 'object' && !Array.isArray(el) ? { ...el, id: genId() } : el,
  );
}

// Merge an AI-authored overlay (`incoming`) over the slide's existing elements,
// PRESERVING existing image elements (the Co-pilot can't round-trip an image's
// large data URL) and dropping any image in `incoming`. Existing images keep
// their stack position — `slide.elements` order is paint order, so an image the
// user brought to the front must stay in front. Images hold their slots while
// the incoming text/shape/line elements fill the non-image slots in order; any
// extras land on top (end). Images are never lost or duplicated.
export function mergeOverlay(existing, incoming) {
  // Coerce non-array inputs to [] (a malformed deck/MCP write could leave a
  // slide's `elements` as {} or a string) — matches how the renderer/exporter
  // tolerate it, so a merge can't throw on bad stored data.
  const ex = Array.isArray(existing) ? existing : [];
  const inc = Array.isArray(incoming) ? incoming : [];
  const nonImages = inc.filter((el) => el?.type !== 'image');
  // An all-image slide (e.g. a lone image from the image button) has no overlay
  // the image was deliberately fronted over, so a new overlay is visible content
  // — paint it on top of the images, not behind them.
  if (!ex.some((el) => el?.type !== 'image')) return [...ex, ...nonImages];
  // Otherwise foreground images — the trailing run of images — stay frontmost: a
  // growing overlay must fill in behind them, never on top. Split them off the tail.
  let cut = ex.length;
  while (cut > 0 && ex[cut - 1]?.type === 'image') cut--;
  const out = [];
  let ni = 0;
  for (const el of ex.slice(0, cut)) {
    if (el?.type === 'image') out.push(el);                 // keep a mid-stack image at its slot
    else if (ni < nonImages.length) out.push(nonImages[ni++]); // fill a former non-image slot
  }
  while (ni < nonImages.length) out.push(nonImages[ni++]);  // extras → top of the overlay, still behind foreground images
  return [...out, ...ex.slice(cut)];                        // trailing (foreground) images stay frontmost
}
