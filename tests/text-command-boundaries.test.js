import { describe, expect, it } from 'vitest';
import { createEditor } from '../packages/core/src/editor/index.js';
import { createDocument, documentPlugin, validateDocument } from '../packages/core/src/document/index.js';

const authored = () => ({ stagecraftAuthored: true });
const run = (id, text, style = {}) => ({ id, text, style, editable: true, extensions: authored() });
const paragraph = (id, runs) => ({ id, runs });
function fixture(paragraphs = [paragraph('p1', [run('r1', 'A😀BC'), run('r2', 'tail')]), paragraph('p2', [run('r3', 'Next')])]) {
  const d = createDocument();
  d.slides.push({ id: 's', objects: [{ id: 'o', type: 'text', geometry: { x: 0, y: 0, width: 100, height: 100 }, extensions: authored(), text: { paragraphs } }], extensions: authored() });
  return d;
}
const engine = document => createEditor({ document: document ?? fixture(), validateDocument, plugins: [documentPlugin] });
const point = (paragraphId, runId, offset) => ({ paragraphId, runId, offset });
const payload = (start = point('p1', 'r1', 1), end = point('p1', 'r1', 2), format = { bold: true }) => ({ objectId: 'o', range: { start, end }, format });
const dispatch = (e, p = payload()) => e.dispatch('document.setRunRangeFormat', p);
function rejectsCommand(action) {
  let error; try { action(); } catch (caught) { error = caught; }
  expect(error).toBeDefined();
  expect(error?.message).not.toContain('Unknown command:');
}
const paragraphs = e => e.getSnapshot().document.slides[0].objects[0].text.paragraphs;
const styles = p => p.runs.map(r => [r.text, r.style]);

