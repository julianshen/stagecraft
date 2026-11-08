// The canvas painter (Phase K): scene nodes → Canvas2D, through the vendored
// officeview drawing engine (preset geometry, Office fills and lines, text
// layout). Framework-free — a plain `ctx` in — so the editor stage, thumbnails,
// the presenter and PDF export all paint with the same code.
//
// The caller sets the transform (fit scale × devicePixelRatio); everything here
// works in slide px. Each node is prepared once (geometry, style, text layout)
// on the paint env, so repainting a slide (a drag, a zoom) lays nothing out again.
import { resolvePreset } from '../vendor/officeview/drawing/geometry';
import { paintGeometry } from '../vendor/officeview/drawing/paint';
import { layoutTextBody } from '../vendor/officeview/drawing/text-layout';
import { paintTextBody, createTextBodyMeasurer } from '../vendor/officeview/drawing/text-paint';
import { hexToRgb } from '../lib/color.js';
import { dashArray, fontStack, linAngle, FONT_SANS, FONT_MONO, IMAGE_PLACEHOLDER } from '../lib/elements.js';

// The outline dashes as PowerPoint presets (what the export's dashType writes).
const SHAPE_DASH = { solid: 'solid', dashed: 'dash', dotted: 'sysDot' };
const ANCHOR = { top: 't', middle: 'ctr', bottom: 'b' };

/**
 * A fresh paint env: decoded images (src → drawable, or false once a decode
 * failed; at most `imageLimit`, least recently painted dropped first) with their in-flight decodes, each font spec's load (or 'done'), and
 * the epoch that bumps when fonts arrive (assets.js), and `prepared` — each
 * node's painter-ready form (officeview style, geometry, text layout), made
 * once per node. Scenes are immutable and rebuilt only when their slide
 * changes, so this lives exactly as long as the nodes it describes.
 */
export const createPaintEnv = ({ imageLimit = 256 } = {}) => ({
  images: new Map(), imageLimit, pending: new Map(), fonts: new Map(), fontEpoch: 0,
  prepared: new WeakMap(),
});

const rgba = (hex, a = 1) => ({ ...hexToRgb(hex), a });
const css = (hex, a = 1) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

// A node's painter-ready form, made on its first paint.
function prepared(env, node, make) {
  let p = env.prepared.get(node);
  if (!p) {
    p = make(node);
    env.prepared.set(node, p);
  }
  return p;
}

/**
 * A text box's canvas font stack: its family (with the same substitutes the
 * canvas uses) over the app sans. A box with no family is given the app sans
 * stack itself as its family (officeview would read none as Calibri), and that
 * stack resolves to itself.
 */
export const canvasFont = (family) => (family && family !== FONT_SANS ? fontStack(family, FONT_SANS) : FONT_SANS);

// A CSS drop shadow in the element's frame, as canvas shadow settings: canvas
// shadows ignore the transform, so map the local offset (and the blur's
// scale) through it — the offset then turns and mirrors with the element, as
// the CSS filter does.
function deviceShadow(ctx, s) {
  const m = ctx.getTransform();
  return {
    color: css(s.color, s.alpha),
    offsetX: m.a * s.x + m.c * s.y,
    offsetY: m.b * s.x + m.d * s.y,
    blurPx: s.blur * Math.hypot(m.a, m.b),
  };
}

function applyShadow(ctx, s) {
  const d = deviceShadow(ctx, s);
  ctx.shadowColor = d.color;
  ctx.shadowOffsetX = d.offsetX;
  ctx.shadowOffsetY = d.offsetY;
  ctx.shadowBlur = d.blurPx;
}

function drawingFill(fill) {
  if (fill.kind === 'solid') return { kind: 'solid', color: rgba(fill.color) };
  return {
    kind: 'gradient', gradient: 'linear', scaled: false,
    angle: (linAngle(fill.angle) / 60000) * (Math.PI / 180), // the export's a:lin ang, in radians
    stops: [{ position: 0, color: rgba(fill.from) }, { position: 1, color: rgba(fill.to) }],
  };
}

