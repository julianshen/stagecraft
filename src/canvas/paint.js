// The canvas painter (Phase K): scene nodes → Canvas2D, through the vendored
// officeview drawing engine (preset geometry, Office fills and lines, text
// layout). Framework-free — a plain `ctx` in — so the editor stage, thumbnails,
// the presenter and PDF export all paint with the same code.
//
// The caller sets the transform (fit scale × devicePixelRatio); everything here
// works in slide px. Geometry and text layouts are cached on the paint env, so
// repainting a slide (a drag, a zoom) lays nothing out again.
import { resolvePreset } from '../vendor/officeview/drawing/geometry';
import { paintGeometry } from '../vendor/officeview/drawing/paint';
import { layoutTextBody } from '../vendor/officeview/drawing/text-layout';
import { paintTextBody, createTextBodyMeasurer } from '../vendor/officeview/drawing/text-paint';
import { toHex } from '../lib/color.js';
import { dashArray, fontStack, linAngle } from '../lib/elements.js';

// The canvas's font stacks: the app's --f-sans / --f-mono values (main.css) —
// a canvas font can't read a CSS variable.
const SANS = '"Inter", -apple-system, BlinkMacSystemFont, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
const PLACEHOLDER = { fill: '#eceae4', ink: '#9a978f', label: 'No image' };
// The outline dashes as PowerPoint presets (what the export's dashType writes).
const SHAPE_DASH = { solid: 'solid', dashed: 'dash', dotted: 'sysDot' };
const ANCHOR = { top: 't', middle: 'ctr', bottom: 'b' };
const CACHE_LIMIT = 2000; // per cache, per env

/**
 * A fresh paint env: decoded images (src → drawable, or false once a decode
 * failed) with their in-flight decodes, the font specs already asked for and
 * the epoch that bumps when fonts arrive (assets.js), and the paint caches.
 */
export const createPaintEnv = ({ cacheLimit = CACHE_LIMIT } = {}) => ({
  images: new Map(), pending: new Map(), fonts: new Set(), fontEpoch: 0,
  geometry: new Map(), layouts: new Map(), cacheLimit,
});

// Bounded memo: a long session can't grow a cache without limit (oldest out first).
function memo(map, limit, key, compute) {
  if (map.has(key)) return map.get(key);
  const value = compute();
  if (map.size >= limit) map.delete(map.keys().next().value);
  map.set(key, value);
  return value;
}

