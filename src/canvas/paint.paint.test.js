// Pixel probes for the K1 painter (the `chromium` project): scenes from
// buildScene, painted at 1/4 scale onto a real canvas, sampled in slide px.
import { describe, it, expect, beforeAll } from 'vitest';
import { buildScene } from './scene.js';
import { paintSlide, createPaintEnv } from './paint.js';

const SCALE = 0.25;
const scene = (elements, extra = {}) => buildScene({ layout: 'blank', elements, ...extra }, {});

function paint(sc, env = createPaintEnv()) {
  const canvas = document.createElement('canvas');
  canvas.width = sc.w * SCALE;
  canvas.height = sc.h * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  paintSlide(ctx, sc, env);
  // The RGBA at slide point (x, y).
  return (x, y) => [...ctx.getImageData(Math.floor(x * SCALE), Math.floor(y * SCALE), 1, 1).data];
}
const near = (actual, expected, tol = 12) => actual.slice(0, 3).every((c, i) => Math.abs(c - expected[i]) <= tol);
const WHITE = [255, 255, 255];
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const box = { x: 400, y: 200, w: 800, h: 400 }; // centre (800, 400)

describe('background and shapes', () => {
  it('fills the slide background (blank bgColor)', () => {
    expect(near(paint(scene([], { bgColor: '#336699' }))(10, 10), [0x33, 0x66, 0x99])).toBe(true);
  });

  it('fills a rect, and leaves the slide outside it', () => {
    const at = paint(scene([{ id: 'r', type: 'rect', ...box, fill: '#ff0000' }]));
    expect(near(at(800, 400), RED)).toBe(true);
    expect(near(at(300, 400), WHITE)).toBe(true);
  });

  it('draws preset geometry: a star covers its centre, not the gap between its lower points', () => {
    const at = paint(scene([{ id: 's', type: 'star', x: 400, y: 100, w: 800, h: 800, fill: '#ff0000' }]));
    expect(near(at(800, 520), RED)).toBe(true);
    expect(near(at(800, 880), WHITE)).toBe(true);
  });

  it('rounds the corners of a "rounded" box, and keeps a "rect" sharp', () => {
    const rounded = paint(scene([{ id: 'a', type: 'rounded', ...box, fill: '#ff0000' }]));
    expect(near(rounded(box.x + 3, box.y + 3), WHITE)).toBe(true);
    expect(near(rounded(800, 400), RED)).toBe(true);
    const sharp = paint(scene([{ id: 'b', type: 'rect', ...box, fill: '#ff0000' }]));
    expect(near(sharp(box.x + 6, box.y + 6), RED)).toBe(true);
  });

  it('runs a gradient the CSS way: 90° goes left → right', () => {
    const at = paint(scene([{ id: 'g', type: 'rect', ...box, fill: '#ff0000', gradient: { from: '#000000', to: '#ffffff', angle: 90 } }]));
    const left = at(box.x + 10, 400)[0], mid = at(800, 400)[0], right = at(box.x + box.w - 10, 400)[0];
    expect(left).toBeLessThan(30);
    expect(right).toBeGreaterThan(225);
    expect(Math.abs(mid - 128)).toBeLessThan(25);
  });

  it('draws an outline centred on the edge, and dashes it', () => {
    const solid = paint(scene([{ id: 'o', type: 'rect', ...box, fill: '#ff0000', stroke: '#0000ff', strokeWidth: 16 }]));
    expect(near(solid(box.x, 400), BLUE)).toBe(true); // on the edge
    expect(near(solid(box.x - 4, 400), BLUE)).toBe(true); // half the width outside it
    const dashed = paint(scene([{ id: 'd', type: 'rect', ...box, fill: '#ffffff', stroke: '#0000ff', strokeWidth: 16, strokeDash: 'dashed' }]));
    const edge = Array.from({ length: 80 }, (_, i) => near(dashed(box.x + 40 + i * 8, box.y), BLUE));
    expect(edge.some(Boolean) && edge.some((b) => !b)).toBe(true); // dashes and gaps along the top edge
  });

  it('draws a line as a filled bar', () => {
    const at = paint(scene([{ id: 'l', type: 'line', x: 400, y: 500, w: 800, h: 16, fill: '#0000ff' }]));
    expect(near(at(800, 508), BLUE)).toBe(true);
    expect(near(at(800, 540), WHITE)).toBe(true);
  });
});

