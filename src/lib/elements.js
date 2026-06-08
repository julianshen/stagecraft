// Pure geometry for free-form canvas elements (the overlay layer on a slide).
// All coordinates are in the slide's 1920×1080 authoring space.

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const GRID = 8;       // snapping grid
export const MIN_SIZE = 16;  // minimum element width/height

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const snap = (v, grid = GRID) => Math.round(v / grid) * grid;

const DEFAULTS = {
  text: { w: 480, h: 120, content: 'Text', fill: '#15171C' },
  rect: { w: 320, h: 200, fill: '#4f46e5' },
  ellipse: { w: 240, h: 240, fill: '#4f46e5' },
  circle: { w: 240, h: 240, fill: '#4f46e5' },
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

// Immutably transform the `elements` array of slide `slideId` via `fn`.
export function updateSlideElements(deck, slideId, fn) {
  if (!deck) return deck;
  return {
    ...deck,
    slides: (deck.slides || []).map((s) => (s.id === slideId ? { ...s, elements: fn(s.elements || []) } : s)),
  };
}

// Which edges a given resize handle moves.
const HANDLE_EDGES = {
  nw: { l: true, t: true }, n: { t: true }, ne: { r: true, t: true },
  w: { l: true }, e: { r: true },
  sw: { l: true, b: true }, s: { b: true }, se: { r: true, b: true },
};

// Resize an element by dragging `handle` by (dx, dy). The dragged edge snaps to
// the grid while the OPPOSITE edge stays anchored (so a left/top resize doesn't
// drift the right/bottom edge), then min-size and slide bounds are enforced.
export function resizeElement(el, handle, dx, dy, { grid = GRID, min = MIN_SIZE, bounds = { w: SLIDE_W, h: SLIDE_H } } = {}) {
  const edge = HANDLE_EDGES[handle] || {};
  const right = el.x + el.w, bottom = el.y + el.h;
  let { x, y, w, h } = el;

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
  const w = clamp(el.w, min, bounds.w);
  const h = clamp(el.h, min, bounds.h);
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
