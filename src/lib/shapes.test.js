import { describe, it, expect } from 'vitest';
import { SHAPES, shapeDef, isStrokeableShape, isFillableShape, hasVisibleStroke, clipPoints } from './shapes.js';

describe('shapeDef', () => {
  it('resolves the menu rectangle type to a rect with a border radius', () => {
    expect(shapeDef('shape')).toMatchObject({ pptx: 'rect', radius: 8 });
  });
  it('resolves model aliases (rect→shape, ellipse→circle)', () => {
    expect(shapeDef('rect')).toBe(SHAPES.shape);
    expect(shapeDef('ellipse')).toBe(SHAPES.circle);
  });
  it('marks the full-ellipse and rounded shapes', () => {
    expect(shapeDef('circle').round).toBe(true);
    expect(shapeDef('rounded').radius).toBe(28);
  });
  it('carries a clip-path and a pptx ShapeType for polygon shapes', () => {
    expect(shapeDef('triangle')).toMatchObject({ pptx: 'triangle' });
    expect(shapeDef('triangle').clip).toMatch(/^polygon\(/);
    expect(shapeDef('star').pptx).toBe('star5');
    expect(shapeDef('arrow').pptx).toBe('rightArrow');
  });
  it('marks the line special case', () => {
    expect(shapeDef('line')).toMatchObject({ pptx: 'rect', line: true });
  });
  it('returns null for a non-shape / unknown type', () => {
    expect(shapeDef('text')).toBeNull();
    expect(shapeDef('image')).toBeNull();
    expect(shapeDef('nope')).toBeNull();
  });

  it('returns null for prototype-chain keys (not the inherited Object method)', () => {
    expect(shapeDef('constructor')).toBeNull();
    expect(shapeDef('toString')).toBeNull();
    expect(shapeDef('hasOwnProperty')).toBeNull();
  });

  it('freezes the registry and each shape definition', () => {
    expect(Object.isFrozen(SHAPES)).toBe(true);
    Object.values(SHAPES).forEach((def) => expect(Object.isFrozen(def)).toBe(true));
  });
});

describe('isStrokeableShape', () => {
  it('is true for the box shapes whose CSS border follows their outline (rect/rounded/ellipse)', () => {
    ['shape', 'rounded', 'circle', 'rect', 'ellipse'].forEach((t) => expect(isStrokeableShape(t)).toBe(true));
  });
  it('is true for clip-path polygons too — they stroke via an SVG outline overlay', () => {
    ['triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arrow'].forEach((t) => expect(isStrokeableShape(t)).toBe(true));
  });
  it('is false for the line (itself a stroke) and non-shapes / unknown types', () => {
    ['line', 'text', 'image', 'nope', 'constructor'].forEach((t) => expect(isStrokeableShape(t)).toBe(false));
  });
});

describe('clipPoints', () => {
  it('parses a CSS clip-path polygon() string into 0..1 point pairs', () => {
    expect(clipPoints('polygon(50% 0, 100% 100%, 0 100%)')).toEqual([[0.5, 0], [1, 1], [0, 1]]);
  });
  it('handles comma-separated pairs without spaces (e.g. the star)', () => {
    expect(clipPoints('polygon(50% 0,100% 50%,0 50%)')).toEqual([[0.5, 0], [1, 0.5], [0, 0.5]]);
  });
  it('parses the real star clip (10 points, bare-0 coords) to finite 0..1 pairs', () => {
    const pts = clipPoints(shapeDef('star').clip);
    expect(pts).toHaveLength(10);
    expect(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1)).toBe(true);
  });
});

describe('isFillableShape', () => {
  it('is true for every shape — incl. clip polygons and the line (all carry a background fill)', () => {
    ['shape', 'rounded', 'circle', 'rect', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arrow', 'line'].forEach((t) => expect(isFillableShape(t)).toBe(true));
  });
  it('is false for non-shapes / unknown types (text uses fill as its ink, image has none)', () => {
    ['text', 'image', 'nope', 'constructor'].forEach((t) => expect(isFillableShape(t)).toBe(false));
  });
});

describe('hasVisibleStroke', () => {
  // The one predicate the canvas border and export line share, so they agree.
  it('is true only for a strokeable box shape with a colour and a positive width', () => {
    expect(hasVisibleStroke({ type: 'rect', stroke: '#000', strokeWidth: 2 })).toBe(true);
    expect(hasVisibleStroke({ type: 'rect', stroke: '#000', strokeWidth: 0 })).toBe(false); // 0 width = no outline
    expect(hasVisibleStroke({ type: 'rect', strokeWidth: 2 })).toBe(false);                 // no colour
    expect(hasVisibleStroke({ type: 'triangle', stroke: '#000', strokeWidth: 2 })).toBe(true); // clip polygon strokes via SVG overlay
    expect(hasVisibleStroke(null)).toBe(false);
  });
});
