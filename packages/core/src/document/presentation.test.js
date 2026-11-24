import { expect, it } from 'vitest';
import { createEditor } from '../editor/index.js';
import { createDocument, validateDocument, documentPlugin, presentationPlugin, validateAuthoredObject, validateAuthoredSlide, migrateLegacyDeck, toLegacyDeck } from './index.js';
const shape = (id = 'o') => ({ id, type: 'shape', geometry: { x: -1, y: 0, width: 10, height: 20 }, shape: 'rect', fill: '#123456', extensions: { stagecraftAuthored: true } });
const text = () => ({ id: 'text', type: 'text', geometry: shape().geometry, extensions: shape().extensions, text: { paragraphs: [{ id: 'p', runs: [{ id: 'r', text: 'Hi', editable: true, style: {}, extensions: shape().extensions }] }] } });
const table = (id = 'table') => ({ id, type: 'table', geometry: { x: 0, y: 0, width: 900, height: 400 }, extensions: { stagecraftAuthored: true },
  table: {
    columns: [{ id: `${id}-c1`, width: 450 }, { id: `${id}-c2`, width: 450 }],
    rows: [{ id: `${id}-r1`, cells: [{ id: `${id}-r1c1`, text: { paragraphs: [{ id: `${id}-r1c1p`, runs: [{ id: `${id}-r1c1r`, text: 'A', editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }] } }, { id: `${id}-r1c2`, text: { paragraphs: [{ id: `${id}-r1c2p`, runs: [{ id: `${id}-r1c2r`, text: 'B', editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }] } }] }]
  } });
const image = (id = 'image', assetId = 'asset-1') => ({ id, type: 'image', geometry: { x: 0, y: 0, width: 100, height: 100 }, extensions: { stagecraftAuthored: true }, image: { assetId } });
const richText = (p = 'r') => ({ paragraphs: [
  { id: `${p}p1`, runs: [{ id: `${p}r1`, text: 'One ', editable: true, style: { b: '1' }, extensions: { stagecraftAuthored: true } }, { id: `${p}r2`, text: 'two', editable: true, style: { sz: '1400' }, extensions: { stagecraftAuthored: true } }] },
  { id: `${p}p2`, runs: [{ id: `${p}r3`, text: 'Second paragraph', editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }
] });
const engine = (options = {}) => createEditor({ document: createDocument(), plugins: [documentPlugin, presentationPlugin], ...options });
it('authors, reorders and removes with final indices and reversible history', () => {
  const e = engine(); const initial = e.getSnapshot().document;
  e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.addSlide', { slideId: 's2', index: 0 });
  e.dispatch('presentation.moveSlide', { slideId: 's2', index: 1 });
  expect(e.getSnapshot().document.slides.map(s => s.id)).toEqual(['s', 's2']);
  for (const id of ['a', 'b']) e.dispatch('presentation.addObject', { slideId: 's', object: shape(id) });
  e.dispatch('presentation.moveObject', { slideId: 's', objectId: 'a', index: 1 });
  expect(e.getSnapshot().document.slides[0].objects.map(o => o.id)).toEqual(['b', 'a']);
  e.dispatch('presentation.setPaint', { slideId: 's', objectId: 'a', fill: '#aAbBcC' });
  e.dispatch('presentation.setGeometry', { slideId: 's', objectId: 'a', geometry: { x: 2, y: -5, width: 9, height: 7, rotation: 3.5 } });
  e.dispatch('presentation.removeObject', { slideId: 's', objectId: 'b' });
  e.dispatch('presentation.removeSlide', { slideId: 's' });
  e.dispatch('presentation.removeSlide', { slideId: 's2' });
  expect(e.getSnapshot().document.slides).toEqual([]);
  for (let i = 0; i < 11; i++) e.undo();
  expect(e.getSnapshot().document).toEqual(initial);
  e.redo(); expect(e.getSnapshot().document.slides).toHaveLength(1);
});
it('enforces strict authoring schemas and duplicate identities even without a host validator', () => {
  expect(validateAuthoredObject(shape())).toBe(true);
  expect(validateAuthoredObject(text())).toBe(true);
  expect(validateAuthoredSlide({ id: 's', objects: [shape()], extensions: shape().extensions })).toBe(true);
  for (const mutate of [o => o.source = {}, o => o.geometry.extra = 1, o => o.geometry.width = 0, o => o.geometry.x = 0.5, o => o.extensions.extra = true, o => o.fill = 'red', o => o.text = {}, o => o.shape = 'star']) {
    const o = shape(); mutate(o); expect(() => validateAuthoredObject(o)).toThrow();
  }
  for (const mutate of [o => o.text.paragraphs.push(o.text.paragraphs[0]), o => o.text.paragraphs[0].runs[0].style.b = true, o => o.text.paragraphs[0].runs[0].style.sz = '0', o => o.text.paragraphs[0].runs[0].editable = false]) {
    const o = text(); mutate(o); expect(() => validateAuthoredObject(o)).toThrow();
  }
  expect(() => validateAuthoredSlide({ id: 's', objects: [], extensions: shape().extensions, theme: 'bad' })).toThrow();
  // Slide-level properties are part of the authored slide schema (optional).
  expect(validateAuthoredSlide({ id: 's', objects: [shape()], extensions: shape().extensions, name: 'Named', notes: 'n', background: { type: 'solid', color: '#112233' } })).toBe(true);
  expect(() => validateAuthoredSlide({ id: 's', objects: [], extensions: shape().extensions, name: '  padded  ' })).toThrow();
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  for (const payload of [{ slideId: 's' }, { slideId: 'document' }, { slideId: 'x', index: 3 }, { slideId: 'x', extra: true }]) expect(() => e.dispatch('presentation.addSlide', payload)).toThrow();
  expect(() => e.dispatch('presentation.addObject', { slideId: 's', object: shape('s') })).toThrow();
  expect(e.getSnapshot().revision).toBe(1);
});
it('formats authored runs using portable b/i/sz and validates document', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' }); e.dispatch('presentation.addObject', { slideId: 's', object: text() });
  e.dispatch('document.setRunFormat', { runId: 'r', format: { bold: true, italic: false, fontSize: 12.5 } });
  const o = e.getSnapshot().document.slides[0].objects[0];
  expect(o.text.paragraphs[0].runs[0].style).toEqual({ b: '1', i: '0', sz: '1250' });
  expect(validateAuthoredObject(o)).toBe(true); expect(validateDocument(e.getSnapshot().document)).toBe(true);
});
it('gates native geometry, preserves opaque fields and rejects nested targets', () => {
  const native = { id: 'native', type: 'shape', geometry: { ...shape().geometry, unknown: 'keep' }, extensions: { editableGeometry: true } };
  const e = engine({ document: createDocument({ slides: [{ id: 's', objects: [native, { id: 'locked', type: 'group', children: [shape()] }] }] }) });
  const geometry = { x: 10, y: 20, width: 30, height: 40 };
  e.dispatch('presentation.setGeometry', { slideId: 's', objectId: 'native', geometry });
  expect(e.getSnapshot().document.slides[0].objects[0].geometry).toEqual({ ...geometry, unknown: 'keep' });
  for (const objectId of ['locked', 'o']) expect(() => e.dispatch('presentation.setGeometry', { slideId: 's', objectId, geometry })).toThrow();
  expect(() => e.dispatch('presentation.setPaint', { slideId: 's', objectId: 'native', fill: '#ffffff' })).toThrow();
});
it('uses kernel authorization and revision guards', () => {
  const e = engine({ authorize: () => false }); expect(() => e.dispatch('presentation.addSlide', { slideId: 's' })).toThrow(); expect(e.getSnapshot().revision).toBe(0);
  const other = engine(); expect(() => other.dispatch('presentation.addSlide', { slideId: 's' }, { expectedRevision: 1 })).toThrow();
});
it('supports rich multi-paragraph authored text and authored shape text', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.addObject', { slideId: 's', object: text() });
  e.dispatch('presentation.setText', { slideId: 's', objectId: 'text', text: richText() });
  const authored = e.getSnapshot().document.slides[0].objects[0];
  expect(authored.text.paragraphs).toHaveLength(2);
  expect(authored.text.paragraphs[0].runs).toHaveLength(2);
  expect(validateAuthoredObject(authored)).toBe(true);
  expect(validateDocument(e.getSnapshot().document)).toBe(true);
  // Shape text: an authored shape gains optional text.
  e.dispatch('presentation.addObject', { slideId: 's', object: shape('box') });
  e.dispatch('presentation.setText', { slideId: 's', objectId: 'box', text: richText('q') });
  const box = e.getSnapshot().document.slides[0].objects.find(o => o.id === 'box');
  expect(box.type).toBe('shape'); expect(box.shape).toBe('rect'); expect(box.text.paragraphs).toHaveLength(2);
  // Replacements are atomic: a duplicate run id inside the payload changes nothing.
  const before = e.getSnapshot();
  const duplicated = richText(); duplicated.paragraphs[1].runs[0].id = duplicated.paragraphs[0].runs[1].id;
  expect(() => e.dispatch('presentation.setText', { slideId: 's', objectId: 'text', text: duplicated })).toThrow();
  expect(e.getSnapshot()).toEqual(before);
  // Authored-only: a native object is refused.
  const native = engine({ document: createDocument({ slides: [{ id: 'n', objects: [{ id: 'n1', type: 'shape', geometry: { x: 0, y: 0, width: 10, height: 10 }, source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0] } }] }] }) });
  expect(() => native.dispatch('presentation.setText', { slideId: 'n', objectId: 'n1', text: richText('n') })).toThrowError(/UNSUPPORTED_EDIT/);
});
it('inserts authored tables and edits one cell at a time', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.addObject', { slideId: 's', object: table() });
  const inserted = e.getSnapshot().document.slides[0].objects[0];
  expect(inserted.type).toBe('table');
  expect(inserted.table.rows[0].cells).toHaveLength(2);
  e.dispatch('presentation.setTableCell', { slideId: 's', objectId: 'table', cellId: 'table-r1c2', text: richText() });
  const cell = e.getSnapshot().document.slides[0].objects[0].table.rows[0].cells[1];
  expect(cell.text.paragraphs).toHaveLength(2);
  expect(e.getSnapshot().document.slides[0].objects[0].table.rows[0].cells[0].text.paragraphs[0].runs[0].text).toBe('A');
  expect(() => e.dispatch('presentation.setTableCell', { slideId: 's', objectId: 'table', cellId: 'nope', text: richText() })).toThrowError(/UNKNOWN_CELL/);
  expect(() => e.dispatch('presentation.setTableCell', { slideId: 's', objectId: 'table', cellId: 'table-r1c1', text: { paragraphs: [] } })).toThrow();
  // Schema: ragged rows, empty column sets, unknown cell keys and zero widths are rejected.
  for (const mutate of [t => t.table.rows[0].cells.pop(), t => { t.table.columns = []; }, t => { t.table.rows[0].cells[0].extra = 1; }, t => { t.table.columns[0].width = 0; }]) {
    const candidate = table('t' + Math.random().toString(36).slice(2, 9)); mutate(candidate);
    expect(() => validateAuthoredObject(candidate)).toThrow();
  }
});
it('inserts an authored image atomically with its asset descriptor', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.addImage', { slideId: 's', object: image('img', 'asset-1'), asset: { id: 'asset-1', contentType: 'image/png' } });
  const document = e.getSnapshot().document;
  expect(document.slides[0].objects[0].image.assetId).toBe('asset-1');
  expect(document.assets).toEqual([{ id: 'asset-1', extensions: { stagecraftAuthored: true, contentType: 'image/png' } }]);
  expect(validateDocument(document)).toBe(true);
  // Mismatched, duplicate and unsupported content types fail atomically.
  const before = e.getSnapshot();
  expect(() => e.dispatch('presentation.addImage', { slideId: 's', object: image('img2', 'asset-2'), asset: { id: 'asset-3', contentType: 'image/png' } })).toThrow();
  expect(() => e.dispatch('presentation.addImage', { slideId: 's', object: image('img2', 'asset-1'), asset: { id: 'asset-1', contentType: 'image/png' } })).toThrow();
  expect(() => e.dispatch('presentation.addImage', { slideId: 's', object: image('img2', 'asset-2'), asset: { id: 'asset-2', contentType: 'image/gif' } })).toThrow();
  expect(e.getSnapshot()).toEqual(before);
});
it('sets slide name, solid background and notes, and clears them', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.setSlideProperties', { slideId: 's', properties: { name: '  Intro  ', background: { type: 'solid', color: '#AABBCC' }, notes: 'Speaker note' } });
  let slide = e.getSnapshot().document.slides[0];
  expect(slide.name).toBe('Intro');
  expect(slide.background).toEqual({ type: 'solid', color: '#aabbcc' });
  expect(slide.notes).toBe('Speaker note');
  expect(validateAuthoredSlide(slide)).toBe(true);
  e.dispatch('presentation.setSlideProperties', { slideId: 's', properties: { name: '', background: null, notes: null } });
  slide = e.getSnapshot().document.slides[0];
  expect(slide.name).toBeUndefined(); expect(slide.background).toBeUndefined(); expect(slide.notes).toBeUndefined();
  // Host input is normalized (trimmed), so padded input is accepted, not rejected.
  e.dispatch('presentation.setSlideProperties', { slideId: 's', properties: { name: '  Padded  ' } });
  expect(e.getSnapshot().document.slides[0].name).toBe('Padded');
  e.dispatch('presentation.setSlideProperties', { slideId: 's', properties: { name: '' } });
  const before = e.getSnapshot();
  for (const properties of [{}, { unknown: 1 }, { background: { type: 'gradient' } }, { notes: 'x'.repeat(20001) }, { background: { type: 'solid', color: 'red' } }, { name: 'x'.repeat(257) }, { notes: 'bad\u0000char' }])
    expect(() => e.dispatch('presentation.setSlideProperties', { slideId: 's', properties })).toThrow();
  expect(() => e.dispatch('presentation.setSlideProperties', { slideId: 'missing', properties: { name: 'x' } })).toThrowError(/UNKNOWN_SLIDE/);
  expect(e.getSnapshot()).toEqual(before);
});
it('supersedes opaque legacy notes/background on explicit set and clear', () => {
  const notes = 'Pasted \u0001 text';
  const { document } = migrateLegacyDeck({ slides: [{ id: 's', layout: 'blank', notes, bgColor: 'url(secret)', elements: [] }] });
  const e = engine({ document });
  const slideId = document.slides[0].id;
  e.dispatch('presentation.setSlideProperties', { slideId, properties: { notes: 'Replacement note', background: { type: 'solid', color: '#445566' } } });
  let slide = e.getSnapshot().document.slides[0];
  expect(slide.notes).toBe('Replacement note');
  expect(slide.background).toEqual({ type: 'solid', color: '#445566' });
  expect(slide.extensions.legacy).not.toHaveProperty('notes');
  expect(slide.extensions.legacy).not.toHaveProperty('bgColor');
  const beforeClear = e.getSnapshot();
  e.dispatch('presentation.setSlideProperties', { slideId, properties: { notes: null, background: null } });
  slide = e.getSnapshot().document.slides[0];
  expect(slide.notes).toBeUndefined();
  expect(slide.background).toBeUndefined();
  expect(slide.extensions.legacy).not.toHaveProperty('notes');
  expect(slide.extensions.legacy).not.toHaveProperty('bgColor');
  const projected = toLegacyDeck(e.getSnapshot().document).deck.slides[0];
  expect(projected).not.toHaveProperty('notes');
  expect(projected).not.toHaveProperty('bgColor');
  e.undo();
  expect(e.getSnapshot().document).toEqual(beforeClear.document);
  expect(e.getSnapshot().canRedo).toBe(true);
});
it('keeps imported native slide properties that exceed authoring limits', () => {
  // Preservation: the global schema must not narrow native values to authoring limits.
  const document = createDocument({ slides: [{ id: 's', objects: [], name: '  Native padded name  ' + 'x'.repeat(300), notes: 'x'.repeat(30000), background: { type: 'theme' } }] });
  expect(validateDocument(document)).toBe(true);
  expect(() => validateAuthoredSlide({ id: 's', objects: [], extensions: { stagecraftAuthored: true }, name: '  padded  ' })).toThrow();
});
it('paints native rect/ellipse only when the reader marked editableFill', () => {
  const document = createDocument({ slides: [{ id: 's', objects: [
    { id: 'native', type: 'shape', shape: 'rect', fill: '#112233', geometry: { x: 0, y: 0, width: 10, height: 10 }, extensions: { editableFill: true, editableGeometry: true } },
    { id: 'locked', type: 'shape', shape: 'rect', fill: '#112233', geometry: { x: 0, y: 0, width: 10, height: 10 }, extensions: { editableGeometry: true } },
    { id: 'star', type: 'shape', shape: 'star', fill: '#112233', geometry: { x: 0, y: 0, width: 10, height: 10 }, extensions: { editableFill: true } }
  ] }] });
  const e = engine({ document });
  e.dispatch('presentation.setPaint', { slideId: 's', objectId: 'native', fill: '#AABBCC' });
  expect(e.getSnapshot().document.slides[0].objects[0].fill).toBe('#AABBCC');
  for (const objectId of ['locked', 'star']) expect(() => e.dispatch('presentation.setPaint', { slideId: 's', objectId, fill: '#000000' })).toThrowError(/UNSUPPORTED_EDIT/);
});
it('rejects non-zero rotation on ODP-backed content before committing', () => {
  const document = createDocument({ slides: [{ id: 's', objects: [
    { id: 'native', type: 'shape', geometry: { x: 0, y: 0, width: 10, height: 10 }, extensions: { editableGeometry: true }, source: { format: 'odp', part: 'content.xml', path: [0] } },
    shape('authored')
  ] }] });
  const e = engine({ document });
  const before = e.getSnapshot();
  expect(() => e.dispatch('presentation.setGeometry', { slideId: 's', objectId: 'native', geometry: { x: 1, y: 1, width: 10, height: 10, rotation: 15 } })).toThrowError(/UNSUPPORTED_ROTATION/);
  expect(e.getSnapshot()).toEqual(before);
  // Zero rotation and plain translation stay allowed.
  e.dispatch('presentation.setGeometry', { slideId: 's', objectId: 'native', geometry: { x: 1, y: 1, width: 10, height: 10, rotation: 0 } });
  expect(e.getSnapshot().document.slides[0].objects[0].geometry).toEqual({ x: 1, y: 1, width: 10, height: 10, rotation: 0 });
  // The document format covers authored objects added to an ODP deck.
  const odpDocument = createDocument({ extensions: { sourceFormat: 'odp' }, slides: [{ id: 's', objects: [shape('a')] }] });
  const odp = engine({ document: odpDocument });
  expect(() => odp.dispatch('presentation.setGeometry', { slideId: 's', objectId: 'a', geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 30 } })).toThrowError(/UNSUPPORTED_ROTATION/);
});
it('rejects invalid values, unknown targets and forged payloads atomically', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.addObject', { slideId: 's', object: shape() });
  const before = e.getSnapshot();
  for (const [command, payload] of [
    ['addSlide', { slideId: '' }], ['addSlide', { slideId: 'new', index: -1 }],
    ['addObject', { slideId: 'absent', object: shape('new') }],
    ['removeSlide', { slideId: 'absent' }], ['removeObject', { slideId: 's', objectId: 'absent' }],
    ['moveSlide', { slideId: 's', index: 1 }], ['moveSlide', { slideId: 'absent', index: 0 }],
    ['moveObject', { slideId: 's', objectId: 'o', index: 1 }],
    ['setPaint', { slideId: 's', objectId: 'o', fill: 'red' }],
    ['setGeometry', { slideId: 's', objectId: 'o', geometry: { x: 0, y: 0, width: 1, height: 0 } }],
    ['setGeometry', { slideId: 's', objectId: 'o', geometry: { x: 0, y: 0, width: 1, height: 2, rotation: Infinity } }]
  ]) {
    expect(() => e.dispatch(`presentation.${command}`, payload)).toThrow();
    expect(e.getSnapshot()).toEqual(before);
  }
  for (const value of [null, [], { ...shape(), type: 'unknown' }, { ...shape(), id: '' }]) expect(() => validateAuthoredObject(value)).toThrow();
  const duplicate = text(); duplicate.text.paragraphs[0].id = duplicate.id;
  expect(() => validateAuthoredObject(duplicate)).toThrow();
  const missing = text(); delete missing.text.paragraphs[0].runs[0].extensions;
  expect(() => validateAuthoredObject(missing)).toThrow();
  const wrong = shape(); wrong.extensions.stagecraftAuthored = false;
  expect(() => validateAuthoredObject(wrong)).toThrow();
  const getter = shape(); Object.defineProperty(getter, 'source', { enumerable: true, get() { throw Error('must not run'); } });
  expect(() => validateAuthoredObject(getter)).toThrowError(expect.objectContaining({ code: 'INVALID_JSON' }));
});

