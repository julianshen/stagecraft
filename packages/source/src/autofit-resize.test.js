import { beforeAll, expect, it } from 'vitest';
import JSZip from 'jszip';
import { writeOdp } from '../../odp/src/index.js';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin } from '@stagecraft/core/document';
import { writePptx } from '../../pptx/src/index.js';
import { openPresentation } from './index.js';

const part = 'ppt/slides/slide1.xml';
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
let seed, native;
const box = (anchor = 'top') => ({
  id: 'resize-box', type: 'text', geometry: { x: 12700, y: 12700, width: 2540000, height: 952500, rotation: 0 },
  extensions: { stagecraftAuthored: true }, bodyLayout: { autofit: 'resize', anchor, wrap: 'square' },
  text: { paragraphs: [{ id: 'p', runs: [{ id: 'r', text: 'Resize text', editable: true, style: { sz: '1800', typeface: 'Arial' }, extensions: { stagecraftAuthored: true } }] }] },
});
beforeAll(async () => {
  seed = await writePptx({ title: 'Resize tests', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const source = await openPresentation(seed, { format: 'pptx' });
  const doc = structuredClone(source.document); doc.slides[0].objects.push(box());
  native = (await source.export(doc)).bytes; source.dispose();
}, 30000);
async function fixture(authored = false) {
  const source = await openPresentation(authored ? seed : native, { format: 'pptx' });
  const doc = structuredClone(source.document);
  if (authored) doc.slides[0].objects.push(box());
  return { source, doc, object: doc.slides[0].objects[0] };
}
async function slide(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  return new DOMParser().parseFromString(await zip.file(part).async('string'), 'application/xml');
}
it.each(['top', 'middle', 'bottom'])('grows %s anchored native geometry including negative y without mutating the snapshot', async anchor => {
  const { source, doc, object } = await fixture();
  object.bodyLayout.anchor = anchor;
  object.text.paragraphs[0].runs[0].text = 'Edited resize text';
  const before = structuredClone(doc), height = object.geometry.height + 100001;
  const resize = new Map([[object.id, { height }]]);
  const result = await source.export(doc, { resize });
  expect(doc).toEqual(before); expect(resize.get(object.id)).toEqual({ height });
  const reopened = await openPresentation(result.bytes, { format: 'pptx' });
  const grown = reopened.document.slides[0].objects[0];
  expect(grown.geometry).toEqual({ ...object.geometry, height, y: Math.round(object.geometry.y - (anchor === 'top' ? 0 : anchor === 'middle' ? 100001 / 2 : 100001)) });
  expect(grown.text.paragraphs[0].runs[0].text).toBe('Edited resize text');
  expect(grown.bodyLayout.autofit).toBe('resize');
  expect((await slide(result.bytes)).getElementsByTagNameNS(a, 'spAutoFit')).toHaveLength(1);
  expect((await slide(result.bytes)).getElementsByTagNameNS(a, 'normAutofit')).toHaveLength(0);
  if (anchor !== 'top') expect(grown.geometry.y).toBeLessThan(0);
  reopened.dispose(); source.dispose();
}, 30000);
it('applies resize alone to a native box and preserves every other ZIP part and text formatting', async () => {
  const { source, doc, object } = await fixture();
  const result = await source.export(doc, { resize: { [object.id]: { height: 1905000 } } });
  expect(result.dirtyParts).toEqual([part]);
  const before = await JSZip.loadAsync(native), after = await JSZip.loadAsync(result.bytes);
  for (const name of Object.keys(before.files)) if (name !== part) expect(await after.file(name)?.async('uint8array')).toEqual(await before.file(name)?.async('uint8array'));
  const oldXml = await slide(native), newXml = await slide(result.bytes);
  expect(newXml.getElementsByTagNameNS(a, 'rPr')[0].outerHTML).toBe(oldXml.getElementsByTagNameNS(a, 'rPr')[0].outerHTML);
  expect(newXml.getElementsByTagNameNS(a, 'bodyPr')[0].outerHTML).toBe(oldXml.getElementsByTagNameNS(a, 'bodyPr')[0].outerHTML);
  expect(newXml.getElementsByTagNameNS(a, 'ext')[1].getAttribute('cy')).toBe('1905000');
  source.dispose();
}, 30000);
it('writes an authored box with resized height and merges snapshot geometry changes', async () => {
  const { source, doc, object } = await fixture(true);
  object.geometry.x = 33333; object.geometry.width = 2000000;
  const result = await source.export(doc, { resize: new Map([[object.id, { height: 1905000 }]]) });
  const reopened = await openPresentation(result.bytes, { format: 'pptx' });
  expect(reopened.document.slides[0].objects[0].geometry).toEqual({ ...object.geometry, height: 1905000 });
  expect(object.geometry.height).toBe(952500);
  source.dispose(); reopened.dispose();
}, 30000);
it('keeps missing, empty and same-height options byte-identical', async () => {
  const { source, doc, object } = await fixture();
  for (const options of [{}, { resize: new Map() }, { resize: {} }, { resize: { [object.id]: { height: object.geometry.height } } }]) {
    const result = await source.export(doc, options);
    expect(result.bytes).toEqual(native); expect(result.dirtyParts).toEqual([]);
  }
  source.dispose();
}, 30000);
it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, 952499])('rejects invalid or shrinking height %s', async height => {
  const { source, doc, object } = await fixture();
  await expect(source.export(doc, { resize: { [object.id]: { height } } })).rejects.toThrow('Invalid resize measurement');
  source.dispose();
});
it.each([null, [], 1, 'x', { height: 1905000, x: 1 }, { height: 1905000, [Symbol('extra')]: 1 }])('rejects malformed resize entries %j', async value => {
  const { source, doc, object } = await fixture();
  await expect(source.export(doc, { resize: new Map([[object.id, value]]) })).rejects.toThrow('Invalid resize measurement'); source.dispose();
});
it.each([null, [], 1, 'x', new Date()])('rejects malformed resize map %j', async resize => {
  const { source, doc } = await fixture();
  await expect(source.export(doc, { resize })).rejects.toThrow('Invalid resize measurement'); source.dispose();
});
it('rejects unknown targets and non-resize boxes', async () => {
  const { source, doc, object } = await fixture();
  await expect(source.export(doc, { resize: { unknown: { height: 1905000 } } })).rejects.toThrow('Invalid resize measurement');
  object.bodyLayout.autofit = 'shrink';
  await expect(source.export(doc, { resize: { [object.id]: { height: 1905000 } } })).rejects.toThrow('Invalid resize measurement'); source.dispose();
});
it.each(['rotation', 'wrap', 'shape', 'group'])('rejects unsupported authored %s', async kind => {
  const { source, doc, object } = await fixture(true);
  if (kind === 'rotation') object.geometry.rotation = 30;
  if (kind === 'wrap') object.bodyLayout.wrap = 'none';
  if (kind === 'shape') { object.type = 'shape'; object.shape = 'ellipse'; object.fill = '#ffffff'; }
  if (kind === 'group') doc.slides[0].objects = [{ id: 'group', type: 'group', children: [object] }];
  await expect(source.export(doc, { resize: { [object.id]: { height: 1905000 } } })).rejects.toThrow('Invalid resize measurement'); source.dispose();
});
it('snapshots a changing height getter once before the first await', async () => {
  const { source, doc, object } = await fixture(); let reads = 0;
  const value = { get height() { reads++; return reads === 1 ? 1905000 : -1; } };
  const promise = source.export(doc, { resize: new Map([[object.id, value]]) });
  expect(reads).toBe(1); object.geometry.height = 999999;
  const xml = await slide((await promise).bytes);
  expect(reads).toBe(1); expect(xml.getElementsByTagNameNS(a, 'ext')[1].getAttribute('cy')).toBe('1905000'); source.dispose();
});
it.each(['flip', 'vertical', 'ellipse', 'custom', 'adjusted', 'placeholder', 'no-transform', 'distributed-anchor'])('rejects retained unsupported %s even if public eligibility is forged', async kind => {
  const zip = await JSZip.loadAsync(native), xml = await slide(native);
  const shape = xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sp')[0];
  const xfrm = shape.getElementsByTagNameNS(a, 'xfrm')[0], body = shape.getElementsByTagNameNS(a, 'bodyPr')[0];
  const geom = shape.getElementsByTagNameNS(a, 'prstGeom')[0];
  if (kind === 'flip') xfrm.setAttribute('flipH', '1');
  if (kind === 'vertical') body.setAttribute('vert', 'vert');
  if (kind === 'ellipse') geom.setAttribute('prst', 'ellipse');
  if (kind === 'custom') geom.replaceWith(xml.createElementNS(a, 'a:custGeom'));
  if (kind === 'adjusted') geom.firstChild.appendChild(xml.createElementNS(a, 'a:gd'));
  if (kind === 'placeholder') shape.getElementsByTagNameNS(shape.namespaceURI, 'nvPr')[0].appendChild(xml.createElementNS(shape.namespaceURI, 'p:ph'));
  if (kind === 'no-transform') xfrm.remove();
  if (kind === 'distributed-anchor') body.setAttribute('anchor', 'dist');
  zip.file(part, new XMLSerializer().serializeToString(xml));
  const source = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
  const doc = structuredClone(source.document), object = doc.slides[0].objects[0];
  object.extensions.editableGeometry = true; object.extensions.pptxTextMetrics = { supported: true };
  object.geometry ??= box().geometry;
  await expect(source.export(doc, { resize: { [object.id]: { height: 1905000 } } })).rejects.toThrow('Invalid resize measurement'); source.dispose();
}, 30000);
it('rejects non-PPTX hints, but empty maps remain no-op', async () => {
  const bytes = await writeOdp({ title: 'ODP', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const source = await openPresentation(bytes, { format: 'odp' });
  expect((await source.export(source.document, { resize: {} })).bytes).toEqual(bytes);
  await expect(source.export(source.document, { resize: { anything: { height: 1905000 } } })).rejects.toThrow('Invalid resize measurement'); source.dispose();
}, 30000);
it('does not bypass signed-package restrictions with a measurement-only change', async () => {
  const zip = await JSZip.loadAsync(native); zip.file('_xmlsignatures/sig.xml', '<signature/>');
  const bytes = await zip.generateAsync({ type: 'uint8array' }), source = await openPresentation(bytes, { format: 'pptx' });
  const object = source.document.slides[0].objects[0];
  expect(source.capabilities.readOnly).toBe(true);
  await expect(source.export(source.document, { resize: { [object.id]: { height: 1905000 } } })).rejects.toThrow('Cannot edit signed source package');
  expect((await source.export(source.document)).bytes).toEqual(bytes); source.dispose();
}, 30000);
it('does not create an editor revision or undo entry', async () => {
  const { source } = await fixture();
  const editor = createEditor({ document: source.document, plugins: [documentPlugin, presentationPlugin] });
  const before = editor.getSnapshot(), object = before.document.slides[0].objects[0];
  await source.export(before.document, { resize: { [object.id]: { height: 1905000 } } });
  expect(editor.getSnapshot()).toBe(before); expect(editor.getSnapshot().canUndo).toBe(false);
  editor.dispose(); source.dispose();
});
it('preserves rotation zero and merges a native width/position edit', async () => {
  const { source, doc, object } = await fixture();
  object.geometry.x += 500; object.geometry.width += 100;
  const result = await source.export(doc, { resize: { [object.id]: { height: 1905000 } } });
  const reopened = await openPresentation(result.bytes, { format: 'pptx' });
  expect(reopened.document.slides[0].objects[0].geometry).toEqual({ ...object.geometry, height: 1905000 });
  source.dispose(); reopened.dispose();
});
it('rejects a resulting unsafe negative coordinate before any writing', async () => {
  const { source, doc, object } = await fixture();
  object.geometry.y = -Number.MAX_SAFE_INTEGER; object.bodyLayout.anchor = 'bottom';
  await expect(source.export(doc, { resize: { [object.id]: { height: 1905000 } } })).rejects.toThrow('Invalid resize measurement'); source.dispose();
});
it('rounds middle-anchor half-EMU growth correctly near the safe coordinate limit', async () => {
  const { source, doc, object } = await fixture(true);
  object.geometry.y = Number.MAX_SAFE_INTEGER;
  object.geometry.height = 1; object.bodyLayout.anchor = 'middle';
  const result = await source.export(doc, { resize: { [object.id]: { height: 2 } } });
  const reopened = await openPresentation(result.bytes, { format: 'pptx' });
  expect(reopened.document.slides[0].objects[0].geometry.y).toBe(Number.MAX_SAFE_INTEGER);
  source.dispose(); reopened.dispose();
});
