import { describe, it, expect } from 'vitest';
import { snap, createElement, moveElement, resizeElement, updateSlideElements, clampElement, alignElements, distributeElements, elementsInMarquee, rotateElement, SLIDE_W, SLIDE_H, GRID, MIN_SIZE } from './elements.js';

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

  it('creates an image element carrying its src and no fill', () => {
    const el = createElement('image', { id: 'i1', src: 'data:image/png;base64,AAA' });
    expect(el).toMatchObject({ id: 'i1', type: 'image', src: 'data:image/png;base64,AAA' });
    expect(el).not.toHaveProperty('fill'); // an image isn't filled with a colour
    expect(el).not.toHaveProperty('content');
    expect(el.w).toBeGreaterThan(0);
    expect(el.h).toBeGreaterThan(0);
    expect(el.x).toBe(snap((SLIDE_W - el.w) / 2)); // centered + snapped
  });

  it('defaults an image with no src to an empty string', () => {
    expect(createElement('image', { id: 'i2' }).src).toBe('');
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

  describe('rotate-aware resize', () => {
    // A 90°-rotated box: its local +x axis points screen-DOWN, local +y points
    // screen-LEFT. center = (200,150).
    const rotEl = { id: 'r', type: 'rect', x: 100, y: 100, w: 200, h: 100, rot: 90 };

    it('resizes along the element local axes (e handle grows width on a screen-down drag)', () => {
      // Dragging the e (local-right) handle DOWN by 40 grows local width by 40,
      // and the local-left edge stays fixed in screen space.
      const r = resizeElement(rotEl, 'e', 0, 40);
      expect(r).toMatchObject({ x: 80, y: 120, w: 240, h: 100, rot: 90 });
    });

    it('keeps the anchored (opposite) edge fixed in screen space', () => {
      // Local-left edge midpoint in screen coords = center + Rot(90)·(-w/2,0).
      const before = rotEl, after = resizeElement(rotEl, 'e', 0, 40);
      const leftMidScreen = (b) => {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, t = (b.rot * Math.PI) / 180;
        // Rot(t)·(-w/2, 0)
        return [cx + (-b.w / 2) * Math.cos(t), cy + (-b.w / 2) * Math.sin(t)];
      };
      const [bx, by] = leftMidScreen(before), [ax, ay] = leftMidScreen(after);
      expect(ax).toBeCloseTo(bx, 6);
      expect(ay).toBeCloseTo(by, 6);
    });

    it('resizes from a corner handle, anchoring the opposite corner in screen space', () => {
      // grid-aligned size so snapping doesn't shift the unchanged dimension
      const el2 = { id: 'r', type: 'rect', x: 100, y: 100, w: 200, h: 96, rot: 90 };
      const r = resizeElement(el2, 'nw', 0, -40); // local width grows by 40
      expect(r).toMatchObject({ x: 80, y: 80, w: 240, h: 96, rot: 90 });
      // the bottom-right (anchored) corner stays put in screen coords
      const brScreen = (b) => {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, t = (b.rot * Math.PI) / 180;
        return [cx + (b.w / 2) * Math.cos(t) - (b.h / 2) * Math.sin(t),
          cy + (b.w / 2) * Math.sin(t) + (b.h / 2) * Math.cos(t)];
      };
      const [bx, by] = brScreen(el2), [ax, ay] = brScreen(r);
      expect(ax).toBeCloseTo(bx, 6);
      expect(ay).toBeCloseTo(by, 6);
    });

    it('leaves an unrotated element on the existing axis-aligned path', () => {
      const r = resizeElement({ ...rotEl, rot: 0 }, 'se', 80, 40);
      expect(r).toMatchObject({ x: 100, y: 100, w: 280, h: 144 }); // snap(140)=144
    });

    it('is a strict no-op for an unknown handle (no edges to move)', () => {
      const odd = { id: 'r', type: 'rect', x: 100.5, y: 100.5, w: 200, h: 100, rot: 90 };
      expect(resizeElement(odd, 'zzz', 50, 50)).toEqual(odd); // not even x/y rounded
    });
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

  it('coerces non-numeric opacity/rot to safe defaults (no NaN)', () => {
    const c = clampElement({ x: 0, y: 0, w: 100, h: 100, opacity: 'oops', rot: 'spin' });
    expect(c.opacity).toBe(100);
    expect(c.rot).toBe(0);
  });
});

describe('alignElements', () => {
  const els = () => [
    { id: 'a', type: 'rect', x: 100, y: 100, w: 200, h: 100 }, // right=300, bottom=200
    { id: 'b', type: 'rect', x: 500, y: 300, w: 100, h: 80 },  // right=600, bottom=380
  ];

  it('returns the input unchanged for fewer than two elements', () => {
    const one = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }];
    expect(alignElements(one, 'left')).toBe(one);
    expect(alignElements([], 'left')).toEqual([]);
  });

  it('aligns left edges to the selection bounding box', () => {
    const r = alignElements(els(), 'left');
    expect(r.map(e => e.x)).toEqual([100, 100]);
  });

  it('aligns right edges (x = maxRight - w)', () => {
    const r = alignElements(els(), 'right');
    expect(r.map(e => e.x + e.w)).toEqual([600, 600]);
  });

  it('aligns horizontal centers to the bbox center', () => {
    const r = alignElements(els(), 'hcenter');
    const cx = (100 + 600) / 2; // bbox center x = 350
    expect(r[0].x + r[0].w / 2).toBe(cx);
    expect(r[1].x + r[1].w / 2).toBe(cx);
  });

  it('aligns top, bottom, and vertical middle', () => {
    expect(alignElements(els(), 'top').map(e => e.y)).toEqual([100, 100]);
    expect(alignElements(els(), 'bottom').map(e => e.y + e.h)).toEqual([380, 380]);
    const cy = (100 + 380) / 2; // 240
    const mid = alignElements(els(), 'vmiddle');
    expect(mid[0].y + mid[0].h / 2).toBe(cy);
  });

  it('leaves the cross-axis untouched', () => {
    const r = alignElements(els(), 'left');
    expect(r[1].y).toBe(300); // y unchanged by a left align
  });

  it('rounds fractional center alignment to whole pixels (no subpixel blur)', () => {
    const e = [
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 101, y: 51, w: 100, h: 100 }, // bbox cx=100.5, cy=75.5 → halves are fractional
    ];
    const h = alignElements(e, 'hcenter');
    const v = alignElements(e, 'vmiddle');
    expect(h.every(el => Number.isInteger(el.x))).toBe(true);
    expect(v.every(el => Number.isInteger(el.y))).toBe(true);
  });
});

