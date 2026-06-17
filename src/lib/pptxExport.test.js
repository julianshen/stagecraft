import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record everything the export draws onto a mocked pptxgenjs, so we can assert
// the roadmap builder emits a real timeline instead of a placeholder.
const rec = vi.hoisted(() => ({ slides: [] }));
vi.mock('pptxgenjs', () => {
  class FakePptx {
    constructor() {
      // Mirror the pptxgenjs ShapeType keys the exporter uses.
      this.ShapeType = {
        rect: 'rect', roundRect: 'roundRect', line: 'line', ellipse: 'ellipse',
        triangle: 'triangle', diamond: 'diamond', pentagon: 'pentagon',
        hexagon: 'hexagon', star5: 'star5', rightArrow: 'rightArrow',
      };
    }
    addSlide() {
      const s = {
        texts: [], shapes: [], charts: [], images: [], background: null, notes: null,
        addText(t, o) { this.texts.push({ t, o }); },
        addShape(type, o) { this.shapes.push({ type, o }); },
        addChart(type, data, o) { this.charts.push({ type, data, o }); },
        addImage(o) { this.images.push({ o }); },
        addTable() {},
        addNotes(t) { this.notes = t; },
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
import { SPEAKER_NOTES } from '../data/deck.js';

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

describe('exportToPPTX speaker notes', () => {
  const notesDeck = {
    title: 'D', theme: 'indigo',
    sections: [{ id: 's1', name: 'X', slides: ['cover', 'b', 'c'] }],
    slides: [
      { id: 'cover', layout: 'cover', title: 'C' },          // no .notes → SPEAKER_NOTES['cover'] fallback
      { id: 'b', layout: 'text', title: 'B', notes: 'authored B' }, // authored wins
      { id: 'c', layout: 'text', title: 'C2', notes: '' },   // explicit empty → no notes attached
    ],
  };

  it('attaches speaker notes by default — authored slide.notes, else the bundled SPEAKER_NOTES', async () => {
    await exportToPPTX(notesDeck);
    expect(rec.slides[0].notes).toBe(SPEAKER_NOTES.cover); // fallback to bundled
    expect(rec.slides[1].notes).toBe('authored B');         // authored preferred
    expect(rec.slides[2].notes).toBeNull();                 // empty string → nothing attached
  });

  it('omits all notes when includeNotes is false', async () => {
    await exportToPPTX(notesDeck, { includeNotes: false });
    expect(rec.slides.map((s) => s.notes)).toEqual([null, null, null]);
  });
});

describe('exportToPPTX — free-form elements overlay', () => {
  const elemDeck = (elements) => ({
    title: 'E', theme: 'indigo',
    sections: [{ id: 's', name: 'X', slides: ['e'] }],
    slides: [{ id: 'e', layout: 'text', title: 'T', elements }],
  });

  it('exports a text element as addText with px→pt size, style, and px→inch geometry', async () => {
    await exportToPPTX(elemDeck([
      { id: 't', type: 'text', x: 192, y: 96, w: 384, h: 192, content: 'Hi', fontSize: 48, bold: true, italic: true, underline: true, align: 'center', fill: '#112233' },
    ]));
    const t = last().texts.find((x) => x.t === 'Hi');
    expect(t).toBeTruthy();
    expect(t.o).toMatchObject({ x: 1, y: 0.5, w: 2, h: 1, fontSize: 18, bold: true, italic: true, underline: true, align: 'center', color: '112233' });
  });

  it('defaults a fill-less text element to the canvas ink colour, not the theme white', async () => {
    await exportToPPTX(elemDeck([{ id: 't', type: 'text', x: 0, y: 0, w: 200, h: 80, content: 'X' }]));
    const t = last().texts.find((x) => x.t === 'X');
    expect(t.o.color).toBe('15171C'); // matches ElementView's var(--ink, #15171C) default, not FFFFFF
  });

  it('exports an image element as addImage with its data URL, skipping an empty image', async () => {
    await exportToPPTX(elemDeck([
      { id: 'i', type: 'image', x: 0, y: 0, w: 480, h: 360, src: 'data:image/png;base64,AAA' },
      { id: 'i2', type: 'image', x: 0, y: 0, w: 100, h: 100, src: '' },
    ]));
    expect(last().images).toHaveLength(1);
    expect(last().images[0].o).toMatchObject({ data: 'data:image/png;base64,AAA', x: 0, y: 0, w: 2.5, h: 1.875 });
  });

  it('maps shape types to pptx ShapeType and emits the fill colour', async () => {
    await exportToPPTX(elemDeck([
      { id: 'r', type: 'shape', x: 0, y: 0, w: 192, h: 192, fill: '#ff0000' }, // 'shape' = the menu's Rectangle
      { id: 'c', type: 'circle', x: 0, y: 0, w: 192, h: 192, fill: '#00ff00' },
      { id: 'g', type: 'triangle', x: 0, y: 0, w: 192, h: 192, fill: '#0000ff' },
      { id: 's', type: 'star', x: 0, y: 0, w: 192, h: 192, fill: '#abcdef' },
    ]));
    const byType = Object.fromEntries(last().shapes.map((s) => [s.type, s.o]));
    expect(byType.rect.fill).toEqual({ color: 'FF0000' }); // 'shape' → rect
    expect(byType.ellipse).toBeTruthy();      // circle → ellipse
    expect(byType.triangle).toBeTruthy();
    expect(byType.star5).toBeTruthy();        // star → star5
  });

  it('applies rotation and opacity (→ transparency) to a shape', async () => {
    await exportToPPTX(elemDeck([
      { id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#123456', rot: 30, opacity: 40 },
    ]));
    const r = last().shapes.find((s) => s.type === 'rect');
    expect(r.o.rotate).toBe(30);
    expect(r.o.fill).toEqual({ color: '123456', transparency: 60 }); // 100 - 40
  });

  it('exports a line as a rect at its real thickness (no 8px cap)', async () => {
    await exportToPPTX(elemDeck([{ id: 'l', type: 'line', x: 0, y: 0, w: 384, h: 24, fill: '#15171c' }]));
    const l = last().shapes.find((s) => s.type === 'rect');
    expect(l.o.w).toBe(2);
    expect(l.o.h).toBeCloseTo(24 / 192, 4); // its real thickness, not clamped to 8/192
  });

  it('draws nothing extra for a slide with no elements', async () => {
    await exportToPPTX(elemDeck(undefined));
    expect(last().images).toHaveLength(0);
  });

  it('forwards opacity to a text element (canvas applies it to every element)', async () => {
    await exportToPPTX(elemDeck([{ id: 't', type: 'text', x: 0, y: 0, w: 200, h: 80, content: 'X', opacity: 40 }]));
    expect(last().texts.find((x) => x.t === 'X').o.transparency).toBe(60);
  });

  it('hardens against malformed elements (null entries, non-finite fields)', async () => {
    // A null entry must not crash the export; non-finite coords coerce, not NaN.
    await exportToPPTX(elemDeck([
      null,
      { id: 'r', type: 'shape', x: NaN, y: undefined, w: '100', h: 50, fill: '#fff' },
    ]));
    const r = last().shapes.find((s) => s.type === 'rect');
    expect(r.o.x).toBe(0);                       // NaN x → 0, not NaN
    expect(r.o.y).toBe(0);                       // undefined y → 0
    expect(Number.isFinite(r.o.w)).toBe(true);   // '100' (typed) → finite
  });

  it('treats a non-array slide.elements as empty (no garbage shapes from iterating a string)', async () => {
    await exportToPPTX(elemDeck('oops'));
    expect(last().shapes).toHaveLength(0); // not 4 rects from 'o','o','p','s'
  });
});
