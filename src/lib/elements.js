// Pure geometry for free-form canvas elements (the overlay layer on a slide).
// All coordinates are in the slide's 1920×1080 authoring space.
import { LINE_MAX_THICKNESS, shapeDef } from './shapes.js';

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const GRID = 8;       // snapping grid
export const MIN_SIZE = 16;  // minimum element width/height

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const snap = (v, grid = GRID) => Math.round(v / grid) * grid;

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
  line: { w: 320, h: LINE_MAX_THICKNESS }, // a thin rule — created at the height it renders at
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
  // An image carries a `src` (data URL) instead of a colour fill.
  if (type === 'image') {
    el.src = opts.src ?? '';
    return el;
  }
  if (d.content !== undefined) el.content = opts.content ?? d.content;
  el.fill = opts.fill ?? d.fill ?? '#4f46e5'; // canonical hex so the inspector swatch matches the render
  return el;
}

// Move an element by (dx, dy), snapped to the grid and clamped to the slide.
export function moveElement(el, dx, dy, { grid = GRID, bounds = { w: SLIDE_W, h: SLIDE_H } } = {}) {
  return {
    ...el,
    x: clamp(snap(el.x + dx, grid), 0, bounds.w - el.w),
    y: clamp(snap(el.y + dy, grid), 0, bounds.h - el.h),
  };
}

// Bounding box of a set of elements.
function selectionBounds(els) {
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
  return (sources || []).filter(Boolean).map((s, i) => ({ ...s, id: newIds[i], x: s.x + dx, y: s.y + dy }));
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
  // from a Properties-panel edit). Min-size always applies.
  if (signX) w = Math.max(min, snap(w, grid));
  if (signY) h = Math.max(min, snap(h, grid));
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
  const right = el.x + el.w, bottom = el.y + el.h;
  let { x, y, w, h } = el;

  // Edge→dimension mapping — keep in sync with resizeRotated above.
  // For a moving start-edge, clamp the edge FIRST (into [0, opposite - min]) and
  // derive the size from the anchored opposite edge — so the opposite edge never
  // drifts, even when dragged past the slide boundary. For an end-edge, clamp the
  // size into [min, bounds - start].
  if (edge.l) { x = clamp(snap(el.x + dx, grid), 0, right - min); w = right - x; }
  else if (edge.r) { w = clamp(snap(el.w + dx, grid), min, bounds.w - el.x); }
  if (edge.t) { y = clamp(snap(el.y + dy, grid), 0, bottom - min); h = bottom - y; }
  else if (edge.b) { h = clamp(snap(el.h + dy, grid), min, bounds.h - el.y); }

  return { ...el, x, y, w, h };
}

// Clamp an element's geometry to the slide bounds + min size (no snapping) —
// used to sanitize direct numeric edits from the Properties panel.
export function clampElement(el, { bounds = { w: SLIDE_W, h: SLIDE_H }, min = MIN_SIZE } = {}) {
  // A line is a thin rule rendered at exactly LINE_MAX_THICKNESS, so pin its
  // model height there — an inspector edit (even a larger typed value) can't
  // create a model/render gap. Width still honors the normal min/bounds.
  const isLine = !!shapeDef(el.type)?.line;
  const w = clamp(el.w, min, bounds.w);
  const h = isLine ? LINE_MAX_THICKNESS : clamp(el.h, min, bounds.h);
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
