// Canonical free-form shape vocabulary — the SINGLE source both surfaces read,
// so a shape can't drift between the canvas and the export:
//   - the canvas renderer (`ElementView`) uses `clip` (CSS clip-path), `round`
//     (full ellipse), or `radius` (CSS border-radius px);
//   - the PPTX export (`addElements`) uses `pptx` (a pptxgenjs ShapeType key).
// Add a shape here once and both pick it up. `line` is the thin-rule special
// case (a sharp-cornered rect whose height is an adjustable stroke thickness —
// floored at MIN_LINE_THICKNESS in lib/elements.js); text & image aren't shapes.

// Frozen (incl. each nested def) — a shared global registry, matching the
// codebase's exported-constant convention (riskSpec/chartSpec/DECK_CHROME_FIELDS).
export const SHAPES = Object.freeze({
  shape: { pptx: 'rect', radius: 8 },
  rounded: { pptx: 'roundRect', radius: 28 },
  circle: { pptx: 'ellipse', round: true },
  triangle: { pptx: 'triangle', clip: 'polygon(50% 0, 100% 100%, 0 100%)' },
  diamond: { pptx: 'diamond', clip: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' },
  pentagon: { pptx: 'pentagon', clip: 'polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%)' },
  hexagon: { pptx: 'hexagon', clip: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)' },
  star: { pptx: 'star5', clip: 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)' },
  arrow: { pptx: 'rightArrow', clip: 'polygon(0 30%,60% 30%,60% 0,100% 50%,60% 100%,60% 70%,0 70%)' },
  line: { pptx: 'rect', line: true },
});
Object.values(SHAPES).forEach(Object.freeze);

// Model-level aliases (same visual, alternate type token): the shape menu emits
// `shape` for a rectangle, but the canonical rect/ellipse tokens also resolve.
const ALIASES = Object.freeze({ rect: 'shape', ellipse: 'circle' });

// Own-property check (not `Object.hasOwn`, which is absent on Vite's default
// targets like Safari 14 / Chrome 87) so a prototype-chain key (e.g. a
// deck-supplied type:'constructor' from PUT/MCP) resolves to null.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Resolve an element type to its shape definition (null for non-shapes/unknown).
export function shapeDef(type) {
  if (own(SHAPES, type)) return SHAPES[type];
  if (own(ALIASES, type)) return SHAPES[ALIASES[type]];
  return null;
}

// Does this shape take a stroke (outline)? Only the box shapes — rect / rounded
// rect / ellipse — whose visual edge is the element's `border-radius` box, so a
// CSS `border` follows the outline on the canvas (and `addShape`'s `line` matches
// on export). A `clip`-path polygon would have its border clipped away, and a
// `line` is itself a stroke; both are excluded (proper outlines for them need SVG
// rendering — a follow-up). Non-shapes (text/image) take no stroke.
export function isStrokeableShape(type) {
  const def = shapeDef(type);
  return !!def && !def.clip && !def.line;
}

// Does this element have a VISIBLE outline to draw — a strokeable box shape with a
// colour and a positive width? The single predicate the canvas border and the
// export line both gate on, so the two can't disagree (canvas == export).
export function hasVisibleStroke(el) {
  return !!el && isStrokeableShape(el.type) && !!el.stroke && el.strokeWidth > 0;
}
