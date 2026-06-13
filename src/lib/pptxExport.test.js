import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record everything the export draws onto a mocked pptxgenjs, so we can assert
// the roadmap builder emits a real timeline instead of a placeholder.
const rec = vi.hoisted(() => ({ slides: [] }));
vi.mock('pptxgenjs', () => {
  class FakePptx {
    constructor() {
      this.ShapeType = { rect: 'rect', roundRect: 'roundRect', line: 'line' };
    }
    addSlide() {
      const s = {
        texts: [], shapes: [], charts: [], background: null,
        addText(t, o) { this.texts.push({ t, o }); },
        addShape(type, o) { this.shapes.push({ type, o }); },
        addChart(type, data, o) { this.charts.push({ type, data, o }); },
        addTable() {},
      };
      rec.slides.push(s);
      return s;
    }
    writeFile() { return Promise.resolve('ok.pptx'); }
  }
  return { default: FakePptx };
});

import { exportToPPTX } from './pptxExport.js';
import { CHART_SERIES_HEX } from './chartSpec.js';
import { SEVERITY_HEX } from './riskSpec.js';

const deckOf = (roadmap) => ({
  title: 'D', theme: 'indigo',
  sections: [{ id: 's1', name: 'X', slides: ['r'] }],
  slides: [{ id: 'r', layout: 'roadmap', ...roadmap }],
});
const last = () => rec.slides[rec.slides.length - 1];
const textsOf = (s) => s.texts.map((x) => String(x.t));

beforeEach(() => { rec.slides.length = 0; });

describe('addRoadmapSlide (PPTX timeline)', () => {
  it('renders the demo roadmap: month axis, lanes, bars, TODAY marker, and legend', async () => {
    await exportToPPTX(deckOf({ title: 'Roadmap' }));
    const s = last();
    const texts = textsOf(s);

    // month axis (default Jul..Jun)
    expect(texts).toContain('Jul');
    expect(texts).toContain('Jun');
    // lane names
    ['Platform', 'Growth', 'AI', 'Enterprise'].forEach((n) => expect(texts).toContain(n));
    // bars — one rounded rect per default item (3+3+2+3 = 11)
    expect(s.shapes.filter((sh) => sh.type === 'roundRect')).toHaveLength(11);
    // TODAY marker: a dashed line + its label
    expect(texts).toContain('TODAY');
    expect(s.shapes.some((sh) => sh.type === 'line' && sh.o.line?.dashType === 'dash')).toBe(true);
    // legend: one label per status
    ['Shipped', 'In-flight', 'At risk', 'Planned'].forEach((l) => expect(texts).toContain(l));
  });

  it('is data-driven: renders slide-supplied months/lanes and omits TODAY when unspecified', async () => {
    await exportToPPTX(deckOf({
      title: 'R',
      months: ['W1', 'W2'],
      lanes: [{ name: 'OnlyLane', items: [{ t: 0, d: 1, lbl: 'Task', state: 'inflight' }] }],
    }));
    const s = last();
    const texts = textsOf(s);
    expect(texts).toContain('OnlyLane');
    expect(texts).toContain('W1');
    expect(texts).toContain('Task');
    expect(texts).not.toContain('Platform'); // demo data not used
    expect(texts).not.toContain('TODAY');     // custom roadmap, no todayIndex
    expect(s.shapes.filter((sh) => sh.type === 'roundRect')).toHaveLength(1);
  });

  it('still emits the slide title', async () => {
    await exportToPPTX(deckOf({ title: 'My Plan' }));
    expect(textsOf(last())).toContain('My Plan');
  });

  it('keeps a bar label box within its bar even when the bar hits its minimum width', async () => {
    // 100 months drives the 1-month bar to its 0.12" floor — the case where a
    // 0.3" label-width floor would overflow the bar.
    await exportToPPTX(deckOf({
      months: Array.from({ length: 100 }, (_, i) => `M${i + 1}`),
      lanes: [{ name: 'L', items: [{ t: 0, d: 1, lbl: 'LongLabel', state: 'planned' }] }],
    }));
    const s = last();
    const bar = s.shapes.find((sh) => sh.type === 'roundRect');
    const label = s.texts.find((x) => x.t === 'LongLabel');
    expect(label.o.w).toBeLessThanOrEqual(bar.o.w); // label stays inside the bar at minimum width
  });
});

describe('addChartSlide (PPTX chart)', () => {
  const chartDeck = () => ({
    title: 'D', theme: 'indigo',
    sections: [{ id: 's1', name: 'X', slides: ['c'] }],
    slides: [{ id: 'c', layout: 'chart', chartType: 'bar', chart: { categories: ['A', 'B'], series: [{ name: 'S1', values: [1, 2] }, { name: 'S2', values: [3, 4] }] } }],
  });

  it('colours series from the shared palette (matching the canvas), not a theme-tinted one', async () => {
    await exportToPPTX(chartDeck());
    const chart = last().charts[0];
    expect(chart.o.chartColors).toEqual(CHART_SERIES_HEX);
    expect(chart.o.chartColors).not.toBe(CHART_SERIES_HEX); // a copy, so pptxgenjs can't mutate the frozen source
    expect(chart.data).toHaveLength(2);      // both series exported
    expect(chart.o.showLegend).toBe(true);   // multi-series legend
  });
});

describe('addRisksSlide (PPTX risks)', () => {
  it('labels each risk with its severity WORD and colour from the shared palette (a text channel, not colour alone)', async () => {
    await exportToPPTX({
      title: 'D', theme: 'indigo',
      sections: [{ id: 's1', name: 'X', slides: ['r'] }],
      slides: [{ id: 'r', layout: 'risks', title: 'Risks', items: [
        { sev: 'high', t: 'H', d: 'hd' },
        null,                            // malformed item → dropped, no crash (like the canvas)
        { sev: 'low', t: 'L', d: 'ld' },
        { t: 'no sev' },                 // missing severity → fallback grey, bare bullet
        { sev: 5, t: 'N', d: 'nd' },     // non-string severity → coerced, doesn't crash the export
      ] }],
    });
    const labels = last().texts.filter((x) => typeof x.t === 'string' && x.t.startsWith('●'));
    // colour matches the canvas palette (incl. fallback for unknown/missing) …
    expect(labels.map((x) => x.o.color)).toEqual([SEVERITY_HEX.high, SEVERITY_HEX.low, SEVERITY_HEX.fallback, SEVERITY_HEX.fallback]);
    // … and the severity is spelled out so the export reads without colour
    // (no trailing space when there's no word).
    expect(labels.map((x) => x.t)).toEqual(['● HIGH', '● LOW', '●', '● 5']);
    // The narrow gutter box must not wrap the label onto a second line.
    labels.forEach((x) => expect(x.o.wrap).toBe(false));
  });
});
