import { describe, it, expect } from 'vitest';
import { SHAPES, shapeDef, LINE_MAX_THICKNESS } from './shapes.js';

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
    expect(LINE_MAX_THICKNESS).toBe(8);
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
