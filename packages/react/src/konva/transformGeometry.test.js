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
    expect(clampTransformBox(oldBox, { x: 10, y: 20, width: 0.5, height: 40, rotation: 0 }, 2)).toEqual({
      x: 10, y: 20, width: 2, height: 40, rotation: 0,
    });
    expect(clampTransformBox(oldBox, { x: 10, y: 20, width: 50, height: -5, rotation: 0 }, 2)).toEqual({
      x: 10, y: 20, width: 50, height: 2, rotation: 0,
    });
    expect(clampTransformBox(oldBox, { x: 58, y: 20, width: 0.5, height: 40, rotation: 0 }, 2)).toEqual({
      x: 10, y: 20, width: 50, height: 40, rotation: 0,
    });
    const valid = { x: 10, y: 20, width: 60, height: 45, rotation: 0 };
    expect(clampTransformBox(oldBox, valid, 2)).toEqual(valid);
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

  it('keeps rotation absent when startGeometry had none and normalized rotation is 0, while preserving explicit or nonzero rotation', () => {
    const withoutRotation = { x: 0, y: 0, width: 127000, height: 127000 };
    const resizedNoRot = normalizeTransformGeometry({
      centerX: 10,
      centerY: 10,
      widthPx: 20,
      heightPx: 20,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      startGeometry: withoutRotation,
    });
    expect('rotation' in resizedNoRot).toBe(false);

    const rotatedFromAbsent = normalizeTransformGeometry({
      centerX: 10,
      centerY: 10,
      widthPx: 20,
      heightPx: 20,
      scaleX: 1,
      scaleY: 1,
      rotation: 45,
      startGeometry: withoutRotation,
    });
    expect(rotatedFromAbsent.rotation).toBe(45);

    const rotatedBackToZero = normalizeTransformGeometry({
      centerX: 10,
      centerY: 10,
      widthPx: 20,
      heightPx: 20,
      scaleX: 1,
      scaleY: 1,
      rotation: 360,
      startGeometry: { ...withoutRotation, rotation: 90 },
    });
    expect('rotation' in rotatedBackToZero).toBe(true);
    expect(rotatedBackToZero.rotation).toBe(0);
  });

  it('preserves exact fractional startGeometry.rotation when unchanged, and rounds only when changed', () => {
    const startGeometry = { x: 100000, y: 100000, width: 1905000, height: 952500, rotation: 33.333333 };
    const noOp = normalizeTransformGeometry({
      centerX: (100000 + 1905000 / 2) / EMU_PER_PX,
      centerY: (100000 + 952500 / 2) / EMU_PER_PX,
      widthPx: 200,
      heightPx: 100,
      scaleX: 1,
      scaleY: 1,
      rotation: 33.333333,
      startGeometry,
    });
    expect(noOp.rotation).toBe(33.333333);
    expect(geometriesEqual(noOp, startGeometry)).toBe(true);

    const resized = normalizeTransformGeometry({
      centerX: (100000 + 1905000 / 2) / EMU_PER_PX,
      centerY: (100000 + 952500 / 2) / EMU_PER_PX,
      widthPx: 200,
      heightPx: 100,
      scaleX: 1.5,
      scaleY: 1,
      rotation: 33.333333,
      startGeometry,
    });
    expect(resized.rotation).toBe(33.333333);

    const rotated = normalizeTransformGeometry({
      centerX: (100000 + 1905000 / 2) / EMU_PER_PX,
      centerY: (100000 + 952500 / 2) / EMU_PER_PX,
      widthPx: 200,
      heightPx: 100,
      scaleX: 1,
      scaleY: 1,
      rotation: 45.678,
      startGeometry,
    });
    expect(rotated.rotation).toBe(45.68);
  });

  it('clamps rotated boxes in local space (30 and 90 deg) and stops aspect-locked resize at minimum', () => {
    for (const deg of [30, 90]) {
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const oldBox = { x: 100, y: 100, width: 80, height: 40, rotation: rad };
      // Simulate dragging bottom-right past top-left in local space (top-left fixed, width < min, then crossed over)
      const clampedLeadingFixed = clampTransformBox(oldBox, { x: 100, y: 100, width: 0.5, height: 40, rotation: rad }, 2);
      expect(clampedLeadingFixed).toEqual({ x: 100, y: 100, width: 2, height: 40, rotation: rad });

      // Dragging top-left past bottom-right in local space: opposite corner (80, 40) in local stays fixed
      const shiftX = 79.5 * cos;
      const shiftY = 79.5 * sin;
      const clampedCrossOver = clampTransformBox(
        oldBox,
        { x: 100 + shiftX, y: 100 + shiftY, width: 0.5, height: 40, rotation: rad },
        2,
      );
      expect(clampedCrossOver).toEqual(oldBox);
    }

    // Aspect-locked resize below min on one axis returns oldBox so ratio holds
    const aspectOld = { x: 10, y: 20, width: 100, height: 50, rotation: 0 };
    const aspectTooSmall = { x: 10, y: 20, width: 3, height: 1.5, rotation: 0 };
    expect(clampTransformBox(aspectOld, aspectTooSmall, 2)).toEqual(aspectOld);
  });

  it('preserves sub-1pt unchanged dimensions on no-op, rotate, and other-axis resize in normalizeTransformGeometry and clampTransformBox', () => {
    const sub1pt = { x: 100000, y: 200000, width: 127000, height: 6350, rotation: 0 };
    const cx = (sub1pt.x + sub1pt.width / 2) / EMU_PER_PX;
    const cy = (sub1pt.y + sub1pt.height / 2) / EMU_PER_PX;
    const wPx = sub1pt.width / EMU_PER_PX;
    const hPx = sub1pt.height / EMU_PER_PX;

    // No-op preserves 6350 height and y
    const noOp = normalizeTransformGeometry({
      centerX: cx, centerY: cy, widthPx: wPx, heightPx: hPx, scaleX: 1, scaleY: 1, rotation: 0, startGeometry: sub1pt,
    });
    expect(noOp).toEqual(sub1pt);
    expect(geometriesEqual(noOp, sub1pt)).toBe(true);

    // Rotation-only preserves 6350 height and y
    const rotated = normalizeTransformGeometry({
      centerX: cx, centerY: cy, widthPx: wPx, heightPx: hPx, scaleX: 1, scaleY: 1, rotation: 45, startGeometry: sub1pt,
    });
    expect(rotated.height).toBe(6350);
    expect(rotated.y).toBe(200000);
    expect(rotated.rotation).toBe(45);

    // Width-only resize preserves 6350 height and y
    const resizedWidth = normalizeTransformGeometry({
      centerX: cx + wPx / 2, centerY: cy, widthPx: wPx, heightPx: hPx, scaleX: 2, scaleY: 1, rotation: 0, startGeometry: sub1pt,
    });
    expect(resizedWidth.width).toBe(254000);
    expect(resizedWidth.height).toBe(6350);
    expect(resizedWidth.y).toBe(200000);

    // clampTransformBox lets unchanged sub-1pt axis pass through on rotate and other-axis resize
    const oldSubBox = { x: 10, y: 20, width: 50, height: 0.5, rotation: 0 };
    const rotatedSubBox = { x: 12, y: 22, width: 50, height: 0.5, rotation: 0.5 };
    expect(clampTransformBox(oldSubBox, rotatedSubBox, 2)).toEqual(rotatedSubBox);

    const widthResizedSubBox = { x: 10, y: 20, width: 80, height: 0.5, rotation: 0 };
    expect(clampTransformBox(oldSubBox, widthResizedSubBox, 2)).toEqual(widthResizedSubBox);
  });
});