const chartObject = (id = 'chart') => ({ id, type: 'chart', geometry: { x: 0, y: 0, width: 5000000, height: 3000000 }, extensions: { stagecraftAuthored: true },
  chart: { kind: 'bar', categories: ['Q1', 'Q2'], series: [{ name: 'Revenue', values: [10, 20] }] } });
it('authors a chart, replaces its data and rejects unsupported shapes', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.addObject', { slideId: 's', object: chartObject() });
  const inserted = e.getSnapshot().document.slides[0].objects[0];
  expect(inserted.type).toBe('chart');
  expect(inserted.chart.categories).toEqual(['Q1', 'Q2']);
  expect(validateAuthoredObject(inserted)).toBe(true);
  e.dispatch('presentation.setChart', { slideId: 's', objectId: 'chart', chart: { kind: 'pie', categories: ['A', 'B'], series: [{ name: 'Share', values: [1, 2] }] } });
  expect(e.getSnapshot().document.slides[0].objects[0].chart.kind).toBe('pie');
  expect(validateDocument(e.getSnapshot().document)).toBe(true);
  const before = e.getSnapshot();
  // Schema: unknown chart keys, value/category mismatch, pie with two series, negative pie values.
  for (const chart of [
    { kind: 'bar', categories: ['A'], series: [{ name: 'S', values: [1, 2] }] },
    { kind: 'bar', categories: ['A'], series: [{ name: 'S', values: [1], extra: 1 }] },
    { kind: 'bar', categories: ['A'], series: [] },
    { kind: 'pie', categories: ['A'], series: [{ name: 'S', values: [1] }, { name: 'T', values: [2] }] },
    { kind: 'pie', categories: ['A'], series: [{ name: 'S', values: [-1] }] },
    { kind: 'radar', categories: ['A'], series: [{ name: 'S', values: [1] }] },
    { kind: 'bar', categories: ['A'], series: [{ name: 'S', values: [Number.POSITIVE_INFINITY] }] }
  ]) expect(() => e.dispatch('presentation.setChart', { slideId: 's', objectId: 'chart', chart })).toThrow();
  expect(e.getSnapshot()).toEqual(before);
});
it('rejects nonzero chart rotation in authored validation and setGeometry', () => {
  const rotated = chartObject(); rotated.geometry.rotation = 15;
  expect(() => validateAuthoredObject(rotated)).toThrowError(/UNSUPPORTED_ROTATION/);
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  expect(() => e.dispatch('presentation.addObject', { slideId: 's', object: rotated })).toThrow();
  e.dispatch('presentation.addObject', { slideId: 's', object: chartObject() });
  expect(() => e.dispatch('presentation.setGeometry', { slideId: 's', objectId: 'chart', geometry: { x: 0, y: 0, width: 5000000, height: 3000000, rotation: 10 } })).toThrowError(/UNSUPPORTED_ROTATION/);
  expect(e.getSnapshot().document.slides[0].objects[0].geometry.rotation).toBeUndefined();
  // Translation and explicit zero rotation stay allowed.
  e.dispatch('presentation.setGeometry', { slideId: 's', objectId: 'chart', geometry: { x: 10, y: 10, width: 5000000, height: 3000000, rotation: 0 } });
  expect(e.getSnapshot().document.slides[0].objects[0].geometry.rotation).toBe(0);
});
it('keeps native charts read-only for data and geometry-rotation', () => {
  const nativeChart = { id: 'native-chart', type: 'chart', chart: { kind: 'line', categories: ['A'], series: [{ name: 'S', values: [1] }] },
    geometry: { x: 0, y: 0, width: 10, height: 10 }, extensions: { editableGeometry: true }, source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0] } };
  const e = engine({ document: createDocument({ slides: [{ id: 's', objects: [nativeChart] }] }) });
  expect(() => e.dispatch('presentation.setChart', { slideId: 's', objectId: 'native-chart', chart: { kind: 'bar', categories: ['A'], series: [{ name: 'S', values: [2] }] } })).toThrowError(/UNSUPPORTED_EDIT/);
  e.dispatch('presentation.setGeometry', { slideId: 's', objectId: 'native-chart', geometry: { x: 5, y: 5, width: 10, height: 10 } });
  expect(e.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(5);
  expect(() => e.dispatch('presentation.setGeometry', { slideId: 's', objectId: 'native-chart', geometry: { x: 5, y: 5, width: 10, height: 10, rotation: 45 } })).toThrowError(/UNSUPPORTED_ROTATION/);
});

