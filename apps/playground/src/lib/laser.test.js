import { describe, it, expect } from 'vitest';
import { pointerToPct } from './laser.js';

const rect = { left: 100, top: 50, width: 800, height: 400 };

describe('pointerToPct', () => {
  it('maps the rect centre to 50/50', () => {
    expect(pointerToPct(rect, 500, 250)).toEqual({ x: 50, y: 50 });
  });

  it('maps the top-left corner to 0/0', () => {
    expect(pointerToPct(rect, 100, 50)).toEqual({ x: 0, y: 0 });
  });

  it('maps the bottom-right corner to 100/100', () => {
    expect(pointerToPct(rect, 900, 450)).toEqual({ x: 100, y: 100 });
  });

  it('clamps a pointer outside the rect to the [0,100] edge', () => {
    expect(pointerToPct(rect, 0, 1000)).toEqual({ x: 0, y: 100 });
    expect(pointerToPct(rect, 2000, -50)).toEqual({ x: 100, y: 0 });
  });

  it('returns null for a missing or zero-area rect (nothing to map onto)', () => {
    expect(pointerToPct(null, 10, 10)).toBeNull();
    expect(pointerToPct({ left: 0, top: 0, width: 0, height: 400 }, 10, 10)).toBeNull();
    expect(pointerToPct({ left: 0, top: 0, width: 800, height: 0 }, 10, 10)).toBeNull();
  });
});