describe('range format boundaries', () => {
  it('splits at code points and isolates selected style from both untouched segments', () => {
    const e = engine(); dispatch(e);
    expect(styles(paragraphs(e)[0])).toEqual([['A', {}], ['😀', { b: '1' }], ['BC', {}], ['tail', {}]]);
    expect(paragraphs(e)[0].runs[0].id).toBe('r1'); e.dispose();
  });
  it('resolves offsets relative to the named run rather than the paragraph', () => {
    const e = engine(); dispatch(e, payload(point('p1', 'r2', 1), point('p1', 'r2', 3)));
    expect(styles(paragraphs(e)[0])).toEqual([['A😀BC', {}], ['t', {}], ['ai', { b: '1' }], ['l', {}]]); e.dispose();
  });
  it('formats cross-paragraph suffix, middle paragraphs and prefix atomically', () => {
    const e = engine(fixture([paragraph('p1', [run('r1', 'AB')]), paragraph('pm', [run('rm', 'MID')]), paragraph('p2', [run('r3', 'CD')])]));
    const before = e.getSnapshot().document;
    dispatch(e, payload(point('p1', 'r1', 1), point('p2', 'r3', 1), { italic: true, color: '#AABBCC' }));
    expect(paragraphs(e).map(styles)).toEqual([[['A', {}], ['B', { i: '1', color: '#aabbcc' }]], [['MID', { i: '1', color: '#aabbcc' }]], [['C', { i: '1', color: '#aabbcc' }], ['D', {}]]]);
    const after = e.getSnapshot().document; expect(e.getSnapshot().revision).toBe(1);
    e.undo(); expect(e.getSnapshot().document).toEqual(before); expect(e.getSnapshot().canUndo).toBe(false);
    e.redo(); expect(e.getSnapshot().document).toEqual(after); e.dispose();
  });
  it('reserves split identities across other objects and paragraph/run collections', () => {
    const d = fixture();
    d.slides[0].objects.push({ id: 'r1~1', type: 'text', geometry: { x: 0, y: 0, width: 1, height: 1 }, extensions: authored(), text: { paragraphs: [paragraph('r1~2', [run('r1~3', 'other')])] } });
    const e = engine(d); dispatch(e);
    const ids = paragraphs(e)[0].runs.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length); expect(ids.slice(1, 3)).not.toContain('r1~1'); expect(ids.slice(1, 3)).not.toContain('r1~2'); expect(ids.slice(1, 3)).not.toContain('r1~3');
    const e2 = engine(d); dispatch(e2); expect(e2.getSnapshot().document).toEqual(e.getSnapshot().document); e.dispose(); e2.dispose();
  });
  it('avoids split identities already used inside a table cell', () => {
    const d = fixture();
    d.slides[0].objects.push({ id: 'table', type: 'table', geometry: { x: 0, y: 0, width: 100, height: 100 }, extensions: authored(), table: {
      columns: [{ id: 'column', width: 100 }], rows: [{ id: 'row', cells: [{ id: 'cell', text: { paragraphs: [paragraph('tp', [run('r1~1', 'table text')])] } }] }]
    } });
    const e = engine(d); dispatch(e);
    expect(paragraphs(e)[0].runs.map(r => r.id)).not.toContain('r1~1');
    expect(validateDocument(e.getSnapshot().document)).toBe(true); e.dispose();
  });
  it('resets only the selected format and preserves unrelated selected styles', () => {
    const e = engine(fixture([paragraph('p1', [run('r1', 'ABCD', { b: '1', i: '1', sz: '1800', color: '#112233' })])]));
    dispatch(e, payload(point('p1', 'r1', 1), point('p1', 'r1', 3), { bold: null }));
    expect(styles(paragraphs(e)[0])).toEqual([
      ['A', { b: '1', i: '1', sz: '1800', color: '#112233' }],
      ['BC', { i: '1', sz: '1800', color: '#112233' }],
      ['D', { b: '1', i: '1', sz: '1800', color: '#112233' }],
    ]); e.dispose();
  });
  it.each([
    ['empty interior range', payload(point('p1', 'r1', 1), point('p1', 'r1', 1))],
    ['equivalent adjacent run boundaries', payload(point('p1', 'r1', 4), point('p1', 'r2', 0))],
    ['reset absent format', payload(point('p1', 'r1', 1), point('p1', 'r1', 2), { bold: null })],
  ])('does not change history or split runs for %s', (_, p) => {
    const e = engine(); const before = e.getSnapshot(); dispatch(e, p);
    expect(e.getSnapshot()).toEqual(before); e.dispose();
  });
  it('does not split a partial selection already carrying the requested style', () => {
    const e = engine(fixture([paragraph('p1', [run('r1', 'ABCD', { b: '1', sz: '1800' })])]));
    const before = e.getSnapshot(); dispatch(e); expect(e.getSnapshot()).toEqual(before); e.dispose();
  });
  it.each([
    ['missing run', payload(point('p1', 'missing', 0))],
    ['run in wrong paragraph', payload(point('p1', 'r3', 0))],
    ['offset exceeds named run', payload(point('p1', 'r1', 5), point('p1', 'r2', 2))],
    ['reversed runs', payload(point('p1', 'r2', 0), point('p1', 'r1', 1))],
    ['reversed paragraphs', payload(point('p2', 'r3', 0), point('p1', 'r1', 1))],
    ['reversed offsets', payload(point('p1', 'r1', 3), point('p1', 'r1', 1))],
    ['negative offset', payload(point('p1', 'r1', -1))],
    ['fractional offset', payload(point('p1', 'r1', 0.5))],
    ['unknown paragraph', payload(point('missing', 'r1', 0))],
    ['unknown object', { ...payload(), objectId: 'missing' }],
    ['empty format', { ...payload(), format: {} }],
    ['unknown format', { ...payload(), format: { underline: true } }],
    ['invalid boolean', { ...payload(), format: { bold: 'true' } }],
    ['invalid size precision', { ...payload(), format: { fontSize: 12.345 } }],
    ['invalid color', { ...payload(), format: { color: '#abc' } }],
    ['unknown range key', { ...payload(), range: { ...payload().range, extra: 1 } }],
  ])('rejects %s without mutation', (_, p) => {
    const e = engine(); const before = e.getSnapshot(); rejectsCommand(() => dispatch(e, p)); expect(e.getSnapshot()).toEqual(before); e.dispose();
  });
  it('rejects native text without splitting source nodes', () => {
    const d = fixture(); delete d.slides[0].objects[0].extensions.stagecraftAuthored;
    const e = engine(d); const before = e.getSnapshot(); rejectsCommand(() => dispatch(e)); expect(e.getSnapshot()).toEqual(before); e.dispose();
  });
});

describe('strict text style payloads', () => {
  it.each([{ type: 'char', char: 'ab' }, { type: 'char', char: '•', format: 'arabicPeriod' }, { type: 'number', format: 'arabicPeriod', char: '•' }])('rejects malformed bullet %j', bullet => {
    const e = engine(); const before = e.getSnapshot();
    rejectsCommand(() => e.dispatch('document.setParagraphFormat', { paragraphId: 'p1', format: { bullet } }));
    expect(e.getSnapshot()).toEqual(before); e.dispose();
  });
  it.each(['A\nB', 'A\tB'])('rejects control characters in font family', fontFamily => {
    const e = engine(); rejectsCommand(() => dispatch(e, { ...payload(), format: { fontFamily } })); expect(e.getSnapshot().revision).toBe(0); e.dispose();
  });
});