// A shape's shadow goes through officeview's silhouette pass (all shadows
// first, then the fill and outline over them), so an outline's shadow can't
// fall across its own fill; rotWithShape maps the offset through the frame.
// That pass fills the silhouette with the shadow colour itself, so its alpha
// applies twice (shadowColor × source): hand it √alpha so the shadow lands at
// exactly `alpha`, as the CSS filter and the export draw it. (Upstream fix
// pending — paint.paint.test.js pins the shadow's exact strength.)
const silhouetteAlpha = (alpha) => Math.sqrt(alpha);
const prepareShape = (node) => ({
  geometry: resolvePreset(node.preset, node.w, node.h, node.adjust),
  style: {
    fill: drawingFill(node.fill),
    ...(node.line && { line: { width: node.line.width, fill: { kind: 'solid', color: rgba(node.line.color) }, dash: SHAPE_DASH[node.line.dash] } }),
    ...(node.shadow && { shadow: { color: rgba(node.shadow.color, silhouetteAlpha(node.shadow.alpha)), blurPx: node.shadow.blur, offsetX: node.shadow.x, offsetY: node.shadow.y, rotWithShape: true } }),
    issues: [],
  },
});

function paintShape(ctx, node, env) {
  const { geometry, style } = prepared(env, node, prepareShape);
  paintGeometry(ctx, geometry, style, node.w, node.h);
}

// A pen stroke: round caps and joins, and the canvas's own dash pattern.
function paintPath(ctx, node, env) {
  const { points, w, h, width } = node;
  if (!(width > 0)) return;
  const { stroke, dash } = prepared(env, node, (n) => ({ stroke: css(n.color), dash: dashArray(n.dash, n.width) }));
  ctx.beginPath();
  ctx.moveTo(points[0][0] * w, points[0][1] * h);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0] * w, points[i][1] * h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash);
  ctx.stroke();
}

function paintPlaceholder(ctx, { w, h }) {
  ctx.fillStyle = IMAGE_PLACEHOLDER.fill;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = IMAGE_PLACEHOLDER.ink;
  ctx.font = `${IMAGE_PLACEHOLDER.fontSize}px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(IMAGE_PLACEHOLDER.label, w / 2, h / 2);
}

/** A decoded image, marked as just used — the image cache drops the least recently used first. */
export function touchImage(env, src) {
  const img = env.images.get(src);
  if (img !== undefined) {
    env.images.delete(src);
    env.images.set(src, img);
  }
  return img;
}

// Fill / Fit / Stretch, as CSS object-fit cover / contain / fill draw them.
function paintImage(ctx, node, env) {
  const img = node.src ? touchImage(env, node.src) : null;
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
const textBody = (node) => {
  const color = css(node.color);
  return {
    paragraphs: node.content.split('\n').map((text) => ({
      runs: [{ text, fontSizePt: node.fontSize * 0.75, bold: node.bold, italic: node.italic, color, fontFamily: node.fontFamily ?? FONT_SANS }],
      align: node.align, level: 0,
      lineSpacing: { kind: 'percent', value: node.lineSpacing / 1.2 }, // officeview's 100% is 1.2 em
    })),
    anchor: ANCHOR[node.valign], insetLeftEmu: 0, insetRightEmu: 0, insetTopEmu: 0, insetBottomEmu: 0, wrap: true,
  };
};

function paintText(ctx, node, env) {
  if (!node.content) return;
  const p = prepared(env, node, (n) => ({ body: textBody(n), layout: null, epoch: -1 }));
  // Laid out once per node, and again only when fonts arrive (measured with the fallback before).
  if (p.epoch !== env.fontEpoch) {
    p.layout = layoutTextBody(p.body, node.w, node.h, createTextBodyMeasurer(ctx, canvasFont));
    p.epoch = env.fontEpoch;
  }
  // officeview sets each segment's shadow from its style (clearing it when there
  // is none), so the box's shadow rides on its laid-out segments, mapped
  // through this paint's transform (a thumbnail and the editor differ).
  if (node.shadow) {
    const textShadow = deviceShadow(ctx, node.shadow);
    for (const line of p.layout.lines) for (const seg of line.segments) seg.style.textShadow = textShadow;
  }
  paintTextBody(p.body, ctx, 0, 0, node.w, node.h, canvasFont, undefined, { layout: p.layout });
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
    // Opacity applies to each fill and outline, as PowerPoint applies the
    // export's per-fill and per-line transparency (where the DOM fades the
    // element as one group).
    ctx.globalAlpha *= node.opacity;
    // Shapes cast theirs in paintGeometry, and text through its segments.
    if (node.shadow && (node.kind === 'path' || node.kind === 'image')) applyShadow(ctx, node.shadow);
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
