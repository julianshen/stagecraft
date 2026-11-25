import { describe, expect, it, vi } from 'vitest';

vi.mock('../vendor/officeview/drawing/geometry.ts', () => ({ resolvePreset: vi.fn(() => ({ commands: [] })) }));
vi.mock('../vendor/officeview/drawing/paint.ts', () => ({ paintGeometry: vi.fn() }));
vi.mock('../vendor/officeview/drawing/text-layout.ts', () => ({ layoutTextBody: vi.fn(() => ({ lines: [{ segments: [{ style: {} }] }] })) }));
vi.mock('../vendor/officeview/drawing/text-paint.ts', () => ({ paintTextBody: vi.fn(), createTextBodyMeasurer: vi.fn(() => () => ({ width: 10 })) }));

import { createPaintEnv, paintNode, paintSlide, touchImage, canvasFont } from './paint.js';
import { paintGeometry } from '../vendor/officeview/drawing/paint.ts';
import { layoutTextBody } from '../vendor/officeview/drawing/text-layout.ts';

const context = () => ({
  save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
  fillRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  stroke: vi.fn(), setLineDash: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 10 })),
  getTransform: vi.fn(() => ({ a: 2, b: 1, c: -1, d: 3 })),
});
const base = kind => ({ kind, x: 10, y: 20, w: 100, h: 50, rot: 0, sx: 1, sy: 1, opacity: 1 });
const image = extra => ({ ...base('image'), src: 'img', fit: 'cover', ...extra });

describe('canvas painter unit branches', () => {
  it('creates environments and font stacks with and without explicit families', () => {
    expect(createPaintEnv().imageLimit).toBe(256);
    expect(createPaintEnv({ imageLimit: 2 }).imageLimit).toBe(2);
    expect(canvasFont()).toBeTruthy();
    expect(canvasFont('Arial')).toContain('Arial');
  });

  it('touches cached images and leaves misses absent', () => {
    const env = createPaintEnv();
    const first = { width: 1 }, second = { width: 2 };
    env.images.set('first', first);
    env.images.set('second', second);
    expect(touchImage(env, 'first')).toBe(first);
    expect([...env.images.keys()]).toEqual(['second', 'first']);
    expect(touchImage(env, 'missing')).toBeUndefined();
  });

  it('paints solid and gradient shapes with optional lines and shadows', () => {
    const ctx = context(), env = createPaintEnv();
    paintNode(ctx, { ...base('shape'), preset: 'rect', fill: { kind: 'solid', color: '#112233' } }, env);
    expect(paintGeometry).toHaveBeenCalled();
    paintNode(ctx, { ...base('shape'), preset: 'rect', fill: { kind: 'gradient', angle: 5400000, from: '#000000', to: '#FFFFFF' }, line: { color: '#445566', width: 2, dash: 'dashed' }, shadow: { color: '#000000', alpha: 0.25, blur: 4, x: 2, y: 3 } }, env);
    expect(paintGeometry.mock.calls.at(-1)[2].line.dash).toBe('dash');
  });

  it('ignores nonpositive paths and paints transformed dashed paths', () => {
    const ctx = context(), env = createPaintEnv();
    paintNode(ctx, { ...base('path'), width: 0, points: [[0, 0]] }, env);
    expect(ctx.stroke).not.toHaveBeenCalled();
    paintNode(ctx, { ...base('path'), width: 2, color: '#112233', dash: 'dotted', points: [[0, 0], [0.5, 1]], rot: 30, sx: -1, opacity: 0.5 }, env);
    expect(ctx.stroke).toHaveBeenCalled();
    paintNode(ctx, { ...base('path'), width: 2, color: '#112233', dash: 'solid', points: [[0, 0], [1, 1]], shadow: { color: '#000000', alpha: 0.5, x: 1, y: 2, blur: 3 } }, env);
    expect(ctx.rotate).toHaveBeenCalled();
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1);
  });

  it('paints image placeholders, stretch, contain, cover and invalid dimensions', () => {
    const ctx = context(), env = createPaintEnv();
    paintNode(ctx, image({ src: '' }), env);
    expect(ctx.fillRect).toHaveBeenCalled();
    paintNode(ctx, image({ src: 'not-cached' }), env);
    env.images.set('img', { naturalWidth: 40, naturalHeight: 20 });
    for (const fit of ['stretch', 'contain', 'cover']) paintNode(ctx, image({ fit }), env);
    env.images.set('img', { width: 0, height: 0 });
    paintNode(ctx, image({ fit: 'contain' }), env);
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('skips empty text and repaints text when the font epoch changes', () => {
    const ctx = context(), env = createPaintEnv();
    paintNode(ctx, { ...base('text'), content: '' }, env);
    expect(layoutTextBody).not.toHaveBeenCalled();
    const node = { ...base('text'), content: 'Hello\nWorld', fontSize: 16, color: '#112233', align: 'center', valign: 'middle', lineSpacing: 1.2, shadow: { color: '#000000', alpha: 0.5, x: 1, y: 2, blur: 3 } };
    paintNode(ctx, node, env);
    const count = layoutTextBody.mock.calls.length;
    paintNode(ctx, node, env);
    expect(layoutTextBody).toHaveBeenCalledTimes(count);
    env.fontEpoch++;
    paintNode(ctx, node, env);
    expect(layoutTextBody).toHaveBeenCalledTimes(count + 1);
    paintNode(ctx, { ...node, shadow: undefined }, env);
  });

  it('paints a slide background and restores canvas state', () => {
    const ctx = context(), env = createPaintEnv();
    paintSlide(ctx, { background: '#112233', w: 100, h: 50, nodes: [{ ...base('path'), width: 0, points: [] }] }, env);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 50);
    expect(ctx.restore).toHaveBeenCalled();
  });
});
