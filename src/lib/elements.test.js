import { describe, it, expect } from 'vitest';
import { snap, createElement, moveElement, resizeElement, updateSlideElements, clampElement, SLIDE_W, SLIDE_H, GRID, MIN_SIZE } from './elements.js';

describe('snap', () => {
  it('snaps to the nearest grid multiple', () => {
    expect(snap(0)).toBe(0);
    expect(snap(3)).toBe(0);
    expect(snap(5)).toBe(8);
    expect(snap(20)).toBe(24);
  });
  it('accepts a custom grid', () => {
    expect(snap(13, 10)).toBe(10);
    expect(snap(16, 10)).toBe(20);
  });
});

describe('createElement', () => {
  it('creates a text element centered with default size and content', () => {
    const el = createElement('text', { id: 't1' });
    expect(el).toMatchObject({ id: 't1', type: 'text', content: 'Text' });
    expect(el.w).toBeGreaterThan(0);
    expect(el.h).toBeGreaterThan(0);
    // centered + snapped
    expect(el.x).toBe(snap((SLIDE_W - el.w) / 2));
    expect(el.y).toBe(snap((SLIDE_H - el.h) / 2));
  });
  it('creates a rect element with no content and honors overrides', () => {
    const el = createElement('rect', { id: 'r1', x: 100, y: 200, w: 300, h: 150 });
    expect(el).toEqual({ id: 'r1', type: 'rect', x: 104, y: 200, w: 300, h: 150, fill: '#4f46e5' });
    expect(el).not.toHaveProperty('content');
  });

  it('gives elements a default fill (matching the render)', () => {
    expect(createElement('text', { id: 't' }).fill).toBe('#15171C');
    expect(createElement('triangle', { id: 'g' }).fill).toBe('#4f46e5');
    expect(createElement('rect', { id: 'r', fill: '#abcdef' }).fill).toBe('#abcdef');
  });
});

describe('moveElement', () => {
  it('moves by a delta, snapping to the grid', () => {
    const el = { id: 'a', type: 'rect', x: 100, y: 100, w: 200, h: 100 };
    expect(moveElement(el, 13, 5)).toMatchObject({ x: 112, y: 104 });
  });
  it('clamps within the slide bounds', () => {
    const el = { id: 'a', type: 'rect', x: 0, y: 0, w: 200, h: 100 };
    expect(moveElement(el, -50, -50)).toMatchObject({ x: 0, y: 0 });
    const moved = moveElement(el, 5000, 5000);
    expect(moved.x).toBe(SLIDE_W - 200);
    expect(moved.y).toBe(SLIDE_H - 100);
  });
  it('does not mutate the input', () => {
    const el = { id: 'a', type: 'rect', x: 100, y: 100, w: 200, h: 100 };
    moveElement(el, 40, 40);
    expect(el.x).toBe(100);
  });
});

describe('resizeElement', () => {
  const el = { id: 'a', type: 'rect', x: 200, y: 200, w: 400, h: 200 };

  it('se handle grows width and height, keeping the top-left anchored', () => {
    const r = resizeElement(el, 'se', 80, 40);
    expect(r).toMatchObject({ x: 200, y: 200, w: 480, h: 240 });
  });
  it('nw handle moves the top-left and shrinks the box', () => {
    const r = resizeElement(el, 'nw', 80, 40);
    expect(r).toMatchObject({ x: 280, y: 240, w: 320, h: 160 });
  });
  it('e handle changes only width', () => {
    expect(resizeElement(el, 'e', -80, 999)).toMatchObject({ x: 200, y: 200, w: 320, h: 200 });
  });
  it('n handle changes only top/height', () => {
    expect(resizeElement(el, 'n', 999, 40)).toMatchObject({ x: 200, y: 240, w: 400, h: 160 });
  });
  it('enforces a minimum size', () => {
    const r = resizeElement(el, 'se', -10000, -10000);
    expect(r.w).toBe(MIN_SIZE);
    expect(r.h).toBe(MIN_SIZE);
  });
  it('keeps the element within the slide bounds', () => {
    const r = resizeElement({ ...el, x: 0, y: 0 }, 'se', 100000, 100000);
    expect(r.x + r.w).toBeLessThanOrEqual(SLIDE_W);
    expect(r.y + r.h).toBeLessThanOrEqual(SLIDE_H);
  });
  it('snaps the resized geometry to the grid', () => {
    const r = resizeElement(el, 'se', 13, 13);
    expect(r.w % GRID).toBe(0);
    expect(r.h % GRID).toBe(0);
  });
});

