// Pure geometry for free-form canvas elements (the overlay layer on a slide).
// All coordinates are in the slide's 1920×1080 authoring space.

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const GRID = 8;       // snapping grid
export const MIN_SIZE = 16;  // minimum element width/height

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const snap = (v, grid = GRID) => Math.round(v / grid) * grid;

const DEFAULTS = {
  text: { w: 480, h: 120, content: 'Text' },
  rect: { w: 320, h: 200 },
  ellipse: { w: 240, h: 240 },
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

// Resize an element by dragging `handle` by (dx, dy): the moving edges shift,
// then the result is snapped, kept at/above MIN_SIZE, and clamped to the slide.
export function resizeElement(el, handle, dx, dy, { grid = GRID, min = MIN_SIZE, bounds = { w: SLIDE_W, h: SLIDE_H } } = {}) {
  const edge = HANDLE_EDGES[handle] || {};
  let { x, y, w, h } = el;
  if (edge.l) { x += dx; w -= dx; }
  if (edge.r) { w += dx; }
  if (edge.t) { y += dy; h -= dy; }
  if (edge.b) { h += dy; }

  x = snap(x, grid); y = snap(y, grid); w = snap(w, grid); h = snap(h, grid);
  x = clamp(x, 0, bounds.w - min);
  y = clamp(y, 0, bounds.h - min);
  w = clamp(w, min, bounds.w - x);
  h = clamp(h, min, bounds.h - y);
  return { ...el, x, y, w, h };
}