const rgb = (hex, a = 1) => {
  const h = toHex(hex);
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a };
};
const css = (hex, a = 1) => {
  const { r, g, b } = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

/** A text box's canvas font stack: its family (with the same substitutes the canvas uses) over the app sans. */
export const canvasFont = (family) => (family ? fontStack(family).replace('var(--f-sans), sans-serif', SANS) : SANS);

// A CSS drop shadow in the element's frame: canvas shadows ignore the
// transform, so map the local offset (and the blur's scale) through it —
// the offset then turns and mirrors with the element, as the CSS filter does.
function applyShadow(ctx, s) {
  const m = ctx.getTransform();
  ctx.shadowColor = css(s.color, s.alpha);
  ctx.shadowOffsetX = m.a * s.x + m.c * s.y;
  ctx.shadowOffsetY = m.b * s.x + m.d * s.y;
  ctx.shadowBlur = s.blur * Math.hypot(m.a, m.b);
}

function drawingFill(fill) {
  if (fill.kind === 'solid') return { kind: 'solid', color: rgb(fill.color) };
  return {
    kind: 'gradient', gradient: 'linear', scaled: false,
    angle: (linAngle(fill.angle) / 60000) * (Math.PI / 180), // the export's a:lin ang, in radians
    stops: [{ position: 0, color: rgb(fill.from) }, { position: 1, color: rgb(fill.to) }],
  };
}

function paintShape(ctx, node, env) {
  const { preset, adjust, w, h } = node;
  const geometry = memo(env.geometry, env.cacheLimit, `${preset}|${w}|${h}|${adjust.adj ?? ''}`, () => resolvePreset(preset, w, h, adjust));
  const line = node.line && { width: node.line.width, fill: { kind: 'solid', color: rgb(node.line.color) }, dash: SHAPE_DASH[node.line.dash] };
  paintGeometry(ctx, geometry, { fill: drawingFill(node.fill), ...(line && { line }), issues: [] }, w, h);
}

// A pen stroke: round caps and joins, and the canvas's own dash pattern.
function paintPath(ctx, { points, w, h, color, width, dash }) {
  if (!(width > 0)) return;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
  ctx.strokeStyle = css(color);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash((dashArray(dash, width) || '').split(' ').filter(Boolean).map(Number));
  ctx.stroke();
}

function paintPlaceholder(ctx, { w, h }) {
  ctx.fillStyle = PLACEHOLDER.fill;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PLACEHOLDER.ink;
  ctx.font = `18px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(PLACEHOLDER.label, w / 2, h / 2);
}

// Fill / Fit / Stretch, as CSS object-fit cover / contain / fill draw them.
function paintImage(ctx, node, env) {
  const img = node.src ? env.images.get(node.src) : null;
  if (!img) { paintPlaceholder(ctx, node); return; } // none, not decoded yet, or failed
  const { w, h, fit } = node;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (fit === 'stretch' || !(iw > 0 && ih > 0)) { ctx.drawImage(img, 0, 0, w, h); return; }
  if (fit === 'contain') {
    const s = Math.min(w / iw, h / ih);
    ctx.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
    return;
  }
  const s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s; // cover: crop the centre
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, w, h);
}

// K1's text: the plain content as one run per line, laid out by officeview.
// K2 replaces this with the rich-text model (runs, bullets, insets, autofit,
// underline) — until then weight 400/700 (the DOM uses 500/700) and no underline.
const textBody = (node) => ({
  paragraphs: node.content.split('\n').map((text) => ({
    runs: [{ text, fontSizePt: node.fontSize * 0.75, bold: node.bold, italic: node.italic, color: css(node.color), fontFamily: node.fontFamily ?? '' }],
    align: node.align, level: 0,
    lineSpacing: { kind: 'percent', value: node.lineSpacing / 1.2 }, // officeview's 100% is 1.2 em
  })),
  anchor: ANCHOR[node.valign], insetLeftEmu: 0, insetRightEmu: 0, insetTopEmu: 0, insetBottomEmu: 0, wrap: true,
});

function paintText(ctx, node, env) {
  if (!node.content) return;
  const body = textBody(node);
  const key = JSON.stringify([node.content, node.fontSize, node.bold, node.italic, node.align, node.valign, node.fontFamily, node.lineSpacing, node.w, node.h, env.fontEpoch]);
  const layout = memo(env.layouts, env.cacheLimit, key, () => layoutTextBody(body, node.w, node.h, createTextBodyMeasurer(ctx, canvasFont)));
  paintTextBody(body, ctx, 0, 0, node.w, node.h, canvasFont, undefined, { layout });
}

const PAINTERS = { shape: paintShape, path: paintPath, image: paintImage, text: paintText };

/** Paint one node in its frame: translated, turned about its centre, mirrored, faded and shadowed. */
export function paintNode(ctx, node, env) {
  ctx.save();
  try {
    ctx.translate(node.x + node.w / 2, node.y + node.h / 2);
    if (node.rot) ctx.rotate((node.rot * Math.PI) / 180);
    if (node.sx < 0 || node.sy < 0) ctx.scale(node.sx, node.sy);
    ctx.translate(-node.w / 2, -node.h / 2);
    ctx.globalAlpha *= node.opacity;
    if (node.shadow) applyShadow(ctx, node.shadow);
    PAINTERS[node.kind](ctx, node, env);
  } finally {
    ctx.restore();
  }
}

/** Paint a whole scene (background, then nodes in z-order) in slide px. */
export function paintSlide(ctx, scene, env) {
  ctx.save();
  try {
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, scene.w, scene.h);
    for (const node of scene.nodes) paintNode(ctx, node, env);
  } finally {
    ctx.restore();
  }
}
