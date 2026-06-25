import { describe, it, expect } from 'vitest';
import { CANVAS_BASELINE_PX } from './fontBaselines.js';

describe('CANVAS_BASELINE_PX', () => {
  it('exposes the per-layout heading/body/item canvas baselines', () => {
    expect(CANVAS_BASELINE_PX.cover.title).toBe(140);
    expect(CANVAS_BASELINE_PX.divider.title).toBe(140);
    expect(CANVAS_BASELINE_PX.text.title).toBe(84);
    expect(CANVAS_BASELINE_PX.text.body).toBe(32);
    expect(CANVAS_BASELINE_PX.agenda).toEqual({ title: 96, 'items.n': 36, 'items.t': 38, 'items.d': 22 });
    expect(CANVAS_BASELINE_PX.list).toEqual({ title: 84, items: 38 });
    for (const layout of ['chart', 'table', 'roadmap']) {
      expect(CANVAS_BASELINE_PX[layout]).toEqual({ title: 72 });
    }
    // kpi/split/risks also carry their per-item data fields (keyed by field-type).
    expect(CANVAS_BASELINE_PX.kpi).toEqual({ title: 72, 'kpis.val': 68, 'kpis.label': 16, 'kpis.delta': 14 });
    expect(CANVAS_BASELINE_PX.split).toEqual({ title: 72, 'stats.val': 72, 'stats.lbl': 20 });
    expect(CANVAS_BASELINE_PX.risks).toEqual({ title: 72, 'items.t': 36, 'items.d': 24 });
    expect(CANVAS_BASELINE_PX.thanks).toEqual({ title: 220 });
  });

  it('is deeply frozen — it is shared between the renderer and the export, so no consumer may mutate it', () => {
    expect(Object.isFrozen(CANVAS_BASELINE_PX)).toBe(true);
    for (const layout of Object.keys(CANVAS_BASELINE_PX)) {
      expect(Object.isFrozen(CANVAS_BASELINE_PX[layout])).toBe(true);
    }
  });
});
