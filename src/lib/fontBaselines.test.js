import { describe, it, expect } from 'vitest';
import { CANVAS_BASELINE_PX } from './fontBaselines.js';

describe('CANVAS_BASELINE_PX', () => {
  it('exposes the per-layout heading/body/item canvas baselines', () => {
    expect(CANVAS_BASELINE_PX.cover.title).toBe(140);
    expect(CANVAS_BASELINE_PX.divider.title).toBe(140);
    expect(CANVAS_BASELINE_PX.text.title).toBe(84);
    expect(CANVAS_BASELINE_PX.text.body).toBe(32);
    expect(CANVAS_BASELINE_PX.agenda).toEqual({ 'items.n': 36, 'items.t': 38, 'items.d': 22 });
    expect(CANVAS_BASELINE_PX.list.items).toBe(38);
  });

  it('is deeply frozen — it is shared between the renderer and the export, so no consumer may mutate it', () => {
    expect(Object.isFrozen(CANVAS_BASELINE_PX)).toBe(true);
    for (const layout of ['cover', 'divider', 'text', 'agenda', 'list']) {
      expect(Object.isFrozen(CANVAS_BASELINE_PX[layout])).toBe(true);
    }
  });
});
