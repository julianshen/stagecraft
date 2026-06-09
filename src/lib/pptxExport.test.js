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
        texts: [], shapes: [], background: null,
        addText(t, o) { this.texts.push({ t, o }); },
        addShape(type, o) { this.shapes.push({ type, o }); },
        addTable() {}, addChart() {},
      };
      rec.slides.push(s);
      return s;
    }
    writeFile() { return Promise.resolve('ok.pptx'); }
  }
  return { default: FakePptx };
});

import { exportToPPTX } from './pptxExport.js';

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

  it('keeps a bar label box within its bar so short bars do not spill onto the background', async () => {
    // 12 months makes a 1-month bar narrow (~0.59"), where the old Math.max(bw,1.3) overflowed.
    await exportToPPTX(deckOf({
      months: Array.from({ length: 12 }, (_, i) => `M${i + 1}`),
      lanes: [{ name: 'L', items: [{ t: 0, d: 1, lbl: 'LongLabel', state: 'planned' }] }],
    }));
    const s = last();
    const bar = s.shapes.find((sh) => sh.type === 'roundRect');
    const label = s.texts.find((x) => x.t === 'LongLabel');
    expect(label.o.w).toBeLessThanOrEqual(bar.o.w); // label stays inside the bar
  });
});
