import { describe, it, expect } from 'vitest';
import { buildScene, elementNode, ROUNDED_RADIUS } from './scene.js';
import { slideDims } from '../lib/slideDims.js';
import { INK, SHADOW_OPACITY } from '../lib/elements.js';

const box = { x: 100, y: 50, w: 400, h: 200 };
const node = (el) => elementNode({ id: 'e', ...box, ...el });

describe('slideDims', () => {
  it('keeps the 1920-px authoring width and reads the height from the deck', () => {
    expect(slideDims({})).toEqual({ w: 1920, h: 1080 });
    expect(slideDims(undefined)).toEqual({ w: 1920, h: 1080 });
    expect(slideDims({ size: { w: 1920, h: 1440 } })).toEqual({ w: 1920, h: 1440 });
  });
  it('ignores a size that could not render', () => {
    for (const h of [0, -5, Infinity, NaN, '1440', null]) expect(slideDims({ size: { h } }).h).toBe(1080);
  });
});

describe('buildScene', () => {
  it('lays a blank slide out at the deck size with its background and every element, in z-order', () => {
    const slide = { layout: 'blank', bgColor: '#FFEEDD', elements: [{ id: 'a', type: 'rect', ...box, fill: '#ff0000' }, null, { id: 'b', type: 'text', ...box, content: 'Hi', color: '#000000' }] };
    const scene = buildScene(slide, { size: { h: 1440 } });
    expect(scene).toMatchObject({ w: 1920, h: 1440, background: '#FFEEDD', template: false });
    expect(scene.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('falls back to white for a missing or malformed blank background, as the canvas and export do', () => {
    expect(buildScene({ layout: 'blank' }, {}).background).toBe('#ffffff');
    expect(buildScene({ layout: 'blank', bgColor: 'red' }, {}).background).toBe('#ffffff');
  });

  it('marks template layouts, whose content is compiled in K3, and still draws their elements', () => {
    const scene = buildScene({ layout: 'text', elements: [{ id: 'a', type: 'rect', ...box, fill: '#00ff00' }] }, {});
    expect(scene.template).toBe(true);
    expect(scene.nodes).toHaveLength(1);
  });

  it('survives a missing slide or a non-array elements field', () => {
    expect(buildScene(undefined, {}).nodes).toEqual([]);
    expect(buildScene({ layout: 'blank', elements: 'junk' }, {}).nodes).toEqual([]);
  });
});

describe('elementNode — the frame every node shares', () => {
  it('carries the box, rotation, flips and opacity (0–100 → 0–1, clamped)', () => {
    expect(node({ type: 'rect', fill: '#ff0000', rot: 30, flipH: true, opacity: 40 })).toMatchObject({ ...box, rot: 30, sx: -1, sy: 1, opacity: 0.4 });
    expect(node({ type: 'rect', fill: '#ff0000', opacity: 250 }).opacity).toBe(1);
    expect(node({ type: 'rect', fill: '#ff0000', opacity: -3 }).opacity).toBe(0);
    expect(node({ type: 'rect', fill: '#ff0000' })).toMatchObject({ rot: 0, sx: 1, sy: 1, opacity: 1 });
  });

  it('orients text as PowerPoint does: flipH changes nothing, flipV turns it 180°', () => {
    expect(node({ type: 'text', content: 'x', color: '#000000', flipH: true, flipV: true, rot: 10 })).toMatchObject({ rot: 190, sx: 1, sy: 1 });
  });

  it('keeps a renderable shadow with the shared softness, and drops a malformed one', () => {
    expect(node({ type: 'rect', fill: '#ff0000', shadow: { color: '#112233', blur: 16, x: 4, y: 8 } }).shadow)
      .toEqual({ color: '#112233', alpha: SHADOW_OPACITY, blur: 16, x: 4, y: 8 });
    expect(node({ type: 'rect', fill: '#ff0000', shadow: { color: 'red', blur: 1, x: 0, y: 0 } }).shadow).toBeNull();
  });

  it('skips elements nothing can draw: unknown types, missing boxes, junk', () => {
    expect(elementNode({ id: 'u', type: 'sparkle', ...box })).toBeNull();
    expect(elementNode({ id: 'n', type: 'rect', x: 0, y: 0, w: NaN, h: 10 })).toBeNull();
    expect(elementNode(null)).toBeNull();
  });
});

describe('elementNode — shapes', () => {
  it('maps each shape to its PowerPoint preset, with a solid fill', () => {
    expect(node({ type: 'triangle', fill: '#ff0000' })).toMatchObject({ kind: 'shape', preset: 'triangle', fill: { kind: 'solid', color: '#ff0000' }, line: null });
    expect(node({ type: 'circle', fill: '#ff0000' }).preset).toBe('ellipse');
    expect(node({ type: 'ellipse', fill: '#ff0000' }).preset).toBe('ellipse');
    expect(node({ type: 'star', fill: '#ff0000' }).preset).toBe('star5');
    expect(node({ type: 'rect', fill: '#ff0000' })).toMatchObject({ preset: 'rect', adjust: {} });
  });

  it('draws the rounded boxes at their canvas corner radius (8 px "shape", 28 px "rounded") as roundRect', () => {
    // roundRect's adj is the radius as a fraction (×100000) of the shorter side.
    expect(node({ type: 'shape', fill: '#ff0000' })).toMatchObject({ preset: 'roundRect', adjust: { adj: (ROUNDED_RADIUS.shape / 200) * 100000 } });
    expect(node({ type: 'rounded', fill: '#ff0000' }).adjust).toEqual({ adj: (28 / 200) * 100000 });
    expect(node({ type: 'rounded', fill: '#ff0000', w: 20, h: 20 }).adjust).toEqual({ adj: 50000 }); // capped at a full half-side
  });

  it('prefers a valid gradient over the solid fill, and falls back to the solid for a malformed one', () => {
    expect(node({ type: 'rect', fill: '#ff0000', gradient: { from: '#000000', to: '#ffffff', angle: 90 } }).fill)
      .toEqual({ kind: 'gradient', from: '#000000', to: '#ffffff', angle: 90 });
    expect(node({ type: 'rect', fill: '#ff0000', gradient: { from: 'black', to: '#ffffff', angle: 90 } }).fill)
      .toEqual({ kind: 'solid', color: '#ff0000' });
  });

  it('uses the export fallback colour for a shape without a usable fill', () => {
    expect(node({ type: 'rect' }).fill).toEqual({ kind: 'solid', color: '#4f46e5' });
    expect(node({ type: 'rect', fill: 'tomato' }).fill).toEqual({ kind: 'solid', color: '#4f46e5' });
  });

  it('adds the outline only when it is visible, with its dash', () => {
    expect(node({ type: 'rect', fill: '#ff0000', stroke: '#0000ff', strokeWidth: 4, strokeDash: 'dashed' }).line)
      .toEqual({ color: '#0000ff', width: 4, dash: 'dashed' });
    expect(node({ type: 'rect', fill: '#ff0000', stroke: '#0000ff', strokeWidth: 0 }).line).toBeNull();
    expect(node({ type: 'rect', fill: '#ff0000', stroke: '#0000ff', strokeWidth: 2, strokeDash: 'wavy' }).line.dash).toBe('solid');
  });

  it('draws a line as a sharp bar at its real thickness, in ink by default and never outlined', () => {
    expect(node({ type: 'line', h: 6, stroke: '#ff0000', strokeWidth: 3 })).toMatchObject({ kind: 'shape', preset: 'rect', h: 6, fill: { kind: 'solid', color: INK }, line: null });
    expect(node({ type: 'line', fill: '#123456' }).fill).toEqual({ kind: 'solid', color: '#123456' });
  });
});

describe('elementNode — pen paths, images, text', () => {
  it('keeps a pen path\'s finite 0..1 points, its stroke and dash; fewer than two points draw nothing', () => {
    expect(node({ type: 'path', points: [[0, 0], [NaN, 1], [1, 1]], stroke: '#00ff00', strokeWidth: 5, strokeDash: 'dotted' }))
      .toMatchObject({ kind: 'path', points: [[0, 0], [1, 1]], color: '#00ff00', width: 5, dash: 'dotted' });
    expect(node({ type: 'path', points: [[0, 0], [1, 1]] })).toMatchObject({ color: INK, width: 2, dash: 'solid' });
    expect(node({ type: 'path', points: [[0, 0]] })).toBeNull();
    expect(node({ type: 'path', points: 'junk' })).toBeNull();
  });

  it('keeps an image\'s source and fit mode (absent or unknown → cover), and a missing source', () => {
    expect(node({ type: 'image', src: 'data:image/png;base64,AAA', fit: 'contain' })).toMatchObject({ kind: 'image', src: 'data:image/png;base64,AAA', fit: 'contain' });
    expect(node({ type: 'image', src: 'data:image/png;base64,AAA', fit: 'zoom' }).fit).toBe('cover');
    expect(node({ type: 'image' })).toMatchObject({ kind: 'image', src: null, fit: 'cover' });
  });

  it('keeps a text box\'s content and its resolved style, with the canvas defaults', () => {
    expect(node({ type: 'text', content: 'Hello\nworld', color: '#112233', fontSize: 32, bold: true, italic: true, align: 'center', valign: 'top', fontFamily: 'Calibri', lineSpacing: 1.5 }))
      .toMatchObject({ kind: 'text', content: 'Hello\nworld', color: '#112233', fontSize: 32, bold: true, italic: true, align: 'center', valign: 'top', fontFamily: 'Calibri', lineSpacing: 1.5 });
    expect(node({ type: 'text', content: 'x' })).toMatchObject({ color: INK, fontSize: 48, bold: false, italic: false, align: 'left', valign: 'middle', fontFamily: null, lineSpacing: 1.2 });
    expect(node({ type: 'text', content: 'x', align: 'justify', fontSize: -4 })).toMatchObject({ align: 'left', fontSize: 48 });
    expect(node({ type: 'text', content: 42 }).content).toBe('');
  });
});