const runOf = (e, runId) => { let found = null; const walk = o => { for (const p of o.text?.paragraphs ?? []) for (const r of p.runs) if (r.id === runId) found = r; for (const c of o.children ?? []) walk(c); }; e.getSnapshot().document.slides.forEach(s => s.objects.forEach(walk)); return found; };
const authoredTextObject = (id = 'rich') => ({ id, type: 'text', geometry: { x: 0, y: 0, width: 10, height: 10 }, extensions: { stagecraftAuthored: true },
  text: { paragraphs: [{ id: `${id}-p`, runs: [{ id: `${id}-r`, text: 'ABCDEF', editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }] } });

it('stores font family and colour on runs, normalises colour and resets with null', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.addObject', { slideId: 's', object: authoredTextObject() });
  e.dispatch('document.setRunFormat', { runId: 'rich-r', format: { fontFamily: 'Georgia', color: '#CC3300' } });
  expect(runOf(e, 'rich-r').style).toEqual({ typeface: 'Georgia', color: '#cc3300' });
  expect(validateAuthoredObject(e.getSnapshot().document.slides[0].objects[0])).toBe(true);
  e.dispatch('document.setRunFormat', { runId: 'rich-r', format: { fontFamily: null, color: null } });
  expect(runOf(e, 'rich-r').style).toEqual({});
  const before = e.getSnapshot();
  for (const format of [
    { fontFamily: '' }, { fontFamily: 'x'.repeat(65) }, { fontFamily: 'Arial\nB' }, { fontFamily: 'Arial\tB' },
    { fontFamily: 'Arial\u0000B' }, { fontFamily: 'Arial\uFFFF' }, { fontFamily: 'Ari\uD800al' },
    { color: 'red' }, { color: '#12345' }, { color: 12 }, { unknown: true }
  ]) expect(() => e.dispatch('document.setRunFormat', { runId: 'rich-r', format })).toThrow();
  expect(e.getSnapshot()).toEqual(before);
});

it('stores paragraph alignment, spacing, indents, level and bullets with contract units', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.addObject', { slideId: 's', object: authoredTextObject() });
  e.dispatch('document.setParagraphFormat', { paragraphId: 'rich-p', format: {
    alignment: 'center', spaceBefore: 12.5, spaceAfter: 1000, lineSpacing: 150, level: 8,
    indentStart: -10000000, indentEnd: 10000000, firstLineIndent: 12700, bullet: { type: 'char', char: '•' }
  } });
  const paragraph = e.getSnapshot().document.slides[0].objects[0].text.paragraphs[0];
  expect(paragraph.style).toEqual({ alignment: 'center', spaceBefore: 12.5, spaceAfter: 1000, lineSpacing: 150, level: 8, indentStart: -10000000, indentEnd: 10000000, firstLineIndent: 12700, bullet: { type: 'char', char: '•' } });
  expect(validateAuthoredObject(e.getSnapshot().document.slides[0].objects[0])).toBe(true);
  e.dispatch('document.setParagraphFormat', { paragraphId: 'rich-p', format: { alignment: null, bullet: { type: 'none' } } });
  expect(paragraph0(e).style.alignment).toBeUndefined();
  expect(paragraph0(e).style.bullet).toEqual({ type: 'none' });
  const before = e.getSnapshot();
  for (const format of [
    { alignment: 'start' }, { spaceBefore: -1 }, { spaceBefore: 1000.01 }, { spaceAfter: '4' },
    { lineSpacing: 49 }, { lineSpacing: 501 }, { lineSpacing: 120.5 }, { level: 9 }, { level: -1 },
    { indentStart: 10000001 }, { indentStart: 1.5 },
    { bullet: { type: 'char', char: 'ab' } }, { bullet: { type: 'char' } }, { bullet: { type: 'char', char: 'x', format: 'arabicPeriod' } },
    { bullet: { type: 'number', format: 'roman' } }, { bullet: { type: 'number', char: '•' } }, { bullet: {} }, { unknown: 1 }
  ]) expect(() => e.dispatch('document.setParagraphFormat', { paragraphId: 'rich-p', format })).toThrow();
  expect(e.getSnapshot()).toEqual(before);
  expect(() => e.dispatch('document.setParagraphFormat', { paragraphId: 'missing', format: { level: 1 } })).toThrowError(/UNKNOWN_PARAGRAPH/);
});

