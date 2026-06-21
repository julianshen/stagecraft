import { describe, it, expect } from 'vitest';
import { SHAPES, shapeDef, isStrokeableShape, isFillableShape, hasVisibleStroke } from './shapes.js';

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
  it('is false for clip-path polygons (a CSS border would be clipped away) and the line', () => {
    ['triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arrow', 'line'].forEach((t) => expect(isStrokeableShape(t)).toBe(false));
  });
  it('is false for non-shapes / unknown types', () => {
    ['text', 'image', 'nope', 'constructor'].forEach((t) => expect(isStrokeableShape(t)).toBe(false));
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
    expect(hasVisibleStroke({ type: 'triangle', stroke: '#000', strokeWidth: 2 })).toBe(false); // clip shape
    expect(hasVisibleStroke(null)).toBe(false);
  });
});
