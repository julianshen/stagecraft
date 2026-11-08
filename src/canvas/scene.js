// The scene builder (Phase K, docs/CANVAS-EDITOR.md §6): a slide → plain,
// serialisable draw nodes in slide px. Pure: no canvas, no React, no officeview,
// so it is unit-tested in jsdom and shared by every surface (the painter, later
// the Konva stage and the PPTX export, decision 8).
//
// Each node resolves the element exactly as the canvas renders and the export
// writes it today — the same defaults, validity checks and fallbacks, read from
// the same helpers — so switching a surface to the canvas changes no deck.
// Where the DOM renderer only approximated PowerPoint, the node follows
// PowerPoint (the export): preset geometry for the clip-path shapes, and
// outlines centred on the edge.
//
// K1 covers the `elements` overlay, which is the whole of a `blank` slide.
// Template layouts' own content (titles, KPI tiles, charts…) is compiled in K3;
// until then their scenes are flagged `template: true`.
import { slideDims } from '../lib/slideDims.js';
import { shapeDef, hasVisibleStroke } from '../lib/shapes.js';
import { isHexColor, toHex } from '../lib/color.js';
import {
  INK, SHADOW_OPACITY, isRenderableShadow, isRenderableGradient, isFinitePoint,
  lineSpacingOf, valignOf, fitOf, opacityOf, orientation, STROKE_DASHES,
} from '../lib/elements.js';

const ALIGNS = ['left', 'center', 'right'];
const finite = (...vs) => vs.every(Number.isFinite);
const dashOf = (d) => (STROKE_DASHES.includes(d) ? d : 'solid');

const shadowOf = (el) => (isRenderableShadow(el.shadow)
  ? { color: el.shadow.color, alpha: SHADOW_OPACITY, blur: el.shadow.blur, x: el.shadow.x, y: el.shadow.y }
  : null);

// A shape's fill: a valid gradient, else its hex fill, else `fallback` (the
// export's toHex fallback for shapes; ink for a line, as the canvas draws it).
function fillOf(el, fallback) {
  if (isRenderableGradient(el.gradient)) return { kind: 'gradient', from: el.gradient.from, to: el.gradient.to, angle: el.gradient.angle };
  return { kind: 'solid', color: isHexColor(el.fill) ? el.fill : fallback };
}

function shapeNode(el, def) {
  if (def.line) return { kind: 'shape', preset: 'rect', adjust: {}, fill: fillOf(el, INK), line: null };
  // A box with a corner radius (the registry's `radius`, px) is drawn as roundRect at that radius.
  const { radius } = def;
  const preset = radius ? 'roundRect' : def.pptx;
  // roundRect's `adj` is the corner radius as a fraction (×100000) of the shorter side, at most half.
  const adjust = radius ? { adj: Math.min(50000, (radius / Math.min(el.w, el.h)) * 100000) } : {};
  const line = hasVisibleStroke(el) ? { color: toHex(el.stroke), width: el.strokeWidth, dash: dashOf(el.strokeDash) } : null;
  return { kind: 'shape', preset, adjust, fill: fillOf(el, toHex(null)), line };
}

function pathNode(el) {
  const points = (Array.isArray(el.points) ? el.points : []).filter(isFinitePoint).map(([x, y]) => [x, y]);
  if (points.length < 2) return null; // nothing to stroke (the export skips it too)
  return {
    kind: 'path', points,
    color: isHexColor(el.stroke) ? el.stroke : INK,
    width: Number.isFinite(el.strokeWidth) ? el.strokeWidth : 2,
    dash: dashOf(el.strokeDash),
  };
}

const imageNode = (el) => ({ kind: 'image', src: typeof el.src === 'string' && el.src ? el.src : null, fit: fitOf(el) });

const textNode = (el) => ({
  kind: 'text',
  content: typeof el.content === 'string' ? el.content : '',
  color: isHexColor(el.color) ? el.color : INK,
  fontSize: Number.isFinite(el.fontSize) && el.fontSize > 0 ? el.fontSize : 48,
  bold: !!el.bold,
  italic: !!el.italic,
  align: ALIGNS.includes(el.align) ? el.align : 'left',
  valign: valignOf(el),
  fontFamily: typeof el.fontFamily === 'string' && el.fontFamily.trim() ? el.fontFamily.trim() : null,
  lineSpacing: lineSpacingOf(el),
});

function contentOf(el) {
  if (el.type === 'text') return textNode(el);
  if (el.type === 'image') return imageNode(el);
  if (el.type === 'path') return pathNode(el);
  const def = shapeDef(el.type);
  return def ? shapeNode(el, def) : null;
}

/** One element's draw node, or null when there is nothing to draw (junk, unknown type, bad box). */
export function elementNode(el) {
  if (!el || typeof el !== 'object' || !finite(el.x, el.y, el.w, el.h)) return null;
  const content = contentOf(el);
  if (!content) return null;
  return {
    id: el.id, x: el.x, y: el.y, w: el.w, h: el.h,
    ...orientation(el), opacity: opacityOf(el), shadow: shadowOf(el),
    ...content,
  };
}

/**
 * A slide's scene at `dims` (the deck's slideDims): its size, background, and
 * element nodes in z-order. `template` marks layouts whose own content (and
 * background) K3 compiles; until then their scene is just white plus their
 * elements.
 */
export function buildScene(slide, { w, h } = slideDims()) {
  const blank = slide?.layout === 'blank';
  const elements = Array.isArray(slide?.elements) ? slide.elements : [];
  return {
    w, h,
    background: blank && isHexColor(slide.bgColor) ? slide.bgColor : '#ffffff',
    template: !blank,
    nodes: elements.map(elementNode).filter(Boolean),
  };
}