const paragraph0 = e => e.getSnapshot().document.slides[0].objects[0].text.paragraphs[0];

it('gates paragraph formatting by target: authored and PPTX yes, ODP rejected', () => {
  const native = (format, extra = {}) => createDocument({ slides: [{ id: 's', objects: [{ id: `${format}-obj`, type: 'text', geometry: { x: 0, y: 0, width: 10, height: 10 },
    source: { format, part: format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml', path: [0] },
    text: { paragraphs: [{ id: `${format}-p`, source: { format, part: format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml', path: [0, 0] }, style: extra.style ?? {}, runs: [{ id: `${format}-r`, text: 'x', editable: true, source: { format, part: 'p', path: [0, 0, 0] } }] }] } }] }] });
  const pptx = engine({ document: native('pptx', { style: { algn: 'ctr' } }) });
  pptx.dispatch('document.setParagraphFormat', { paragraphId: 'pptx-p', format: { alignment: 'right' } });
  expect(pptx.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].style).toEqual({ alignment: 'right' });
  const odp = engine({ document: native('odp') });
  expect(() => odp.dispatch('document.setParagraphFormat', { paragraphId: 'odp-p', format: { alignment: 'right' } })).toThrowError(/UNSUPPORTED_EDIT/);
});

it('sets text-body layout, rejects unsupported ODP keys and clears with null', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.addObject', { slideId: 's', object: authoredTextObject() });
  e.dispatch('document.setTextBodyLayout', { objectId: 'rich', layout: { autofit: 'resize', wrap: 'none', anchor: 'middle', insets: { left: 12700, bottom: 0 } } });
  expect(e.getSnapshot().document.slides[0].objects[0].bodyLayout).toEqual({ autofit: 'resize', wrap: 'none', anchor: 'middle', insets: { left: 12700, bottom: 0 } });
  expect(validateAuthoredObject(e.getSnapshot().document.slides[0].objects[0])).toBe(true);
  e.dispatch('document.setTextBodyLayout', { objectId: 'rich', layout: { insets: { left: null } } });
  expect(e.getSnapshot().document.slides[0].objects[0].bodyLayout.insets).toEqual({ bottom: 0 });
  e.dispatch('document.setTextBodyLayout', { objectId: 'rich', layout: { autofit: null } });
  expect(e.getSnapshot().document.slides[0].objects[0].bodyLayout.autofit).toBeUndefined();
  const before = e.getSnapshot();
  for (const layout of [{ autofit: 'fit' }, { wrap: 'tight' }, { anchor: 'baseline' }, { insets: { left: -1 } }, { insets: { middle: 1 } }, { unknown: 1 }])
    expect(() => e.dispatch('document.setTextBodyLayout', { objectId: 'rich', layout })).toThrow();
  expect(e.getSnapshot()).toEqual(before);
});

it('formats a run range relative to the named run and never leaks style into untouched segments', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.addObject', { slideId: 's', object: authoredTextObject() });
  e.dispatch('document.setRunRangeFormat', { objectId: 'rich', range: { start: { paragraphId: 'rich-p', runId: 'rich-r', offset: 1 }, end: { paragraphId: 'rich-p', runId: 'rich-r', offset: 4 } }, format: { color: '#cc3300' } });
  const runs = paragraph0(e).runs;
  expect(runs.map(run => run.text)).toEqual(['A', 'BCD', 'EF']);
  expect(runs[0].style).toEqual({});
  expect(runs[1].style).toEqual({ color: '#cc3300' });
  expect(runs[2].style).toEqual({});
  expect(new Set(runs.map(run => run.id)).size).toBe(3);
  expect(validateAuthoredObject(e.getSnapshot().document.slides[0].objects[0])).toBe(true);
  // Re-applying the same formatting is a true no-op: no split, no history entry.
  const revision = e.getSnapshot().revision;
  const middle = paragraph0(e).runs.find(run => run.text === 'BCD');
  e.dispatch('document.setRunRangeFormat', { objectId: 'rich', range: { start: { paragraphId: 'rich-p', runId: middle.id, offset: 0 }, end: { paragraphId: 'rich-p', runId: middle.id, offset: 3 } }, format: { color: '#cc3300' } });
  expect(e.getSnapshot().revision).toBe(revision);
  expect(paragraph0(e).runs.map(run => run.text)).toEqual(['A', 'BCD', 'EF']);
  // Empty range is a no-op too.
  e.dispatch('document.setRunRangeFormat', { objectId: 'rich', range: { start: { paragraphId: 'rich-p', runId: 'rich-r', offset: 1 }, end: { paragraphId: 'rich-p', runId: 'rich-r', offset: 1 } }, format: { bold: true } });
  expect(e.getSnapshot().revision).toBe(revision);
  // Undo restores the single original run exactly.
  e.undo();
  expect(paragraph0(e).runs).toHaveLength(1);
  expect(paragraph0(e).runs[0].text).toBe('ABCDEF');
  expect(paragraph0(e).runs[0].style).toEqual({});
});

it('splits at code points, spans paragraphs and reports range errors', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  const object = authoredTextObject();
  object.text.paragraphs.push({ id: 'rich-p2', runs: [{ id: 'rich-r2', text: 'XYZ', editable: true, style: {}, extensions: { stagecraftAuthored: true } }] });
  e.dispatch('presentation.addObject', { slideId: 's', object });
  // Surrogate pair: 'ABCDEF' -> insert an emoji-first run via setRunText, then split inside it.
  e.dispatch('document.setRunText', { runId: 'rich-r', text: 'A😀BC' });
  e.dispatch('document.setRunRangeFormat', { objectId: 'rich', range: { start: { paragraphId: 'rich-p', runId: 'rich-r', offset: 1 }, end: { paragraphId: 'rich-p2', runId: 'rich-r2', offset: 2 } }, format: { bold: true } });
  const [first, second] = e.getSnapshot().document.slides[0].objects[0].text.paragraphs;
  expect(first.runs.map(run => run.text).join('')).toBe('A😀BC');
  expect(second.runs.map(run => run.text).join('')).toBe('XYZ');
  expect(first.runs[0].text).toBe('A');
  expect(first.runs[0].style.b).toBeUndefined();
  expect(first.runs.at(-1).style.b).toBe('1');
  expect(second.runs.find(run => run.text === 'XY').style.b).toBe('1');
  expect(second.runs.find(run => run.text === 'Z').style.b).toBeUndefined();
  const before = e.getSnapshot();
  for (const range of [
    { start: { paragraphId: 'rich-p', runId: 'rich-r', offset: 99 }, end: { paragraphId: 'rich-p', runId: 'rich-r', offset: 99 } },
    { start: { paragraphId: 'rich-p2', runId: 'rich-r2', offset: 0 }, end: { paragraphId: 'rich-p', runId: 'rich-r', offset: 0 } },
    { start: { paragraphId: 'rich-p', runId: 'missing', offset: 0 }, end: { paragraphId: 'rich-p', runId: 'missing', offset: 0 } },
    { start: { paragraphId: 'nope', runId: 'rich-r', offset: 0 }, end: { paragraphId: 'nope', runId: 'rich-r', offset: 0 } }
  ]) expect(() => e.dispatch('document.setRunRangeFormat', { objectId: 'rich', range, format: { bold: true } })).toThrow();
  expect(e.getSnapshot()).toEqual(before);
  // Native objects are refused outright.
  const native = engine({ document: createDocument({ slides: [{ id: 's', objects: [{ id: 'nat', type: 'text', geometry: { x: 0, y: 0, width: 10, height: 10 }, source: { format: 'pptx', part: 'p', path: [0] }, text: { paragraphs: [{ id: 'np', runs: [{ id: 'nr', text: 'xy', editable: true, source: { format: 'pptx', part: 'p', path: [0, 0] } }] }] } }] }] }) });
  expect(() => native.dispatch('document.setRunRangeFormat', { objectId: 'nat', range: { start: { paragraphId: 'np', runId: 'nr', offset: 0 }, end: { paragraphId: 'np', runId: 'nr', offset: 1 } }, format: { bold: true } })).toThrowError(/UNSUPPORTED_EDIT/);
});

it('gates authored objects in an ODP deck exactly like native ones for text layout', () => {
  const odpDeck = createDocument({ extensions: { sourceFormat: 'odp' }, slides: [{ id: 's', objects: [] }] });
  const e = engine({ document: odpDeck });
  e.dispatch('presentation.addObject', { slideId: 's', object: authoredTextObject() });
  const rich = e.getSnapshot().document.slides[0].objects[0];
  expect(rich.source).toBeUndefined();
  const before = e.getSnapshot();
  // Only autofit none/resize is representable in ODP, for authored content too.
  for (const layout of [{ autofit: 'shrink' }, { wrap: 'none' }, { anchor: 'middle' }, { insets: { left: 12700 } }])
    expect(() => e.dispatch('document.setTextBodyLayout', { objectId: rich.id, layout })).toThrowError(/UNSUPPORTED_EDIT/);
  expect(e.getSnapshot()).toEqual(before);
  e.dispatch('document.setTextBodyLayout', { objectId: rich.id, layout: { autofit: 'resize' } });
  expect(e.getSnapshot().document.slides[0].objects[0].bodyLayout).toEqual({ autofit: 'resize' });
  e.dispatch('document.setTextBodyLayout', { objectId: rich.id, layout: { autofit: 'none' } });
  expect(e.getSnapshot().document.slides[0].objects[0].bodyLayout).toEqual({ autofit: 'none' });
  // A PPTX-sourced document keeps the full layout surface.
  const pptxDeck = createDocument({ extensions: { sourceFormat: 'pptx' }, slides: [{ id: 's', objects: [] }] });
  const p = engine({ document: pptxDeck });
  p.dispatch('presentation.addObject', { slideId: 's', object: authoredTextObject() });
  p.dispatch('document.setTextBodyLayout', { objectId: 'rich', layout: { autofit: 'shrink', wrap: 'none', anchor: 'middle', insets: { left: 12700 } } });
  expect(p.getSnapshot().document.slides[0].objects[0].bodyLayout).toEqual({ autofit: 'shrink', wrap: 'none', anchor: 'middle', insets: { left: 12700 } });
});

it('formats authored table-cell paragraphs and refuses native ones', () => {
  const e = engine(); e.dispatch('presentation.addSlide', { slideId: 's' });
  e.dispatch('presentation.addObject', { slideId: 's', object: table('tbl') });
  expect(() => e.dispatch('document.setParagraphFormat', { paragraphId: 'tbl-r1c1p', format: { alignment: 'center' } })).not.toThrow();
  const cellParagraph = e.getSnapshot().document.slides[0].objects[0].table.rows[0].cells[0].text.paragraphs[0];
  expect(cellParagraph.style).toEqual({ alignment: 'center' });
  expect(validateAuthoredObject(e.getSnapshot().document.slides[0].objects[0])).toBe(true);
  // A native table's cell paragraphs are not representable by the source writer yet.
  const nativeTable = { id: 'nt', type: 'table', geometry: { x: 0, y: 0, width: 10, height: 10 }, source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0] },
    table: { columns: [{ id: 'nc', width: 10 }], rows: [{ id: 'nr', cells: [{ id: 'ncell', text: { paragraphs: [{ id: 'ncp', runs: [{ id: 'ncr', text: 'x', editable: false, style: {} }] }] } }] }] } };
  const n = engine({ document: createDocument({ slides: [{ id: 's', objects: [nativeTable] }] }) });
  expect(() => n.dispatch('document.setParagraphFormat', { paragraphId: 'ncp', format: { alignment: 'center' } })).toThrowError(/UNSUPPORTED_EDIT/);
});
