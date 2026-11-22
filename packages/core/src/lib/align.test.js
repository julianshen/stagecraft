import { describe, it, expect } from 'vitest';
import { alignSnap } from './align.js';

const el = { x: 103, y: 200, w: 100, h: 50 };

describe('alignSnap', () => {
  it('snaps the left edge to another element\'s left edge within tolerance', () => {
    const r = alignSnap(el, [{ x: 100, y: 600, w: 80, h: 40 }], { tol: 6 });
    expect(r.x).toBe(100); // left 103 → 100
    expect(r.guides).toContainEqual({ axis: 'v', pos: 100 });
  });

  it('snaps the centre-x to the slide centre', () => {
    const e = { x: 911, y: 0, w: 100, h: 50 }; // centreX 961 ≈ slide centre 960; edges far from any target
    const r = alignSnap(e, [], { bounds: { w: 1920, h: 1080 }, tol: 6 });
    expect(r.x).toBe(910); // centreX 961 → 960 means x = 911 - 1
    expect(r.guides).toContainEqual({ axis: 'v', pos: 960 });
  });

  it('does not snap beyond the tolerance', () => {
    const r = alignSnap(el, [{ x: 90, y: 0, w: 80, h: 40 }], { tol: 6 }); // |103-90|=13 > 6
    expect(r.x).toBe(103);
    expect(r.guides).toHaveLength(0);
  });

  it('picks the closest target when several are within tolerance', () => {
    const r = alignSnap(el, [{ x: 101, y: 0, w: 80, h: 40 }, { x: 99, y: 0, w: 80, h: 40 }], { tol: 6 });
    expect(r.x).toBe(101); // |103-101|=2 beats |103-99|=4
  });

  it('snaps both axes independently and reports a guide per axis', () => {
    const e = { x: 103, y: 198, w: 100, h: 50 };
    const r = alignSnap(e, [{ x: 100, y: 200, w: 100, h: 50 }], { tol: 6 });
    expect(r.x).toBe(100);
    expect(r.y).toBe(200); // top 198 → 200
    expect(r.guides).toHaveLength(2);
  });

  it('returns the element position unchanged when nothing is near', () => {
    const r = alignSnap(el, [], { bounds: { w: 1920, h: 1080 }, tol: 6 });
    expect(r).toEqual({ x: 103, y: 200, guides: [] });
  });
});
