import { describe, it, expect } from 'vitest';
import { viewTransform, moveFromCss, movable, nodeGeometry } from './geometry.js';
const geometry = { x: 127000, y: 254000, width: 508000, height: 254000, rotation: 90 };
const shape = { type: 'shape', shape: 'rect', fill: '#123456', geometry, extensions: { editableGeometry: true } };
describe('canonical coordinates', () => {
  it.each([0.5, 1, 2])('inverts centered fit and zoom %s without DPR', zoom => {
    const view = viewTransform({ width: 1270000, height: 635000 }, { width: 400, height: 400 }, zoom);
    expect(view).toEqual({ scale: 4 * zoom, x: (400 - 400 * zoom) / 2, y: (400 - 200 * zoom) / 2 });
    expect(moveFromCss(geometry, { x: 1.25 * view.scale, y: -2.5 * view.scale }, view)).toEqual({ x: 142875, y: 222250 });
    expect(moveFromCss(geometry, { x: 0.000001, y: 0 }, view)).toEqual({ x: geometry.x, y: geometry.y });
  });
  it('rejects invalid or nonpositive viewport/zoom/slide sizes', () => {
    for (const value of [0, -1, NaN, Infinity]) {
      expect(viewTransform({ width: 100, height: 100 }, { width: value, height: 100 }, 1)).toBeNull();
      expect(viewTransform({ width: 100, height: 100 }, { width: 100, height: 100 }, value)).toBeNull();
      expect(viewTransform({ width: value, height: 100 }, { width: 100, height: 100 }, 1)).toBeNull();
    }
  });
  it('places rotation about the canonical center', () => {
    expect(nodeGeometry(geometry)).toEqual({ x: 30, y: 30, width: 40, height: 20, offsetX: 20, offsetY: 10, rotation: 90 });
  });
  it('requires a supported editable primitive and rejects ODP rotation', () => {
    expect(movable(shape, {})).toBe(true);
    expect(movable({ ...shape, source: { format: 'odp' } }, {})).toBe(false);
    expect(movable(shape, { sourceFormat: 'odp' })).toBe(false);
    expect(movable({ ...shape, extensions: {} }, {})).toBe(false);
    expect(movable({ ...shape, type: 'group' }, {})).toBe(false);
    expect(movable({ ...shape, geometry: { ...geometry, width: 0 } }, {})).toBe(false);
    expect(movable({ ...shape, geometry: { ...geometry, rotation: 0 } }, { sourceFormat: 'odp' })).toBe(true);
  });
});