describe('distributeElements', () => {
  it('returns the input unchanged for fewer than three elements', () => {
    const two = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', x: 100, y: 0, w: 10, h: 10 }];
    expect(distributeElements(two, 'h')).toBe(two);
    expect(distributeElements([], 'v')).toEqual([]);
  });

  it('equalizes horizontal gaps, holding the outer edges fixed', () => {
    const e = [
      { id: 'a', x: 0, y: 0, w: 100, h: 50 },
      { id: 'b', x: 120, y: 0, w: 100, h: 50 }, // free space = 600-300 = 300, gap = 150
      { id: 'c', x: 500, y: 0, w: 100, h: 50 },
    ];
    const byId = Object.fromEntries(distributeElements(e, 'h').map(x => [x.id, x]));
    expect(byId.a.x).toBe(0);   // first edge unchanged
    expect(byId.b.x).toBe(250); // gap of 150 on each side
    expect(byId.c.x).toBe(500); // last edge unchanged
  });

  it('equalizes vertical gaps', () => {
    const e = [
      { id: 'a', x: 0, y: 0, w: 50, h: 100 },
      { id: 'b', x: 0, y: 120, w: 50, h: 100 },
      { id: 'c', x: 0, y: 500, w: 50, h: 100 },
    ];
    const byId = Object.fromEntries(distributeElements(e, 'v').map(x => [x.id, x]));
    expect(byId.a.y).toBe(0);
    expect(byId.b.y).toBe(250);
    expect(byId.c.y).toBe(500);
  });

  it('sorts by position before distributing and preserves input order', () => {
    const e = [
      { id: 'c', x: 500, y: 0, w: 100, h: 50 },
      { id: 'a', x: 0, y: 0, w: 100, h: 50 },
      { id: 'b', x: 120, y: 0, w: 100, h: 50 },
    ];
    const r = distributeElements(e, 'h');
    expect(r.map(x => x.id)).toEqual(['c', 'a', 'b']); // order preserved
    const byId = Object.fromEntries(r.map(x => [x.id, x]));
    expect([byId.a.x, byId.b.x, byId.c.x]).toEqual([0, 250, 500]);
  });

  it('leaves the cross-axis untouched', () => {
    const e = [
      { id: 'a', x: 0, y: 7, w: 100, h: 50 },
      { id: 'b', x: 120, y: 9, w: 100, h: 50 },
      { id: 'c', x: 500, y: 11, w: 100, h: 50 },
    ];
    expect(distributeElements(e, 'h').map(x => x.y)).toEqual([7, 9, 11]);
  });

  it('uses the true outer far edge when the widest element is not the last', () => {
    // b is widest (far edge 400) but starts before c (far edge 380). The
    // selection bounding box is [0, 400], not [0, 380].
    const e = [
      { id: 'a', x: 0, y: 0, w: 50, h: 50 },   // far edge 50
      { id: 'b', x: 100, y: 0, w: 300, h: 50 }, // far edge 400 (outermost)
      { id: 'c', x: 350, y: 0, w: 30, h: 50 },  // far edge 380, but max x
    ];
    const byId = Object.fromEntries(distributeElements(e, 'h').map(x => [x.id, x]));
    // span 400, sumW 380 → gap 10 each
    expect(byId.a.x).toBe(0);
    expect(byId.b.x).toBe(60);
    expect(byId.c.x).toBe(370);
    expect(byId.c.x + 30).toBe(400); // far edge of the box preserved
  });
});