describe('pen paths, opacity, orientation, shadows', () => {
  it('strokes a pen path through its 0..1 points', () => {
    const at = paint(scene([{ id: 'p', type: 'path', ...box, points: [[0, 0], [1, 1]], stroke: '#0000ff', strokeWidth: 16 }]));
    expect(near(at(800, 400), BLUE)).toBe(true); // the diagonal's midpoint
    expect(near(at(1100, 250), WHITE)).toBe(true); // off it
  });

  it('applies opacity', () => {
    expect(near(paint(scene([{ id: 'r', type: 'rect', ...box, fill: '#ff0000', opacity: 50 }]))(800, 400), [255, 128, 128], 4)).toBe(true);
  });

  it('rotates about the centre', () => {
    // An 800×100 bar turned 90° covers (800, 100) and leaves (500, 400).
    const at = paint(scene([{ id: 'r', type: 'rect', x: 400, y: 350, w: 800, h: 100, fill: '#ff0000', rot: 90 }]));
    expect(near(at(800, 100), RED)).toBe(true);
    expect(near(at(500, 400), WHITE)).toBe(true);
  });

  it('mirrors a flipped shape: a right arrow flipped H points left', () => {
    // rightArrow (800×400) is a mid-height tail band to x = 600, then a full-height head tapering to the tip.
    // 60 px from the top the head spans local x 600–660; the tail band isn't there.
    const arrow = (flipH) => paint(scene([{ id: 'a', type: 'arrow', ...box, fill: '#ff0000', flipH }]));
    const y = box.y + 60;
    expect(near(arrow(false)(box.x + 630, y), RED)).toBe(true);
    expect(near(arrow(false)(box.x + 170, y), WHITE)).toBe(true);
    expect(near(arrow(true)(box.x + 170, y), RED)).toBe(true); // mirrored: local 630 ↔ 170
    expect(near(arrow(true)(box.x + 630, y), WHITE)).toBe(true);
  });

  it('casts the drop shadow in the element\'s own frame (it turns with the rotation)', () => {
    const shadow = { color: '#000000', blur: 0, x: 60, y: 0 };
    const flat = paint(scene([{ id: 's', type: 'rect', ...box, fill: '#ff0000', shadow }]));
    expect(flat(box.x + box.w + 30, 400)[0]).toBeLessThan(200); // shadow to the right
    expect(near(flat(800, box.y - 30), WHITE)).toBe(true);
    // Turned 90°, the local +x offset points down the slide.
    const turned = paint(scene([{ id: 's', type: 'rect', x: 600, y: 200, w: 400, h: 400, fill: '#ff0000', shadow, rot: 90 }]));
    expect(turned(800, 630)[0]).toBeLessThan(200);
    expect(near(turned(1030, 400), WHITE)).toBe(true);
  });
});

