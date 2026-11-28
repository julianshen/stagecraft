import { describe, expect, it, vi } from 'vitest';

vi.mock('../vendor/officeview/drawing/geometry.ts', () => ({ resolvePreset: vi.fn(() => ({ commands: [] })) }));
vi.mock('../vendor/officeview/drawing/paint.ts', () => ({ paintGeometry: vi.fn() }));
vi.mock('../vendor/officeview/drawing/text-layout.ts', () => ({ layoutTextBody: vi.fn(() => ({ lines: [] })) }));
vi.mock('../vendor/officeview/drawing/text-paint.ts', () => ({ createTextBodyMeasurer: vi.fn(() => () => ({ width: 1 })), paintTextBody: vi.fn() }));

import { createCanonicalPaintEnvironment, paintCanonicalNode, paintCanonicalScene } from './paint.js';
import { layoutTextBody } from '../vendor/officeview/drawing/text-layout.ts';

const ctx = () => ({ save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), translate: vi.fn(), rotate: vi.fn(), measureText: vi.fn(() => ({ width: 1 })) });
const node = extra => ({ frame: { x: 1, y: 2, width: 30, height: 40, rotation: 0 }, paint: { layoutKey: 'layout', ...extra } });

describe('canonical painter unit branches', () => {
  it('validates cache limits and rejects disposed environments', () => {
    for (const cacheLimit of [0, 513, 1.5]) expect(() => createCanonicalPaintEnvironment({ cacheLimit })).toThrow(/CACHE_LIMIT/);
    const environment = createCanonicalPaintEnvironment({ cacheLimit: 1 });
    environment.dispose();
    expect(environment.getStats().disposed).toBe(true);
    expect(() => environment.invalidateFonts()).toThrow(/DISPOSED/);
    expect(() => paintCanonicalNode(ctx(), node(), environment)).toThrow(/DISPOSED/);
  });

  it('caches geometry and text layouts with LRU eviction', () => {
    const environment = createCanonicalPaintEnvironment({ cacheLimit: 1 });
    const context = ctx();
    paintCanonicalNode(context, node({ shape: 'rect', fill: '#112233' }), environment);
    paintCanonicalNode(context, node({ shape: 'rect', fill: '#112233' }), environment);
    expect(environment.getStats().geometryEntries).toBe(1);
    paintCanonicalNode(context, node({ shape: 'ellipse', fill: '#445566' }), environment);
    expect(environment.getStats().geometryEntries).toBe(1);
    const text = { body: { paragraphs: [] }, theme: {} };
    paintCanonicalNode(context, node({ text }), environment);
    paintCanonicalNode(context, node({ text }), environment);
    expect(environment.getStats().layoutBuilds).toBe(1);
    environment.invalidateFonts();
    paintCanonicalNode(context, node({ text }), environment);
    expect(environment.getStats().layoutBuilds).toBe(2);
  });

  it('paints empty, shape-only, text-only and scene nodes', () => {
    const environment = createCanonicalPaintEnvironment();
    const context = ctx();
    expect(() => paintCanonicalNode(context, node(), environment)).not.toThrow();
    expect(() => paintCanonicalNode(context, node({ shape: 'rect' }), environment)).not.toThrow();
    expect(() => paintCanonicalNode(context, node({ fill: '#112233' }), environment)).not.toThrow();
    paintCanonicalScene(context, { background: '#112233', width: 100, height: 50, nodes: [node({ shape: 'rect', fill: '#445566' })] }, environment);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 100, 50);
    expect(context.rotate).toHaveBeenCalled();
    expect(layoutTextBody).toHaveBeenCalled();
  });

  it('paints an outline without a fill and keeps preset adjustments in the geometry cache key', async () => {
    const { paintGeometry } = await import('../vendor/officeview/drawing/paint.ts');
    const { resolvePreset } = await import('../vendor/officeview/drawing/geometry.ts');
    vi.clearAllMocks();
    const environment = createCanonicalPaintEnvironment();
    const context = ctx();
    const outlined = node({ shape: 'rect', fill: null, stroke: { kind: 'solid', color: '#654321', widthEmu: 19050 } });
    paintCanonicalNode(context, outlined, environment);
    expect(paintGeometry).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      line: { width: 2, fill: { kind: 'solid', color: { r: 101, g: 67, b: 33, a: 1 } } },
    }), 30, 40);

    const first = node({ shape: 'roundRect', fill: '#112233', adjust: { adj: 10000 } });
    const second = node({ shape: 'roundRect', fill: '#112233', adjust: { adj: 40000 } });
    paintCanonicalNode(context, first, environment);
    paintCanonicalNode(context, second, environment);
    expect(resolvePreset).toHaveBeenCalledTimes(3);
    expect(resolvePreset).toHaveBeenNthCalledWith(2, 'roundRect', 30, 40, { adj: 10000 });
    expect(resolvePreset).toHaveBeenNthCalledWith(3, 'roundRect', 30, 40, { adj: 40000 });
  });
});
