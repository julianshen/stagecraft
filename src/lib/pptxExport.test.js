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
        custGeom: 'custGeom', // freeform geometry — real pptxgen 3.12 enum value (pptxgen.cjs.js:242)
      };
    }
    addSlide() {
      const s = {
        texts: [], shapes: [], charts: [], images: [], tables: [], background: null, notes: null,
        addText(t, o) { this.texts.push({ t, o }); },
        addShape(type, o) { this.shapes.push({ type, o }); },
        addChart(type, data, o) { this.charts.push({ type, data, o }); },
        addImage(o) { this.images.push({ o }); },
        addTable(rows, o) { this.tables.push({ rows, o }); },
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
import { CANVAS_BASELINE_PX } from './fontBaselines.js';
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
const optsOf = (s, text) => s.texts.find((x) => String(x.t) === text)?.o;
// A deck wrapping a single slide (section id/name are arbitrary — tests assert
// on the slide's export, not the section).
const deckWith = (slide) => ({
  title: 'D', theme: 'indigo',
  sections: [{ id: 's1', name: 'X', slides: [slide.id] }],
  slides: [slide],
});

beforeEach(() => { rec.slides.length = 0; });

describe('exportToPPTX — font-size parity (text layout)', () => {
  // Canvas defaults (SlideRenderer text layout): title 84px, body 32px.
  // Export pt baselines (addTextSlide): title 26pt, body 15pt.
  const textDeck = (fmt) => ({
    title: 'D', theme: 'indigo',
    sections: [{ id: 's', name: 'S', slides: ['t'] }],
    slides: [{ id: 't', layout: 'text', title: 'Heading', body: 'Body copy', ...(fmt ? { fmt } : {}) }],
  });

  it('exports the title/body at their pt baselines when unformatted', async () => {
    await exportToPPTX(textDeck());
    expect(optsOf(last(), 'Heading').fontSize).toBe(26);
    expect(optsOf(last(), 'Body copy').fontSize).toBe(15);
  });

  it('scales the exported title pt by the canvas font-size ratio (fmt.fontSize ÷ baseline px)', async () => {
    await exportToPPTX(textDeck({ title: { fontSize: CANVAS_BASELINE_PX.text.title * 2 } })); // 2× the canvas baseline
    expect(optsOf(last(), 'Heading').fontSize).toBe(52);        // export baseline 26pt × 2
  });

  it('scales the exported body pt by its own canvas ratio', async () => {
    await exportToPPTX(textDeck({ body: { fontSize: CANVAS_BASELINE_PX.text.body / 2 } })); // 0.5× the canvas baseline
    expect(optsOf(last(), 'Body copy').fontSize).toBe(7.5);     // export baseline 15pt × 0.5
  });

  it('floors a malformed (gate-bypassing) fmt.fontSize back to the pt baseline', async () => {
    // ≤0 / non-finite is now gate-rejected (isFmtRecord), but a server/MCP write can
    // bypass the deck gate — the export defends by keeping the baseline rather than
    // emitting a 0 / NaN / Infinity pt size.
    await exportToPPTX(textDeck({ title: { fontSize: 0 } }));
    expect(optsOf(last(), 'Heading').fontSize).toBe(26);
    await exportToPPTX(textDeck({ title: { fontSize: Infinity } }));
    expect(optsOf(last(), 'Heading').fontSize).toBe(26);
  });
});

describe('exportToPPTX — font-size parity (cover + divider headings)', () => {
  // Canvas title baselines: cover 140px, divider 140px. Export pt: cover 44, divider 36.
  const coverDeck = (fmt) => ({
    title: 'D', theme: 'indigo',
    sections: [{ id: 's', name: 'S', slides: ['c'] }],
    slides: [{ id: 'c', layout: 'cover', title: 'Hero', ...(fmt ? { fmt } : {}) }],
  });
  const dividerDeck = (fmt) => ({
    title: 'D', theme: 'indigo',
    sections: [{ id: 's', name: 'S', slides: ['d'] }],
    slides: [{ id: 'd', layout: 'divider', title: 'Part One', chapter: '1', ...(fmt ? { fmt } : {}) }],
  });

  it('exports the cover title at its pt baseline, scaling it by the canvas ratio', async () => {
    await exportToPPTX(coverDeck());
    expect(optsOf(last(), 'Hero').fontSize).toBe(44);
    await exportToPPTX(coverDeck({ title: { fontSize: CANVAS_BASELINE_PX.cover.title * 2 } }));
    expect(optsOf(last(), 'Hero').fontSize).toBe(88); // 44 × 2
  });

  it('exports the divider title at its pt baseline, scaling it by the canvas ratio', async () => {
    await exportToPPTX(dividerDeck());
    expect(optsOf(last(), 'Part One').fontSize).toBe(36);
    await exportToPPTX(dividerDeck({ title: { fontSize: CANVAS_BASELINE_PX.divider.title / 2 } }));
    expect(optsOf(last(), 'Part One').fontSize).toBe(18); // 36 × 0.5
  });
});

describe('exportToPPTX — font-size parity (agenda / list items, index-keyed)', () => {
  // Canvas px: agenda items.n 36 / items.t 38 / items.d 22; list items 38.
  // Export pt: agenda items.n 12 / items.t 15 / items.d 11; list items 14.
  const agendaItem = (fmt) => deckWith({ id: 'a', layout: 'agenda', title: 'Plan', items: [{ n: '01', t: 'First', d: 'Details' }], ...(fmt ? { fmt } : {}) });
  const listDeck = (fmt) => deckWith({ id: 'l', layout: 'list', title: 'Items', items: ['Alpha', 'Beta'], ...(fmt ? { fmt } : {}) });

  it('exports the agenda item fields at their pt baselines when unformatted', async () => {
    await exportToPPTX(agendaItem());
    expect(optsOf(last(), 'First').fontSize).toBe(15);   // items.t
    expect(optsOf(last(), '01').fontSize).toBe(12);      // items.n
    expect(optsOf(last(), 'Details').fontSize).toBe(11); // items.d
  });

  it('scales each agenda item field by its own per-field-type canvas ratio (per-index fmt key)', async () => {
    await exportToPPTX(agendaItem({ 'items.0.t': { fontSize: CANVAS_BASELINE_PX.agenda['items.t'] * 2 } }));
    expect(optsOf(last(), 'First').fontSize).toBe(30);   // 15 × 2
    await exportToPPTX(agendaItem({ 'items.0.n': { fontSize: CANVAS_BASELINE_PX.agenda['items.n'] / 2 } }));
    expect(optsOf(last(), '01').fontSize).toBe(6);       // 12 × 0.5
    await exportToPPTX(agendaItem({ 'items.0.d': { fontSize: CANVAS_BASELINE_PX.agenda['items.d'] * 2 } }));
    expect(optsOf(last(), 'Details').fontSize).toBe(22); // 11 × 2
  });

  it('scales a non-first item independently via its own per-index fmt key', async () => {
    await exportToPPTX(deckWith({
      id: 'a', layout: 'agenda', title: 'Plan',
      items: [{ n: '01', t: 'First', d: 'd1' }, { n: '02', t: 'Second', d: 'd2' }],
      fmt: { 'items.1.t': { fontSize: CANVAS_BASELINE_PX.agenda['items.t'] * 2 } }, // resize ONLY the 2nd row's title
    }));
    expect(optsOf(last(), 'Second').fontSize).toBe(30); // items.1.t → 15 × 2
    expect(optsOf(last(), 'First').fontSize).toBe(15);  // items.0.t untouched (baseline)
  });

  it('exports list items at the pt baseline, scaling by the canvas ratio', async () => {
    await exportToPPTX(listDeck());
    expect(optsOf(last(), '• Alpha').fontSize).toBe(14);
    await exportToPPTX(listDeck({ 'items.0': { fontSize: CANVAS_BASELINE_PX.list.items * 2 } }));
    expect(optsOf(last(), '• Alpha').fontSize).toBe(28); // 14 × 2
  });
});

describe('exportToPPTX — thanks / generic / split / cover-subtitle builders', () => {
  it('exports a thanks slide (title + subtitle), and its default title when none is given', async () => {
    await exportToPPTX(deckWith({ id: 't', layout: 'thanks', title: 'Thanks!', subtitle: 'Questions?' }));
    expect(textsOf(last())).toEqual(expect.arrayContaining(['Thanks!', 'Questions?']));
    await exportToPPTX(deckWith({ id: 't2', layout: 'thanks' }));
    expect(textsOf(last())).toContain('Thank you'); // `slide.title || 'Thank you'`
  });

  it('exports an unknown layout via the generic builder (title + body, and the subtitle fallback)', async () => {
    await exportToPPTX(deckWith({ id: 'g', layout: 'mystery', title: 'Custom', body: 'Freeform body' }));
    expect(textsOf(last())).toEqual(expect.arrayContaining(['Custom', 'Freeform body']));
    await exportToPPTX(deckWith({ id: 'g2', layout: 'mystery', subtitle: 'Sub only' })); // no body → subtitle path; no title → layout name
    expect(textsOf(last())).toEqual(expect.arrayContaining(['mystery', 'Sub only']));
  });

  it('exports the cover subtitle when present', async () => {
    await exportToPPTX(deckWith({ id: 'c', layout: 'cover', title: 'Hero', subtitle: 'A subtitle' }));
    expect(textsOf(last())).toContain('A subtitle');
  });

  it('exports the split body when present', async () => {
    await exportToPPTX(deckWith({ id: 'sp', layout: 'split', title: 'Split', body: 'Left body' }));
    expect(textsOf(last())).toContain('Left body');
  });
});

describe('exportToPPTX — slide range', () => {
  const deck3 = {
    title: 'D', theme: 'indigo',
    sections: [{ id: 's', name: 'S', slides: ['a', 'b', 'c'] }],
    slides: [
      { id: 'a', layout: 'text', title: 'A' },
      { id: 'b', layout: 'text', title: 'B' },
      { id: 'c', layout: 'text', title: 'C' },
    ],
  };
  it('exports every flattened slide when no range is given', async () => {
    await exportToPPTX(deck3);
    expect(rec.slides).toHaveLength(3);
  });
  it('exports only the slides within an inclusive 1-indexed range', async () => {
    await exportToPPTX(deck3, { range: { from: 2, to: 3 } });
    expect(rec.slides).toHaveLength(2); // b, c
  });
  it('clamps a range whose end overruns the deck', async () => {
    await exportToPPTX(deck3, { range: { from: 2, to: 99 } });
    expect(rec.slides).toHaveLength(2); // b, c — end clamped
  });
  it('normalises an inverted range (from > to) by swapping the bounds', async () => {
    await exportToPPTX(deck3, { range: { from: 3, to: 1 } });
    expect(rec.slides).toHaveLength(3); // 1..3 after the swap — not an empty export
  });
  it('clamps an out-of-range start into the deck instead of emitting nothing', async () => {
    await exportToPPTX(deck3, { range: { from: 5, to: 5 } });
    expect(rec.slides).toHaveLength(1); // clamped to the last slide
  });
  it('floors a start below 1 up to the first slide', async () => {
    await exportToPPTX(deck3, { range: { from: 0, to: 2 } });
    expect(rec.slides).toHaveLength(2); // 1..2
  });
});

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

  it('exports a text element line spacing as a pptxgen lineSpacingMultiple (default 1.2, matching the canvas)', async () => {
    await exportToPPTX(elemDeck([
      { id: 't', type: 'text', x: 0, y: 0, w: 200, h: 80, content: 'Spaced', fill: '#111', lineSpacing: 1.8 },
      { id: 'd', type: 'text', x: 0, y: 0, w: 200, h: 80, content: 'Default', fill: '#111' },
    ]));
    expect(last().texts.find((t) => t.t === 'Spaced').o.lineSpacingMultiple).toBe(1.8);
    expect(last().texts.find((t) => t.t === 'Default').o.lineSpacingMultiple).toBe(1.2); // absent → 1.2, matching the canvas line-height
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

  it('exports a path element as a custGeom shape: points scaled to box inches + a line, no fill', async () => {
    await exportToPPTX(elemDeck([
      { id: 'p', type: 'path', x: 192, y: 96, w: 384, h: 192, points: [[0, 0], [0.5, 1], [1, 0.5]], stroke: '#112233', strokeWidth: 4 },
    ]));
    const shape = last().shapes.find((s) => s.type === 'custGeom');
    expect(shape).toBeTruthy();
    expect(shape.o).toMatchObject({ x: 1, y: 0.5, w: 2, h: 1 }); // px→inch (192px = 1in)
    // points: normalized × box-inches; first is moveTo, the rest lnTo (the serializer keys on this).
    expect(shape.o.points).toEqual([
      { x: 0, y: 0, moveTo: true }, // 0×2, 0×1
      { x: 1, y: 1 },               // 0.5×2, 1×1
      { x: 2, y: 0.5 },             // 1×2, 0.5×1
    ]);
    expect(shape.o.line).toMatchObject({ color: '112233', width: 1.5 }); // 4px → 1.5pt
    // No `fill` key → pptxgen emits <a:noFill/> (an open stroke). Passing
    // {type:'none'} instead emits an empty fill and the shape inherits a theme fill.
    expect(shape.o.fill).toBeUndefined();
  });

  it('drops malformed points in a path export (no NaN coords, no crash)', async () => {
    await exportToPPTX(elemDeck([
      { id: 'p', type: 'path', x: 0, y: 0, w: 192, h: 192, points: [[0, 0], null, [1, 1]], stroke: '#111', strokeWidth: 2 },
    ]));
    const shape = last().shapes.find((s) => s.type === 'custGeom');
    expect(shape.o.points).toEqual([{ x: 0, y: 0, moveTo: true }, { x: 1, y: 1 }]); // null dropped, no NaN
  });

  it('exports a dashed box-shape stroke with a pptxgen line dashType', async () => {
    await exportToPPTX(elemDeck([
      { id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#aabbcc', stroke: '#112233', strokeWidth: 4, strokeDash: 'dashed' },
    ]));
    expect(last().shapes.find((s) => s.type === 'rect').o.line.dashType).toBe('dash');
  });

  it('exports a dotted pen path with a line dashType, and omits it when solid', async () => {
    await exportToPPTX(elemDeck([
      { id: 'p', type: 'path', x: 0, y: 0, w: 100, h: 100, points: [[0, 0], [1, 1]], stroke: '#111', strokeWidth: 2, strokeDash: 'dotted' },
    ]));
    expect(last().shapes.find((s) => s.type === 'custGeom').o.line.dashType).toBe('sysDot');
    await exportToPPTX(elemDeck([
      { id: 'p2', type: 'path', x: 0, y: 0, w: 100, h: 100, points: [[0, 0], [1, 1]], stroke: '#111', strokeWidth: 2 },
    ]));
    expect(last().shapes.find((s) => s.type === 'custGeom').o.line).not.toHaveProperty('dashType'); // solid → no dashType
  });

  it('omits the line on a zero-width path so the export matches the invisible canvas stroke', async () => {
    await exportToPPTX(elemDeck([
      { id: 'p', type: 'path', x: 0, y: 0, w: 100, h: 100, points: [[0, 0], [1, 1]], stroke: '#111', strokeWidth: 0 },
    ]));
    const shape = last().shapes.find((s) => s.type === 'custGeom');
    // width 0 → no line (pptxgen would otherwise emit <a:ln> + colour = a default ~0.75pt line, which the canvas does not draw)
    expect(shape.o.line).toBeUndefined();
  });

  it('skips exporting a path with fewer than 2 valid points (matches the blank canvas)', async () => {
    await exportToPPTX(elemDeck([
      { id: 'p', type: 'path', x: 0, y: 0, w: 100, h: 100, points: [[0, 0], null], stroke: '#111', strokeWidth: 2 },
    ]));
    // only 1 valid point after filtering → a degenerate custGeom; skip it (the canvas draws nothing either)
    expect(last().shapes.find((s) => s.type === 'custGeom')).toBeUndefined();
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

  it('exports a shape stroke as a pptx line (hex colour + pt width) — box and clip polygon alike', async () => {
    await exportToPPTX(elemDeck([
      { id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#ffffff', stroke: '#123456', strokeWidth: 4 },
      { id: 'g', type: 'triangle', x: 0, y: 0, w: 192, h: 192, fill: '#ffffff', stroke: '#123456', strokeWidth: 4 },
    ]));
    const byType = Object.fromEntries(last().shapes.map((s) => [s.type, s.o]));
    expect(byType.rect.line).toEqual({ color: '123456', width: 1.5 });     // PT(4) = 4*72/192; canvas border == export line
    expect(byType.triangle.line).toEqual({ color: '123456', width: 1.5 }); // clip polygon now strokes too (SVG overlay on canvas)
  });

  it('omits the line when a box shape has no stroke (or a zero width)', async () => {
    await exportToPPTX(elemDeck([{ id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#fff', stroke: '#123456', strokeWidth: 0 }]));
    expect(last().shapes.find((s) => s.type === 'rect').o.line).toBeUndefined();
  });

  it('applies the element opacity to the exported stroke line too (the canvas border is translucent)', async () => {
    await exportToPPTX(elemDeck([{ id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#fff', stroke: '#123456', strokeWidth: 4, opacity: 40 }]));
    const r = last().shapes.find((s) => s.type === 'rect');
    expect(r.o.line).toEqual({ color: '123456', width: 1.5, transparency: 60 }); // matches the fill's transparency
  });

  it('exports a gradient fill as the midpoint-blend solid (pptxgen has no shape gradient)', async () => {
    await exportToPPTX(elemDeck([{ id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#fff', gradient: { from: '#000000', to: '#ffffff', angle: 90 } }]));
    expect(last().shapes.find((s) => s.type === 'rect').o.fill.color).toBe('808080'); // mixHex(#000,#fff)=#808080
  });

  it('exports the solid fill for a malformed gradient (parity with the canvas fallback)', async () => {
    await exportToPPTX(elemDeck([{ id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#abcdef', gradient: { from: 'red', to: '#fff', angle: 90 } }]));
    expect(last().shapes.find((s) => s.type === 'rect').o.fill.color).toBe('ABCDEF'); // non-hex stop → solid fill, not a blend
  });

  it('exports an element shadow as a pptx outer shadow (colour, blur/offset in pt, angle from x/y)', async () => {
    await exportToPPTX(elemDeck([{ id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#fff', shadow: { color: '#112233', blur: 16, x: 0, y: 8 } }]));
    const r = last().shapes.find((s) => s.type === 'rect');
    // PT(16)=6, PT(hypot(0,8))=PT(8)=3, atan2(8,0)=90° (+ el.rot 0); opacity =
    // SHADOW_OPACITY (0.35) × 1. See the el.rot-baking test below for rotation.
    expect(r.o.shadow).toEqual({ type: 'outer', color: '112233', opacity: 0.35, blur: 6, offset: 3, angle: 90 });
  });

  it('bakes el.rot into the shadow angle (pptxgen 3.12 emits rotWithShape=0, ignoring the option)', async () => {
    // On the canvas the drop-shadow is painted in the element's local space then
    // rotated by the same transform, so the offset turns with the shape. pptxgen
    // 3.12 hardcodes rotWithShape="0" on the shape shadow (an ABSOLUTE angle, the
    // option is ignored), so the local angle must carry el.rot itself. A local
    // down shadow (90°) on a +45° element casts down-left → 135° absolute.
    await exportToPPTX(elemDeck([{ id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#fff', rot: 45, shadow: { color: '#000000', blur: 8, x: 0, y: 8 } }]));
    const r = last().shapes.find((s) => s.type === 'rect');
    expect(r.o.rotate).toBe(45);
    expect(r.o.shadow.angle).toBe(135); // local atan2(8,0)=90 + el.rot 45
    expect(r.o.shadow.rotateWithShape).toBeUndefined(); // not a real 3.12 option
  });

  // pptxgen 3.12 coalesces a falsy shadow field to its OWN default (blur||8,
  // offset||4, angle||270, opacity||0.75), so a genuine 0 must reach it as a
  // sub-unit epsilon (truthy, but rounds back to 0 in the serialised units) or
  // the canvas shadow exports as pptx's upward 4pt default instead.
  const shadowFor = (shadow, extra = {}) => exportToPPTX(elemDeck([{ id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#fff', ...extra, shadow }]))
    .then(() => last().shapes.find((s) => s.type === 'rect').o.shadow);
  const nearZero = (v) => { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(0.001); };

  it('preserves a centred glow (x=0,y=0) — zero offset/angle survive pptxgen falsy-coalescing', async () => {
    const sh = await shadowFor({ color: '#000000', blur: 16, x: 0, y: 0 });
    nearZero(sh.offset); // else pptxgen `offset || 4` → a 4pt directional shadow
    nearZero(sh.angle);  // else pptxgen `angle || 270` → cast upward
  });
  it('preserves a rightward shadow (x>0,y=0) — zero angle survives, real offset kept', async () => {
    const sh = await shadowFor({ color: '#000000', blur: 8, x: 10, y: 0 });
    nearZero(sh.angle);          // atan2(0,10)=0; must not default to 270 (upward)
    expect(sh.offset).toBeCloseTo(3.75, 2); // PT(10) — a real offset, unchanged
  });
  it('preserves a sharp shadow (blur=0) — does not default to pptxgen blur 8', async () => {
    nearZero((await shadowFor({ color: '#000000', blur: 0, x: 0, y: 8 })).blur);
  });
  it('preserves a near-zero shadow opacity (a faint element) — not pptxgen opacity 0.75', async () => {
    // op rounds to 0 for a fully-transparent element; without the guard pptxgen
    // would paint a 0.75 shadow on an element the canvas renders invisible.
    nearZero((await shadowFor({ color: '#000000', blur: 8, x: 0, y: 8 }, { opacity: 0 })).opacity);
  });

  it('dims the exported shadow by the element opacity (the canvas opacity dims the whole element)', async () => {
    await exportToPPTX(elemDeck([{ id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#fff', opacity: 50, shadow: { color: '#000000', blur: 8, x: 0, y: 8 } }]));
    expect(last().shapes.find((s) => s.type === 'rect').o.shadow.opacity).toBe(0.18); // 0.35 × 0.5 = 0.175 → 0.18 (round half-up)
  });

  it('clamps an out-of-range element opacity before dimming the shadow (parity with the canvas + fill)', async () => {
    await exportToPPTX(elemDeck([{ id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#fff', opacity: 200, shadow: { color: '#000000', blur: 8, x: 0, y: 8 } }]));
    expect(last().shapes.find((s) => s.type === 'rect').o.shadow.opacity).toBe(0.35); // opacity 200 → clamped 100 → op 1 → SHADOW_OPACITY
  });

  it('skips a malformed shadow rather than exporting NaN (gate-bypassing writes can persist one)', async () => {
    // The server write paths don't run sanitizeSlidePatch, so a persisted `{}` or
    // `{ x: 'bad' }` shadow would convert to NaN blur/offset/angle → a corrupt pptx.
    // The canvas drops the invalid CSS filter; the export must skip it for parity.
    for (const bad of [{}, { color: '#000000', blur: 16, x: 'bad', y: 8 }, { color: 'nope', blur: 8, x: 0, y: 8 }]) {
      await exportToPPTX(elemDeck([{ id: 'r', type: 'rect', x: 0, y: 0, w: 192, h: 192, fill: '#fff', shadow: bad }]));
      expect(last().shapes.find((s) => s.type === 'rect').o.shadow).toBeUndefined();
    }
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

describe('per-field / per-item formatting (slide.fmt)', () => {

  it('maps bold + colour onto a field that has neither by default (text body)', async () => {
    await exportToPPTX(deckWith({ id: 't', layout: 'text', title: 'T', body: 'Body', fmt: { body: { bold: true, color: '#ff0000' } } }));
    const o = optsOf(last(), 'Body');
    expect(o.bold).toBe(true);
    expect(o.color).toBe('FF0000'); // CSS hex → bare RRGGBB
  });

  it('maps italic + underline, and is relative: a template-bold title stays bold', async () => {
    await exportToPPTX(deckWith({ id: 't', layout: 'text', title: 'Keep', fmt: { title: { italic: true, underline: true } } }));
    const o = optsOf(last(), 'Keep');
    expect(o.italic).toBe(true);
    expect(o.underline).toEqual({ style: 'sng' }); // object form underlines on both addText + addTable paths
    expect(o.bold).toBe(true); // base bold preserved — fmt set no bold, so no override
  });

  it('formats a per-item agenda field (items.0.t)', async () => {
    await exportToPPTX(deckWith({ id: 'a', layout: 'agenda', title: 'T', items: [{ n: '01', t: 'First', d: 'd' }], fmt: { 'items.0.t': { color: '#0088ff' } } }));
    expect(optsOf(last(), 'First').color).toBe('0088FF');
  });

  it('formats a per-item list bullet (items.1)', async () => {
    await exportToPPTX(deckWith({ id: 'l', layout: 'list', title: 'T', items: ['A', 'B'], fmt: { 'items.1': { bold: true } } }));
    expect(optsOf(last(), '• B').bold).toBe(true);
  });

  it('formats kpi and stat item fields', async () => {
    await exportToPPTX(deckWith({ id: 'k', layout: 'kpi', title: 'T', kpis: [{ val: '42', label: 'Users', delta: '+5' }], fmt: { 'kpis.0.val': { color: '#00ff00' } } }));
    expect(optsOf(last(), '42').color).toBe('00FF00');
    await exportToPPTX(deckWith({ id: 'sp', layout: 'split', title: 'T', stats: [{ val: '9', lbl: 'L' }], fmt: { 'stats.0.lbl': { bold: true } } }));
    expect(optsOf(last(), 'L').bold).toBe(true);
  });

  it('formats a table header cell and a body cell', async () => {
    await exportToPPTX(deckWith({ id: 'tb', layout: 'table', title: 'T', columns: ['H1', 'H2'], rows: [['a', 'b']], fmt: { 'columns.1': { italic: true }, 'rows.0.0': { underline: true } } }));
    const table = last().tables[0];
    expect(table.rows[0][1].options.italic).toBe(true);     // header columns.1
    // object form, so it underlines in the real exported table (a boolean would be dropped on the addTable path)
    expect(table.rows[1][0].options.underline).toEqual({ style: 'sng' }); // body cell rows.0.0
  });

  it('tolerates null per-item entries — no crash, gap-free layout, true-index fmt key', async () => {
    // The renderer guards null items (it && …) keeping the true index for the
    // fmt key; the export must match — drop nulls, lay survivors out gap-free,
    // and key fmt by the original index.
    await exportToPPTX(deckWith({ id: 'a', layout: 'agenda', title: 'T', items: [null, { n: '02', t: 'Second', d: 'd' }], fmt: { 'items.1.t': { bold: true } } }));
    const ag = optsOf(last(), 'Second');
    expect(ag.bold).toBe(true); // survivor keeps its TRUE-index fmt (items.1.t)
    expect(ag.y).toBe(1.3);     // laid out at the first row (gap-free), not row 1
    // kpi + split (object items) must not crash on a null entry either
    await exportToPPTX(deckWith({ id: 'k', layout: 'kpi', title: 'T', kpis: [null, { val: '42', label: 'L' }] }));
    expect(optsOf(last(), '42')).toBeTruthy();
    await exportToPPTX(deckWith({ id: 'sp', layout: 'split', title: 'T', stats: [null, { val: '9', lbl: 'L' }] }));
    expect(optsOf(last(), '9')).toBeTruthy();
    // list (primitive items) drops a nullish entry rather than emitting "• null"
    await exportToPPTX(deckWith({ id: 'l', layout: 'list', title: 'T', items: [null, 'B'] }));
    expect(optsOf(last(), '• null')).toBeUndefined();
    expect(optsOf(last(), '• B')).toBeTruthy();
  });

  it('keeps the field’s own colour when fmt.color is not a #hex (avoids exporting a wrong indigo)', async () => {
    // The toolbar always emits #rrggbb, but an AI patch may set a named/oklch
    // colour the export can't convert; rather than toHex's indigo fallback,
    // leave the field's template colour.
    await exportToPPTX(deckWith({ id: 't', layout: 'text', title: 'T', body: 'Body', fmt: { body: { color: 'red' } } }));
    expect(optsOf(last(), 'Body').color).toBe('CCCCCC'); // base body colour — NOT indigo
  });

  it('ignores a malformed fmt entry (non-object) without crashing or formatting', async () => {
    // The export is a serialization boundary (disk-persisted / agent-authored
    // decks can bypass the patch gate), so a non-object fmt entry must be a no-op.
    await exportToPPTX(deckWith({ id: 't', layout: 'text', title: 'T', body: 'Body', fmt: { body: 'bold' } }));
    const o = optsOf(last(), 'Body');
    expect(o.bold).toBeUndefined();   // string entry → no override
    expect(o.fontSize).toBe(15);      // base unchanged, no crash
  });

  it('scales fmt.fontSize into the export for an opted-in field (text body), other axes still applying', async () => {
    await exportToPPTX(deckWith({ id: 't', layout: 'text', title: 'T', body: 'Big', fmt: { body: { fontSize: CANVAS_BASELINE_PX.text.body * 2, bold: true } } }));
    const o = optsOf(last(), 'Big');
    expect(o.fontSize).toBe(30); // 15pt baseline × 2 (canvas 2× → export 2×)
    expect(o.bold).toBe(true);   // other fmt axes still apply
  });

  it('does NOT scale fmt.fontSize for a layout that has not opted in (agenda title), other axes still applying', async () => {
    await exportToPPTX(deckWith({ id: 'a', layout: 'agenda', title: 'Plan', items: [], fmt: { title: { fontSize: 300, italic: true } } }));
    const o = optsOf(last(), 'Plan');
    expect(o.fontSize).toBe(22);   // agenda title baseline unchanged (no basePx) — parity is wired per-layout
    expect(o.italic).toBe(true);   // other fmt axes still apply
  });
});