describe('elementsInMarquee', () => {
  const els = () => [
    { id: 'a', x: 100, y: 100, w: 200, h: 100 }, // 100..300 × 100..200
    { id: 'b', x: 500, y: 100, w: 200, h: 100 }, // 500..700 × 100..200
    { id: 'c', x: 100, y: 400, w: 200, h: 100 }, // 100..300 × 400..500
  ];

  it('returns ids of elements overlapping the rectangle', () => {
    expect(elementsInMarquee(els(), 0, 0, 400, 250)).toEqual(['a']);
  });

  it('selects every element the rectangle overlaps', () => {
    expect(elementsInMarquee(els(), 0, 0, 800, 600)).toEqual(['a', 'b', 'c']);
  });

  it('normalizes a rectangle dragged up-and-left (reversed corners)', () => {
    // Same box as the first case but dragged from bottom-right to top-left.
    expect(elementsInMarquee(els(), 400, 250, 0, 0)).toEqual(['a']);
  });

  it('returns an empty array when nothing overlaps', () => {
    expect(elementsInMarquee(els(), 0, 0, 10, 10)).toEqual([]);
    expect(elementsInMarquee([], 0, 0, 999, 999)).toEqual([]);
  });

  it('treats edge-only contact as non-overlapping (strict)', () => {
    // Rectangle right edge at x=100 exactly touches a's left edge — not a hit.
    expect(elementsInMarquee(els(), 0, 100, 100, 200)).toEqual([]);
  });
});

describe('rotateElement', () => {
  const el = { id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 100 }; // center (50, 50)

  it('reads 0° when the pointer is directly above the center', () => {
    expect(rotateElement(el, 50, -50).rot).toBe(0);
  });

  it('reads 90° to the right, 180° below, 270° to the left', () => {
    expect(rotateElement(el, 150, 50).rot).toBe(90);
    expect(rotateElement(el, 50, 150).rot).toBe(180);
    expect(rotateElement(el, -50, 50).rot).toBe(270); // normalized, not -90
  });

  it('rounds to whole degrees and leaves the other fields untouched', () => {
    const r = rotateElement(el, 60, -50); // slightly right of straight-up
    expect(Number.isInteger(r.rot)).toBe(true);
    expect({ x: r.x, y: r.y, w: r.w, h: r.h, id: r.id }).toEqual({ x: 0, y: 0, w: 100, h: 100, id: 'a' });
  });
});