describe('updateSlideElements', () => {
  const deck = () => ({
    slides: [
      { id: 'a', layout: 'text', elements: [{ id: 'e1', type: 'rect', x: 0, y: 0, w: 10, h: 10 }] },
      { id: 'b', layout: 'kpi' },
    ],
  });

  it('transforms the target slide\'s elements and seeds [] when absent', () => {
    const added = updateSlideElements(deck(), 'b', (els) => [...els, { id: 'n', type: 'text' }]);
    expect(added.slides[1].elements).toEqual([{ id: 'n', type: 'text' }]);
  });

  it('maps existing elements and leaves other slides untouched', () => {
    const next = updateSlideElements(deck(), 'a', (els) => els.map((e) => ({ ...e, x: 99 })));
    expect(next.slides[0].elements[0].x).toBe(99);
    expect(next.slides[1]).toEqual({ id: 'b', layout: 'kpi' });
  });

  it('returns a new deck object (immutable) and tolerates a null deck', () => {
    const d = deck();
    expect(updateSlideElements(d, 'a', (e) => e)).not.toBe(d);
    expect(updateSlideElements(null, 'a', (e) => e)).toBe(null);
  });
});

describe('element edge cases (defaults & fallbacks)', () => {
  it('createElement falls back to rect defaults for an unknown type', () => {
    const el = createElement('squiggle', { id: 'z' });
    expect(el.type).toBe('squiggle');
    expect(el).not.toHaveProperty('content');
    expect(el.w).toBeGreaterThan(0);
  });

  it('createElement honors an explicit content override', () => {
    expect(createElement('text', { id: 't', content: 'Hi' }).content).toBe('Hi');
  });

  it('resizeElement with an unknown handle moves no edges (only snaps)', () => {
    const el = { id: 'a', type: 'rect', x: 96, y: 96, w: 200, h: 96 }; // already grid-aligned
    expect(resizeElement(el, 'zzz', 50, 50)).toMatchObject({ x: 96, y: 96, w: 200, h: 96 });
  });
});

describe('resizeElement anchor + clampElement', () => {
  it('preserves the opposite edge on an off-grid left resize', () => {
    const el = { id: 'a', type: 'rect', x: 200, y: 200, w: 400, h: 200 }; // right = 600
    const r = resizeElement(el, 'w', 5, 0);
    expect(r.x + r.w).toBe(600); // right edge unchanged despite snapping x
    expect(r.x % GRID).toBe(0);
  });

  it('preserves the bottom edge on an off-grid top resize', () => {
    const el = { id: 'a', type: 'rect', x: 0, y: 200, w: 400, h: 400 }; // bottom = 600
    const r = resizeElement(el, 'n', 0, 5);
    expect(r.y + r.h).toBe(600);
  });

  it('anchors the right edge when a left resize hits min size', () => {
    const el = { id: 'a', type: 'rect', x: 200, y: 200, w: 400, h: 200 }; // right = 600
    const r = resizeElement(el, 'w', 100000, 0);
    expect(r.w).toBe(MIN_SIZE);
    expect(r.x).toBe(600 - MIN_SIZE);
  });

  it('anchors the bottom edge when a top resize hits min size', () => {
    const el = { id: 'a', type: 'rect', x: 0, y: 200, w: 400, h: 400 }; // bottom = 600
    const r = resizeElement(el, 'n', 0, 100000);
    expect(r.h).toBe(MIN_SIZE);
    expect(r.y).toBe(600 - MIN_SIZE);
  });

  it('anchors the right edge when a left resize is pushed past the slide edge', () => {
    const el = { id: 'a', type: 'rect', x: 200, y: 0, w: 400, h: 100 }; // right = 600
    const r = resizeElement(el, 'w', -100000, 0);
    expect(r.x).toBe(0);
    expect(r.x + r.w).toBe(600); // right edge stays anchored, not drifted to the slide edge
  });
});

describe('clampElement', () => {
  it('clamps position and size to the slide bounds and min size', () => {
    const el = { id: 'a', type: 'rect', x: -500, y: -10, w: 5000, h: 5 };
    const c = clampElement(el);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.w).toBe(SLIDE_W);
    expect(c.h).toBe(MIN_SIZE);
  });

  it('keeps an in-bounds element unchanged and does not snap', () => {
    const el = { id: 'a', type: 'rect', x: 101, y: 99, w: 300, h: 150 };
    expect(clampElement(el)).toMatchObject({ x: 101, y: 99, w: 300, h: 150 });
  });

  it('clamps opacity to 0-100 and normalizes rotation to 0-360', () => {
    expect(clampElement({ x: 0, y: 0, w: 100, h: 100, opacity: 500 }).opacity).toBe(100);
    expect(clampElement({ x: 0, y: 0, w: 100, h: 100, opacity: -20 }).opacity).toBe(0);
    expect(clampElement({ x: 0, y: 0, w: 100, h: 100, rot: 450 }).rot).toBe(90);
    expect(clampElement({ x: 0, y: 0, w: 100, h: 100, rot: -90 }).rot).toBe(270);
  });
});
