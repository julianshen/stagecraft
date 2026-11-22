// Pixel probe: the vendored painter draws real geometry on a real Canvas2D
// (headless Chromium — the `paint` project).
import { describe, it, expect } from 'vitest';
import { resolvePreset } from './drawing/geometry';
import { paintGeometry } from './drawing/paint';

const RED = { r: 255, g: 0, b: 0, a: 1 };
const pixel = (ctx, x, y) => [...ctx.getImageData(x, y, 1, 1).data];

describe('officeview painter on a real canvas', () => {
  it('fills a preset star and leaves its outside untouched', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    const issues = paintGeometry(ctx, resolvePreset('star5', 200, 200), { fill: { kind: 'solid', color: RED }, issues: [] }, 200, 200);
    expect(issues).toEqual([]);
    expect(pixel(ctx, 100, 110)).toEqual([255, 0, 0, 255]); // the star's body
    expect(pixel(ctx, 5, 5)[3]).toBe(0); // a corner, outside the star
    expect(pixel(ctx, 100, 195)[3]).toBe(0); // between the two lower points
  });
});
