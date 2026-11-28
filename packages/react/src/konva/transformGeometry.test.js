import { describe, expect, it } from 'vitest';
import {
  EMU_PER_PX,
  MIN_OBJECT_SIZE_EMU,
  ROTATION_SNAPS_15,
  clampTransformBox,
  geometriesEqual,
  normalizeRotation,
  normalizeTransformGeometry,
} from './transformGeometry.js';

describe('KONVA-4 transformGeometry helpers', () => {
  it('normalizes rotation to [0, 360) rounded to 0.01 degrees', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(-0)).toBe(0);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(359.996)).toBe(0);
    expect(normalizeRotation(-45)).toBe(315);
    expect(normalizeRotation(725.125)).toBe(5.13);
    expect(normalizeRotation(Number.NaN)).toBeNull();
    expect(normalizeRotation(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('normalizes transient Konva scale into integer EMU geometry and preserves center', () => {
    const startGeometry = { x: 127000, y: 254000, width: 1270000, height: 635000, rotation: 0 };
    const result = normalizeTransformGeometry({
      centerX: (127000 + 1270000) / EMU_PER_PX,
      centerY: (254000 + 635000 / 2) / EMU_PER_PX,
      widthPx: 1270000 / EMU_PER_PX,
      heightPx: 635000 / EMU_PER_PX,
      scaleX: 2,
      scaleY: 1,
      rotation: -90,
      startGeometry,
    });
    expect(result).toEqual({
      x: 127000,
      y: 254000,
      width: 2540000,
      height: 635000,
      rotation: 270,
    });
  });

  it('clamps below-1pt dimensions to 12700 EMU and rejects negative scale or nonfinite inputs', () => {
    const startGeometry = { x: 0, y: 0, width: 127000, height: 127000, rotation: 0 };
    const clamped = normalizeTransformGeometry({
      centerX: 1,
      centerY: 1,
      widthPx: 10,
      heightPx: 10,
      scaleX: 0.01,
      scaleY: 0.01,
      rotation: 0,
      startGeometry,
    });
    expect(clamped.width).toBe(MIN_OBJECT_SIZE_EMU);
    expect(clamped.height).toBe(MIN_OBJECT_SIZE_EMU);

    expect(normalizeTransformGeometry({
      centerX: 10, centerY: 10, widthPx: 10, heightPx: 10, scaleX: -1, scaleY: 1, rotation: 0, startGeometry,
    })).toBeNull();
    expect(normalizeTransformGeometry({
      centerX: Number.NaN, centerY: 10, widthPx: 10, heightPx: 10, scaleX: 1, scaleY: 1, rotation: 0, startGeometry,
    })).toBeNull();
  });

  it('clamps boundBoxFunc at the minimum stage size and exports 15-degree snaps', () => {
    const oldBox = { x: 10, y: 20, width: 50, height: 40, rotation: 0 };
    expect(clampTransformBox(oldBox, { x: 10, y: 20, width: 0.5, height: 40, rotation: 0 }, 2)).toBe(oldBox);
    expect(clampTransformBox(oldBox, { x: 10, y: 20, width: 50, height: -5, rotation: 0 }, 2)).toBe(oldBox);
    const valid = { x: 10, y: 20, width: 60, height: 45, rotation: 0 };
    expect(clampTransformBox(oldBox, valid, 2)).toBe(valid);
    expect(ROTATION_SNAPS_15).toHaveLength(24);
    expect(ROTATION_SNAPS_15[0]).toBe(0);
    expect(ROTATION_SNAPS_15[23]).toBe(345);
  });

  it('compares geometries for no-op detection', () => {
    const a = { x: 100, y: 200, width: 30000, height: 40000, rotation: 0 };
    expect(geometriesEqual(a, { ...a })).toBe(true);
    expect(geometriesEqual(a, { ...a, rotation: 15 })).toBe(false);
    expect(geometriesEqual({ x: 100, y: 200, width: 30000, height: 40000 }, a)).toBe(true);
  });
});