describe('images', () => {
  // A 200×100 source in four 50-px vertical stripes: red, green, blue, black.
  const STRIPES = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 0, 0]];
  let env;
  const SRC = 'data:stripes';
  beforeAll(async () => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const g = c.getContext('2d');
    STRIPES.forEach(([r, gr, b], i) => { g.fillStyle = `rgb(${r},${gr},${b})`; g.fillRect(i * 50, 0, 50, 100); });
    env = createPaintEnv();
    env.images.set(SRC, await createImageBitmap(c));
  });
  // A 400×400 box at (600, 200): sample its four quarter-columns at mid-height, and its top band.
  const img = (fit) => paint(scene([{ id: 'i', type: 'image', x: 600, y: 200, w: 400, h: 400, src: SRC, fit }]), env);
  const columns = (at, y = 400) => [650, 750, 850, 950].map((x) => at(x, y));

  it('stretch distorts the whole picture into the box', () => {
    columns(img('stretch')).forEach((px, i) => expect(near(px, STRIPES[i])).toBe(true));
  });

  it('cover (Fill) crops the middle to fill the box', () => {
    const [a, b, c, d] = columns(img('cover'));
    [a, b].forEach((px) => expect(near(px, STRIPES[1])).toBe(true));
    [c, d].forEach((px) => expect(near(px, STRIPES[2])).toBe(true));
  });

  it('contain (Fit) letterboxes the whole picture', () => {
    const at = img('contain');
    columns(at).forEach((px, i) => expect(near(px, STRIPES[i])).toBe(true));
    expect(near(at(800, 220), WHITE)).toBe(true); // above the 400×200 picture
  });

  it('draws the placeholder for a missing or not-yet-decoded picture', () => {
    const PLACEHOLDER = [0xec, 0xea, 0xe4];
    expect(near(paint(scene([{ id: 'i', type: 'image', x: 600, y: 200, w: 400, h: 400 }]))(610, 210), PLACEHOLDER)).toBe(true);
    expect(near(paint(scene([{ id: 'i', type: 'image', x: 600, y: 200, w: 400, h: 400, src: 'data:not-loaded' }]))(610, 210), PLACEHOLDER)).toBe(true);
  });
});

describe('text', () => {
  const ink = (at, xs, ys) => xs.some((x) => ys.some((y) => at(x, y)[0] < 128));
  const range = (a, b, step = 8) => Array.from({ length: Math.ceil((b - a) / step) }, (_, i) => a + i * step);

  it('paints the text inside its box, aligned and anchored', () => {
    const text = { id: 't', type: 'text', ...box, content: 'MMMM', color: '#000000', fontSize: 80 };
    const topLeft = paint(scene([{ ...text, align: 'left', valign: 'top' }]));
    expect(ink(topLeft, range(box.x, box.x + 200), range(box.y, box.y + 100))).toBe(true);
    expect(ink(topLeft, range(box.x + 500, box.x + box.w), range(box.y + 200, box.y + box.h))).toBe(false);
    const bottomRight = paint(scene([{ ...text, align: 'right', valign: 'bottom' }]));
    expect(ink(bottomRight, range(box.x + 600, box.x + box.w), range(box.y + 300, box.y + box.h))).toBe(true);
    expect(ink(bottomRight, range(box.x, box.x + 200), range(box.y, box.y + 200))).toBe(false);
  });

  it('draws nothing for an empty text box or a zero-width pen stroke (and lays nothing out)', () => {
    const env = createPaintEnv();
    const at = paint(scene([
      { id: 't', type: 'text', ...box, content: '', color: '#000000' },
      { id: 'p', type: 'path', ...box, points: [[0, 0], [1, 1]], stroke: '#0000ff', strokeWidth: 0 },
    ]), env);
    expect(near(at(800, 400), WHITE)).toBe(true);
    expect(env.layouts.size).toBe(0);
  });

  it('keeps each cache bounded, dropping the oldest entry first', () => {
    const env = createPaintEnv({ cacheLimit: 2 });
    for (const w of [100, 200, 300]) paint(scene([{ id: 's', type: 'star', x: 0, y: 0, w, h: 100, fill: '#ff0000' }]), env);
    expect([...env.geometry.keys()]).toEqual(['star5|200|100|', 'star5|300|100|']);
  });

  it('caches geometry and text layout, so a repaint lays nothing out again', () => {
    const env = createPaintEnv();
    const sc = scene([{ id: 't', type: 'text', ...box, content: 'Hello', color: '#000000' }, { id: 's', type: 'star', ...box, fill: '#ff0000' }]);
    paint(sc, env);
    const sizes = [env.layouts.size, env.geometry.size];
    paint(sc, env);
    expect([env.layouts.size, env.geometry.size]).toEqual(sizes);
    expect(sizes).toEqual([1, 1]);
  });
});
