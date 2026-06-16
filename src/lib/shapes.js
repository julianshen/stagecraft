// Canonical free-form shape vocabulary — the SINGLE source both surfaces read,
// so a shape can't drift between the canvas and the export:
//   - the canvas renderer (`ElementView`) uses `clip` (CSS clip-path), `round`
//     (full ellipse), or `radius` (CSS border-radius px);
//   - the PPTX export (`addElements`) uses `pptx` (a pptxgenjs ShapeType key).
// Add a shape here once and both pick it up. `line` is the thin-rule special
// case (rendered as a clamped bar / a thin rect); text & image aren't shapes.
export const LINE_MAX_THICKNESS = 8; // a line caps at this px on both surfaces

export const SHAPES = {
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
};

// Model-level aliases (same visual, alternate type token): the shape menu emits
// `shape` for a rectangle, but the canonical rect/ellipse tokens also resolve.
const ALIASES = { rect: 'shape', ellipse: 'circle' };

// Resolve an element type to its shape definition (null for non-shapes/unknown).
// `Object.hasOwn` so a prototype-chain key (e.g. a deck-supplied type:'constructor'
// from PUT/MCP) resolves to null, not the inherited Object method.
export function shapeDef(type) {
  if (Object.hasOwn(SHAPES, type)) return SHAPES[type];
  if (Object.hasOwn(ALIASES, type)) return SHAPES[ALIASES[type]];
  return null;
}
