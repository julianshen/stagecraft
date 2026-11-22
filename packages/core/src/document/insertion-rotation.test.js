import { createEditor } from '../editor/index.js';
import { documentPlugin, presentationPlugin, validateDocument } from './index.js';
import { writePptx } from '@stagecraft/pptx';
import { writeOdp } from '@stagecraft/odp';
import { openPresentation } from '@stagecraft/source';

const text = (style = {}) => ({ paragraphs: [{ id: 'p', style, runs: [{ id: 'r', text: 'Text', editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }] });
const object = (type, rotation = 0) => ({ id: 'o', type, geometry: { x: 0, y: 0, width: 914400, height: 914400, rotation }, extensions: { stagecraftAuthored: true },
  ...(type === 'text' ? { text: text() } : type === 'shape' ? { shape: 'rect', fill: '#abcdef' } : type === 'image' ? { image: { assetId: 'asset' } } : { table: { columns: [{ id: 'col', width: 914400 }], rows: [{ id: 'row', cells: [{ id: 'cell', text: text() }] }] } }),
});
async function setup(format) {
  const session = await openPresentation(await (format === 'odp' ? writeOdp : writePptx)({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] }), { format });
  const editor = createEditor({ document: session.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  return { session, editor, slideId: session.document.slides[0].id, dispose() { editor.dispose(); session.dispose(); } };
}
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWMkAAAAASUVORK5CYII='), c => c.charCodeAt(0));

it.each(['text', 'shape', 'table', 'image'])('rejects rotated ODP %s insertion atomically and exports zero rotation', async type => {
  const f = await setup('odp');
  try {
    const o = object(type, 15), before = f.editor.getSnapshot();
    if (type !== 'image') expect(() => f.editor.dispatch('presentation.addObject', { slideId: f.slideId, object: o })).toThrow('UNSUPPORTED_ROTATION');
    expect(f.editor.getSnapshot()).toBe(before);
    let asset;
    if (type === 'image') {
      const registered = f.session.registerImage({ bytes: PNG, contentType: 'image/png' });
      o.image.assetId = registered.assetId;
      asset = { id: registered.assetId, contentType: registered.contentType };
      expect(() => f.editor.dispatch('presentation.addImage', { slideId: f.slideId, object: o, asset })).toThrow('UNSUPPORTED_ROTATION');
      expect(f.editor.getSnapshot()).toBe(before);
      expect(f.editor.getSnapshot().document.assets).toEqual([]);
    }
    o.geometry.rotation = 0;
    f.editor.dispatch(asset ? 'presentation.addImage' : 'presentation.addObject', { slideId: f.slideId, object: o, ...(asset ? { asset } : {}) });
    await expect(f.session.export(f.editor.getSnapshot().document)).resolves.toHaveProperty('bytes');
    f.editor.undo();
    expect(f.editor.getSnapshot().document).toEqual(before.document);
    expect(f.editor.getSnapshot().canUndo).toBe(false);
  } finally { f.dispose(); }
});

it('rejects rotated ODP addObject images with an existing asset', async () => {
  const f = await setup('odp');
  const d = structuredClone(f.session.document);
  d.assets.push({ id: 'asset', extensions: { stagecraftAuthored: true, contentType: 'image/png' } });
  const editor = createEditor({ document: d, validateDocument, plugins: [presentationPlugin] });
  try {
    const before = editor.getSnapshot();
    expect(() => editor.dispatch('presentation.addObject', { slideId: f.slideId, object: object('image', 15) })).toThrow('UNSUPPORTED_ROTATION');
    expect(editor.getSnapshot()).toBe(before);
  } finally { editor.dispose(); f.dispose(); }
});

it.each(['text', 'shape', 'table', 'image'])('exports rotated PPTX %s insertion', async type => {
  const f = await setup('pptx');
  try {
    const o = object(type, 15);
    let asset;
    if (type === 'image') {
      const registered = f.session.registerImage({ bytes: PNG });
      o.image.assetId = registered.assetId;
      asset = { id: registered.assetId, contentType: registered.contentType };
    }
    f.editor.dispatch(asset ? 'presentation.addImage' : 'presentation.addObject', { slideId: f.slideId, object: o, ...(asset ? { asset } : {}) });
    await expect(f.session.export(f.editor.getSnapshot().document)).resolves.toHaveProperty('bytes');
  } finally { f.dispose(); }
});

it.each([{ wrap: 'none' }, { anchor: 'middle' }, { insets: { left: 1 } }, { autofit: 'shrink' }])('rejects unsupported ODP insertion body layout %j atomically', async bodyLayout => {
  const f = await setup('odp');
  try {
    const before = f.editor.getSnapshot();
    expect(() => f.editor.dispatch('presentation.addObject', { slideId: f.slideId, object: { ...object('text'), bodyLayout } })).toThrow('UNSUPPORTED_EDIT');
    expect(f.editor.getSnapshot()).toBe(before);
  } finally { f.dispose(); }
});

it.each(['text', 'shape', 'table'])('rejects non-list ODP %s levels at insertion and replacement', async type => {
  const f = await setup('odp');
  try {
    const o = object(type);
    if (type === 'shape') o.text = text();
    const paragraph = type === 'table' ? o.table.rows[0].cells[0].text.paragraphs[0] : o.text.paragraphs[0];
    paragraph.style = { level: 1 };
    const before = f.editor.getSnapshot();
    expect(() => f.editor.dispatch('presentation.addObject', { slideId: f.slideId, object: o })).toThrow('UNSUPPORTED_EDIT');
    expect(f.editor.getSnapshot()).toBe(before);
    paragraph.style = { level: 1, bullet: { type: 'char', char: '•' } };
    f.editor.dispatch('presentation.addObject', { slideId: f.slideId, object: o });
    const added = f.editor.getSnapshot();
    for (const bullet of [undefined, { type: 'none' }]) {
      const replacement = text({ level: 1, ...(bullet ? { bullet } : {}) });
      expect(() => f.editor.dispatch(type === 'table' ? 'presentation.setTableCell' : 'presentation.setText', { slideId: f.slideId, objectId: o.id, text: replacement, ...(type === 'table' ? { cellId: 'cell' } : {}) })).toThrow('UNSUPPORTED_EDIT');
      expect(f.editor.getSnapshot()).toBe(added);
    }
    await expect(f.session.export(added.document)).resolves.toHaveProperty('bytes');
  } finally { f.dispose(); }
});

it.each([
  ['odp', { autofit: 'none' }], ['odp', { autofit: 'resize' }],
  ['pptx', { autofit: 'shrink', wrap: 'none', anchor: 'middle', insets: { left: 1 } }],
])('exports supported %s inserted body layout %j', async (format, bodyLayout) => {
  const f = await setup(format);
  try {
    const o = { ...object('text'), bodyLayout };
    delete o.geometry.rotation;
    f.editor.dispatch('presentation.addObject', { slideId: f.slideId, object: o });
    await expect(f.session.export(f.editor.getSnapshot().document)).resolves.toHaveProperty('bytes');
  } finally { f.dispose(); }
});

it.each(['text', 'shape', 'table'])('keeps non-list levels supported in PPTX %s insertion and replacement', async type => {
  const f = await setup('pptx');
  try {
    const o = object(type);
    if (type === 'table') o.table.rows[0].cells[0].text = text({ level: 1 });
    else o.text = text({ level: 1 });
    f.editor.dispatch('presentation.addObject', { slideId: f.slideId, object: o });
    f.editor.dispatch(type === 'table' ? 'presentation.setTableCell' : 'presentation.setText', { slideId: f.slideId, objectId: o.id, text: text({ level: 2, bullet: { type: 'none' } }), ...(type === 'table' ? { cellId: 'cell' } : {}) });
    await expect(f.session.export(f.editor.getSnapshot().document)).resolves.toHaveProperty('bytes');
  } finally { f.dispose(); }
});
