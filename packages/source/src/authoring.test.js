import { it, expect, describe } from 'vitest';
import JSZip from 'jszip';
import { writePptx } from '../../pptx/src/index.js';
import { writeOdp } from '../../odp/src/index.js';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { openPresentation } from './index.js';
import { authoringDiff, withoutDisplayProof } from './authoring.js';
const object = (id, type = 'text') => ({ id, type, geometry: { x: 12700, y: 25400, width: 1270000, height: 254000 }, extensions: { stagecraftAuthored: true }, ...(type === 'text' ? { text: { paragraphs: [{ id: id+'p', runs: [{ id: id+'r', text: 'Hello world', editable: true, style: { b: '1', i: '0', sz: '2400' }, extensions: { stagecraftAuthored: true } }] }] } } : { shape: 'ellipse', fill: '#123456' }) });
const applyAuthoringDiff = (baseline, snapshot) => {
  let delta;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const diff = (a, b) => {
    if (equal(a, b)) return false;
    if (delta.hook(a, b)) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let index = 0; index < Math.max(a.length, b.length); index++) diff(a[index], b[index]);
      return true;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[key], b[key]);
      return true;
    }
    throw new Error('Unsupported direct authoring change');
  };
  delta = authoringDiff(baseline, snapshot, diff);
  diff(baseline, snapshot);
  return delta;
};
describe.each(['pptx','odp'])('%s native authoring', format => {
  it('adds native slides/objects, reorders/removes and edits original geometry and text together', async () => {
    const bytes = await (format === 'pptx' ? writePptx : writeOdp)({ title:'Deck', sections:[{id:'section',name:'Section',slides:['a']}], slides:[{id:'a',layout:'blank',elements:[{id:'t',type:'text',x:10,y:10,w:100,h:100,content:'Original'}]}] });
    const session = await openPresentation(bytes,{format});
    const next = structuredClone(session.document), slide = next.slides[0];
    const native = slide.objects.find(o => o.text);
    expect(native.extensions.editableGeometry).toBe(true);
    native.geometry.x = 127000;
    native.text.paragraphs[0].runs[0].text = 'Changed';
    slide.objects.unshift(object('new-text'),object('new-shape','shape'));
    next.slides.unshift({id:'new-slide',objects:[object('second')],extensions:{stagecraftAuthored:true}});
    const result = await session.export(next);
    const reopened = await openPresentation(result.bytes,{format});
    expect(reopened.document.slides).toHaveLength(2);
    expect(JSON.stringify(reopened.document)).toContain('Changed');
    expect(JSON.stringify(reopened.document)).toContain('Hello');
    expect(reopened.document.slides[1].objects.find(o => o.text?.paragraphs.some(p => p.runs.some(r=>r.text==='Changed'))).geometry.x).toBe(127000);
    const remove = structuredClone(session.document); remove.slides[0].objects = [];
    const removed = await openPresentation((await session.export(remove)).bytes,{format});
    expect(removed.document.slides[0].objects).toHaveLength(0);
    expect((await session.export(session.document)).bytes).toEqual(bytes);
    const zip = await JSZip.loadAsync(result.bytes); expect(zip.file(format==='pptx'?'ppt/presentation.xml':'content.xml')).toBeTruthy();
  });
});

it('strips only display-proof extensions and preserves unrelated metadata', () => {
  const value = {
    extensions: {
      stagecraftNativeAppearance: { input: 'x' },
      stagecraftSlideAppearance: { input: 'x' },
      stagecraftLayoutSummary: { input: 'x' },
      pptxDefaultTextStyle: { fontSizePt: 18 },
      pptxOtherTextStyle: { color: '#000000' },
      pptxEndRunAppearance: { color: '#000000' },
      pptxAppearance: { resolved: { color: '#000000' }, keep: true },
      keep: { nested: true },
    },
  };
  expect(withoutDisplayProof(value)).toEqual({ extensions: { pptxAppearance: { keep: true }, keep: { nested: true } } });
  expect(withoutDisplayProof({ extensions: { stagecraftNativeAppearance: {} } })).toEqual({});
  expect(withoutDisplayProof({ extensions: { pptxAppearance: { resolved: {} } } })).toEqual({});
  expect(withoutDisplayProof(null)).toBeNull();
  expect(withoutDisplayProof([])).toEqual([]);
});

it.each([
  ['invalid paragraph alignment', n => { n.slides[0].objects[0].text.paragraphs[0].style.alignment = 'sideways'; }],
  ['invalid paragraph spacing', n => { n.slides[0].objects[0].text.paragraphs[0].style.spaceBefore = -1; }],
  ['invalid text inset', n => { n.slides[0].objects[0].bodyLayout.insets ??= {}; n.slides[0].objects[0].bodyLayout.insets.left = -1; }],
  ['unknown text inset', n => { n.slides[0].objects[0].bodyLayout.insets ??= {}; n.slides[0].objects[0].bodyLayout.insets.middle = 1; }],
  ['invalid slide name', n => { n.slides[0].name = 42; }],
  ['oversized slide name', n => { n.slides[0].name = 'x'.repeat(257); }],
  ['invalid slide notes', n => { n.slides[0].notes = {}; }],
  ['oversized slide notes', n => { n.slides[0].notes = 'x'.repeat(20001); }],
  ['invalid slide background', n => { n.slides[0].background = { type: 'gradient' }; }],
  ['unsupported slide property', n => { n.slides[0].unexpected = true; }],
  ['invalid editable fill', n => { n.slides[0].objects[1].fill = 'red'; }],
  ['changed paragraph count', n => { n.slides[0].objects[0].text.paragraphs.push(structuredClone(n.slides[0].objects[0].text.paragraphs[0])); }],
  ['changed paragraph identity', n => { n.slides[0].objects[0].text.paragraphs[0].id = 'changed'; }],
  ['unsupported paragraph property', n => { n.slides[0].objects[0].text.paragraphs[0].unexpected = true; }],
  ['invalid source slides collection', n => { n.slides = {}; }],
  ['invalid source assets collection', n => { n.assets = {}; }],
  ['invalid asset descriptor', n => { n.assets.push(null); }],
  ['asset identity collision', n => { n.assets.push({ id: n.slides[0].objects[0].id }); }],
  ['unsupported asset descriptor', n => { n.assets.push({ id: 'asset', extensions: { stagecraftAuthored: true, contentType: 'image/gif' } }); }],
  ['extra asset extension', n => { n.assets.push({ id: 'asset', extensions: { stagecraftAuthored: true, contentType: 'image/png', extra: true } }); }],
])('rejects invalid native authoring input: %s', async (_label, mutate) => {
  const session = await open('pptx');
  try {
    const next = structuredClone(session.document);
    mutate(next);
    await expect(session.export(next)).rejects.toThrow();
  } finally { session.dispose(); }
});

it('strips display proofs without masking unrelated extensions', () => {
  expect(withoutDisplayProof('value')).toBe('value');
  expect(withoutDisplayProof({ extensions: null })).toEqual({});
  expect(withoutDisplayProof({ extensions: { pptxAppearance: null, keep: true } })).toEqual({ extensions: { keep: true } });
  expect(withoutDisplayProof({ extensions: { stagecraftNativeAppearance: {}, pptxAppearance: { resolved: {} } } })).toEqual({});
});

describe.each(['pptx', 'odp'])('%s additional native authoring branches', format => {
  it('writes full authored paragraph/run formatting and text layout', async () => {
    const s = await open(format), n = structuredClone(s.document);
    const text = object('formatted-text');
    text.text.paragraphs[0].style = { alignment: 'right', spaceBefore: 12, spaceAfter: 4, lineSpacing: 120, indentStart: 914400, indentEnd: 457200, firstLineIndent: -228600, bullet: { type: 'char', char: '•' } };
    text.text.paragraphs[0].runs[0].style = { b: '1', i: '1', sz: '2800', typeface: 'Courier New', eastAsian: 'SimSun', complexScript: 'Amiri', color: '#223344' };
    text.bodyLayout = format === 'pptx'
      ? { autofit: 'resize', wrap: 'square', anchor: 'middle', insets: { left: 12700, top: 25400, right: 38100, bottom: 50800 } }
      : { autofit: 'resize' };
    n.slides[0].objects.push(text);
    const again = await openPresentation((await s.export(n)).bytes, { format });
    const written = again.document.slides[0].objects.filter(o => o.text).at(-1);
    expect(written.text.paragraphs[0].style).toMatchObject({ alignment: 'right', spaceBefore: 12, spaceAfter: 4, lineSpacing: 120, indentStart: 914400, indentEnd: 457200, firstLineIndent: -228600, bullet: { type: 'char', char: '•' } });
    expect(written.bodyLayout.autofit).toBe('resize');
  });

  it('writes JPEG images and reuses registered media', async () => {
    const s = await open(format), n = structuredClone(s.document);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    const image = s.registerImage({ bytes: jpeg, contentType: 'image/jpeg' });
    n.assets.push({ id: image.assetId, extensions: { stagecraftAuthored: true, contentType: 'image/jpeg' } });
    const objectImage = id => ({ id, type: 'image', geometry: { x: 0, y: 0, width: 127000, height: 127000 }, extensions: { stagecraftAuthored: true }, image: { assetId: image.assetId, alt: 'JPEG' } });
    n.slides[0].objects.push(objectImage('jpeg-one'), objectImage('jpeg-two'));
    const out = await s.export(n);
    const again = await openPresentation(out.bytes, { format });
    expect(again.document.slides[0].objects.filter(o => o.type === 'image')).toHaveLength(2);
  });

  it('edits native fill and removes previously written notes', async () => {
    const s = await open(format), n = structuredClone(s.document);
    n.slides[0].objects[1].fill = '#abcdef';
    n.slides[0].notes = 'Temporary note';
    const first = await s.export(n);
    const edited = await openPresentation(first.bytes, { format });
    const next = structuredClone(edited.document);
    delete next.slides[0].notes;
    const out = await edited.export(next);
    expect((await openPresentation(out.bytes, { format })).document.slides[0].notes).toBeUndefined();
  });
});

it.each([
  ['unsupported ODP layout key', n => { n.slides[0].objects[0].bodyLayout ??= {}; n.slides[0].objects[0].bodyLayout.wrap = 'none'; }],
  ['ODP shrink autofit', n => { n.slides[0].objects[0].bodyLayout ??= {}; n.slides[0].objects[0].bodyLayout.autofit = 'shrink'; }],
  ['non-list paragraph level', n => { n.slides[0].objects[0].text.paragraphs[0].style.level = 1; }],
])('rejects unsupported ODP authoring: %s', async (_label, mutate) => {
  const s = await open('odp');
  try {
    const n = structuredClone(s.document);
    mutate(n);
    await expect(s.export(n)).rejects.toThrow();
  } finally { s.dispose(); }
});

it.each(['pptx', 'odp'])('rejects dangling authored image references in %s', async format => {
  const s = await open(format);
  try {
    const n = structuredClone(s.document);
    n.assets.push({ id: 'missing-image', extensions: { stagecraftAuthored: true, contentType: 'image/png' } });
    n.slides[0].objects.push({ id: 'dangling-image', type: 'image', geometry: { x: 0, y: 0, width: 100, height: 100 }, extensions: { stagecraftAuthored: true }, image: { assetId: 'missing-image' } });
    await expect(s.export(n)).rejects.toThrow(/Missing image bytes/);
  } finally { s.dispose(); }
});

it('writes and clears native PPTX paragraph and body-layout properties', async () => {
  const s = await open('pptx');
  try {
    const editor = createEditor({ document: s.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
    const paragraph = editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0];
    const format = { alignment: 'center', spaceBefore: 12, spaceAfter: 4, lineSpacing: 120, level: 0, indentStart: 914400, indentEnd: 457200, firstLineIndent: -228600, bullet: { type: 'number', format: 'lowerAlphaPeriod' } };
    expect(editor.dispatch('document.setParagraphFormat', { paragraphId: paragraph.id, format }).changed).toBe(true);
    const written = await s.export(editor.getSnapshot().document);
    const reopened = await openPresentation(written.bytes, { format: 'pptx' });
    expect(reopened.document.slides[0].objects[0].text.paragraphs[0].style).toMatchObject(format);

    const clear = Object.fromEntries(Object.keys(format).map(key => [key, null]));
    expect(editor.dispatch('document.setParagraphFormat', { paragraphId: paragraph.id, format: clear }).changed).toBe(true);
    const objectId = editor.getSnapshot().document.slides[0].objects[0].id;
    const layout = { autofit: 'none', wrap: 'none', anchor: 'middle', insets: { left: 12700, top: 25400, right: 38100, bottom: 50800 } };
    expect(editor.dispatch('document.setTextBodyLayout', { objectId, layout }).changed).toBe(true);
    expect(editor.dispatch('document.setTextBodyLayout', { objectId, layout: { autofit: null, wrap: null, anchor: null, insets: { left: null, top: null, right: null, bottom: null } } }).changed).toBe(true);
    const cleared = await s.export(editor.getSnapshot().document);
    expect(cleared.dirtyParts.length).toBeGreaterThan(0);
  } finally { s.dispose(); }
});

it('writes and clears native ODP autofit and rejects non-list authored levels', async () => {
  const s = await open('odp');
  try {
    const editor = createEditor({ document: s.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
    const objectId = editor.getSnapshot().document.slides[0].objects[0].id;
    expect(editor.dispatch('document.setTextBodyLayout', { objectId, layout: { autofit: 'none' } }).changed).toBe(true);
    const written = await s.export(editor.getSnapshot().document);
    expect((await openPresentation(written.bytes, { format: 'odp' })).document.slides[0].objects[0].bodyLayout.autofit).toBe('none');
    expect(editor.dispatch('document.setTextBodyLayout', { objectId, layout: { autofit: null } }).changed).toBe(true);
    expect((await s.export(editor.getSnapshot().document)).bytes).toEqual((await s.export(s.document)).bytes);

    const n = structuredClone(s.document);
    const text = object('odp-level');
    text.text.paragraphs[0].style ??= {};
    text.text.paragraphs[0].style.level = 1;
    n.slides[0].objects.push(text);
    await expect(s.export(n)).rejects.toThrow(/Non-list ODP paragraph levels/);
  } finally { s.dispose(); }
});

it('recreates ODP automatic styles and missing manifest entries for authored images', async () => {
  const s = await open('odp');
  try {
    const baseline = await JSZip.loadAsync((await s.export(s.document)).bytes);
    const content = await baseline.file('content.xml').async('string');
    baseline.file('content.xml', content.replace(/<office:automatic-styles>[\s\S]*?<\/office:automatic-styles>/, ''));
    const session = await openPresentation(await baseline.generateAsync({ type: 'uint8array' }), { format: 'odp' });
    try {
      const image = session.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
      const n = structuredClone(session.document);
      n.assets.push({ id: image.assetId, extensions: { stagecraftAuthored: true, contentType: 'image/png' } });
      n.slides[0].objects.push({ id: 'odp-auto-style', type: 'image', geometry: { x: 0, y: 0, width: 100, height: 100 }, extensions: { stagecraftAuthored: true }, image: { assetId: image.assetId } });
      const out = await session.export(n);
      expect((await openPresentation(out.bytes, { format: 'odp' })).document.slides[0].objects.some(object => object.type === 'image')).toBe(true);

      const zip = await JSZip.loadAsync(out.bytes);
      const manifest = await zip.file('META-INF/manifest.xml').async('string');
      zip.file('META-INF/manifest.xml', manifest.replace(/<manifest:file-entry manifest:full-path="Pictures\/[^"]+"[^>]*\/>/, ''));
      const reopened = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'odp' });
      const next = structuredClone(reopened.document);
      const second = reopened.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
      next.assets.push({ id: second.assetId, extensions: { stagecraftAuthored: true, contentType: 'image/png' } });
      next.slides[0].objects.push({ id: 'odp-second-image', type: 'image', geometry: { x: 0, y: 0, width: 100, height: 100 }, extensions: { stagecraftAuthored: true }, image: { assetId: second.assetId } });
      expect((await reopened.export(next)).dirtyParts.length).toBeGreaterThan(0);
    } finally { session.dispose(); }
  } finally { s.dispose(); }
});

it('adds missing JPEG content types and notes relationships', async () => {
  const s = await open('pptx');
  try {
    const baseline = await JSZip.loadAsync((await s.export(s.document)).bytes);
    const types = await baseline.file('[Content_Types].xml').async('string');
    baseline.file('[Content_Types].xml', types.replace(/<Default Extension="jpeg"[^>]*\/>/, ''));
    const session = await openPresentation(await baseline.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
    try {
      const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
      const image = session.registerImage({ bytes: jpeg, contentType: 'image/jpeg' });
      const n = structuredClone(session.document);
      n.assets.push({ id: image.assetId, extensions: { stagecraftAuthored: true, contentType: 'image/jpeg' } });
      n.slides[0].objects.push({ id: 'jpeg-missing-type', type: 'image', geometry: { x: 0, y: 0, width: 100, height: 100 }, extensions: { stagecraftAuthored: true }, image: { assetId: image.assetId } });
      n.slides[0].notes = 'Notes without a retained relationship';
      const out = await session.export(n);
      expect((await openPresentation(out.bytes, { format: 'pptx' })).document.slides[0].notes).toBe('Notes without a retained relationship');
    } finally { session.dispose(); }
  } finally { s.dispose(); }
});

it('wraps PPTX slide ids after the schema maximum', async () => {
  const s = await open('pptx');
  const baseline = await JSZip.loadAsync((await s.export(s.document)).bytes);
  const part = 'ppt/presentation.xml';
  const doc = new DOMParser().parseFromString(await baseline.file(part).async('string'), 'application/xml');
  const refs = Array.from(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId'));
  refs[0].setAttribute('id', '2147483646');
  refs[1].setAttribute('id', '2147483647');
  baseline.file(part, new XMLSerializer().serializeToString(doc));
  const session = await openPresentation(await baseline.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
  try {
    const next = structuredClone(session.document);
    next.slides.push({ id: 'wrapped-slide', objects: [], extensions: { stagecraftAuthored: true } });
    const out = await JSZip.loadAsync((await session.export(next)).bytes);
    const written = new DOMParser().parseFromString(await out.file(part).async('string'), 'application/xml');
    const ids = Array.from(written.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId')).map(node => Number(node.getAttribute('id')));
    expect(ids.at(-1)).toBe(256);
  } finally { session.dispose(); }
});

it.each([
  ['non-object paragraph style', n => { n.slides[0].objects[0].text.paragraphs[0].style = 'bad'; }],
  ['invalid paragraph style value', n => { n.slides[0].objects[0].text.paragraphs[0].style = { alignment: 'bad' }; }],
  ['conflicting paragraph alias', n => { n.slides[0].objects[0].text.paragraphs[0].style = { alignment: 'left', algn: 'left' }; }],
  ['non-object body layout', n => { n.slides[0].objects[0].bodyLayout = 'bad'; }],
  ['non-object insets', n => { n.slides[0].objects[0].bodyLayout = { insets: 'bad' }; }],
  ['invalid inset side', n => { n.slides[0].objects[0].bodyLayout = { insets: { middle: 1 } }; }],
  ['oversized inset', n => { n.slides[0].objects[0].bodyLayout = { insets: { left: 10000001 } }; }],
  ['invalid asset collection', n => { n.assets = {}; }],
  ['asset with extra keys', n => { n.assets.push({ id: 'asset', extensions: { stagecraftAuthored: true, contentType: 'image/png' }, extra: true }); }],
  ['empty asset id', n => { n.assets.push({ id: '', extensions: { stagecraftAuthored: true, contentType: 'image/png' } }); }],
  ['duplicate source identity', n => { n.slides[0].objects[1].id = n.slides[0].objects[0].id; }],
  ['invalid object collection', n => { n.slides[0].objects = {}; }],
  ['invalid slide name', n => { n.slides[0].name = 1; }],
  ['invalid notes', n => { n.slides[0].notes = 1; }],
  ['invalid background', n => { n.slides[0].background = { type: 'solid', color: 'bad' }; }],
  ['invalid fill', n => { n.slides[0].objects[1].fill = 'bad'; }],
  ['changed paragraph count', n => { n.slides[0].objects[0].text.paragraphs.push({ id: 'extra', runs: [] }); }],
  ['changed paragraph id', n => { n.slides[0].objects[0].text.paragraphs[0].id = 'extra'; }],
  ['unsupported paragraph key', n => { n.slides[0].objects[0].text.paragraphs[0].extra = true; }],
])('rejects invalid direct authoring diffs: %s', async (_label, mutate) => {
  const session = await open('pptx');
  try {
    const baseline = session.document, next = structuredClone(baseline);
    mutate(next);
    expect(() => applyAuthoringDiff(baseline, next)).toThrow();
  } finally { session.dispose(); }
});

it('reaches paragraph and layout validators through direct diffs', async () => {
  const session = await open('pptx');
  try {
    for (const [mutate, message] of [
      [n => { n.slides[0].objects[0].text.paragraphs[0].style = 'bad'; }, 'Invalid paragraph style'],
      [n => { n.slides[0].objects[0].text.paragraphs[0].style = { alignment: 'bad' }; }, 'Invalid paragraph formatting'],
      [n => { n.slides[0].objects[0].bodyLayout = 'bad'; }, 'Invalid text layout'],
      [n => { n.slides[0].objects[0].bodyLayout = { insets: 'bad' }; }, 'Invalid text insets'],
    ]) {
      const baseline = session.document, next = structuredClone(baseline);
      mutate(next);
      expect(() => applyAuthoringDiff(baseline, next)).toThrow(message);
    }
  } finally { session.dispose(); }
});

it('refuses removing retained assets through the direct authoring diff', async () => {
  const session = await open('pptx');
  try {
    const image = session.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
    const baseline = structuredClone(session.document);
    baseline.assets.push({ id: image.assetId, extensions: { stagecraftAuthored: true, contentType: 'image/png' } });
    const next = structuredClone(baseline);
    next.assets = [];
    expect(() => applyAuthoringDiff(baseline, next)).toThrow(/cannot be removed/);
  } finally { session.dispose(); }
});

it.each([
  ['missing', refs => refs.forEach(ref => ref.removeAttribute('id')), 256],
  ['nonnumeric', refs => refs.forEach(ref => ref.setAttribute('id', 'bogus')), 256],
  ['zero', refs => refs.forEach(ref => ref.setAttribute('id', '0')), 256],
  ['below minimum', refs => refs.forEach(ref => ref.setAttribute('id', '255')), 256],
  ['duplicate', refs => refs.forEach(ref => ref.setAttribute('id', '256')), 257],
  ['schema maximum', refs => refs.forEach(ref => ref.setAttribute('id', '2147483647')), 256],
  ['unsafe', refs => refs.forEach(ref => ref.setAttribute('id', String(Number.MAX_SAFE_INTEGER))), 256],
])('allocates a schema-valid PPTX slide id when native ids are %s', async (_label, mutate, expected) => {
  const source = await open('pptx');
  try {
    const zip = await JSZip.loadAsync((await source.export(source.document)).bytes);
    const part = 'ppt/presentation.xml';
    const xml = new DOMParser().parseFromString(await zip.file(part).async('string'), 'application/xml');
    const refs = Array.from(xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId'));
    mutate(refs);
    zip.file(part, new XMLSerializer().serializeToString(xml));
    const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
    try {
      const next = structuredClone(session.document);
      next.slides.push({ id: 'added-slide', objects: [], extensions: { stagecraftAuthored: true } });
      const output = await JSZip.loadAsync((await session.export(next)).bytes);
      const written = new DOMParser().parseFromString(await output.file(part).async('string'), 'application/xml');
      const ids = Array.from(written.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId')).map(ref => ref.getAttribute('id'));
      expect(ids).not.toContain('NaN');
      const added = Number(ids.at(-1));
      expect(added).toBe(expected);
      expect(added).toBeGreaterThanOrEqual(256);
      expect(added).toBeLessThanOrEqual(2147483647);
    } finally { session.dispose(); }
  } finally { source.dispose(); }
});

const simpleDeck = { title:'Deck', sections:[{id:'section',name:'Section',slides:['a','b']}], slides:['a','b'].map((id,i)=>({id,title:id,layout:'blank',elements:[{id:id+'text',type:'text',x:10,y:10,w:100,h:100,content:'Original'+i},{id:id+'rect',type:'rect',x:30,y:30,w:100,h:100,fill:'#abcdef'}]})) };
const open = async format => {
 const bytes = await (format==='pptx'?writePptx:writeOdp)(simpleDeck), zip=await JSZip.loadAsync(bytes);
 zip.file('unknown/payload.bin',new Uint8Array([8,9,10]));
 return openPresentation(await zip.generateAsync({type:'uint8array'}),{format});
};
describe.each(['pptx','odp'])('%s authoring boundaries',format=>{
 it('reorders original slide/object nodes, then removes original slides without rewriting retained parts',async()=>{
  const s=await open(format), n=structuredClone(s.document);n.slides.reverse();n.slides[0].objects.reverse();
  const out=await s.export(n), again=await openPresentation(out.bytes,{format});
  expect(JSON.stringify(again.document.slides[0])).toContain('Original1');
  expect(again.document.slides[0].objects[0].shape).toBe('rect');
  const before=await JSZip.loadAsync((await s.export(s.document)).bytes),after=await JSZip.loadAsync(out.bytes);
  for(const [name,entry] of Object.entries(before.files))if(!entry.dir&&!out.dirtyParts.includes(name))expect(await after.file(name).async('uint8array'),name).toEqual(await entry.async('uint8array'));
  n.slides.splice(0,1);const removed=await s.export(n);expect((await openPresentation(removed.bytes,{format})).document.slides).toHaveLength(1);
  expect(await (await JSZip.loadAsync(removed.bytes)).file('unknown/payload.bin').async('uint8array')).toEqual(new Uint8Array([8,9,10]));
 });
 it('writes authored paint and run formatting as native attributes/styles',async()=>{
  const s=await open(format), n=structuredClone(s.document);const text=object('authored');text.text.paragraphs[0].runs[0].text='A  B\tC\nD';
  const shape=object('paint','shape');shape.shape='rect';shape.fill='#ff2233';
  n.slides[0].objects=[text,shape];const out=await s.export(n), again=await openPresentation(out.bytes,{format});
  expect(again.document.slides[0].objects[1]).toMatchObject({type:'shape',shape:'rect',fill:'#ff2233'});
  const run=again.document.slides[0].objects[0].text.paragraphs[0].runs[0];
  if(format==='pptx')expect(run.style).toMatchObject({b:'1',i:'0',sz:'2400'});else expect(run.extensions.odpAppearance).toMatchObject({bold:true,italic:false,fontSize:24});
  expect(again.document.slides[0].objects[0].text.paragraphs[0].runs.map(r=>r.text).join('')).toBe('A  B\tC\nD');
 });
 it('rejects forged source, duplicate/reused identities, unknown properties and unsupported native changes',async()=>{
  const s=await open(format);
  const mutations=[n=>{n.slides[0].objects.push({...object('bad'),source:n.slides[0].objects[0].source});},n=>{n.slides.push({...n.slides[0]});},n=>{n.slides[0].objects.push({...object('bad'),unexpected:true});},n=>{n.slides[0].objects[0].extensions.tampered=true;},n=>{n.slides[0].objects[0].geometry.width=0;},n=>{n.slides[0].objects[0].geometry.skew=3;},n=>{const id=n.slides[0].objects[0].id;n.slides[0].objects=[];n.slides[1].objects.push(object(id));},n=>{n.slides=[];},n=>{const o=object('invalid-text');o.text.paragraphs[0].runs[0].text='\u0000';n.slides[0].objects.push(o);}];
  for(const mutate of mutations){const n=structuredClone(s.document);mutate(n);await expect(s.export(n)).rejects.toThrow();}
 });
 it('supports blank unsigned sources and rejects structural changes to signed packages',async()=>{
  const bytes=await (format==='pptx'?writePptx:writeOdp)({...simpleDeck,sections:[{id:'s',name:'s',slides:['blank']}],slides:[{id:'blank',layout:'blank',elements:[]}]});
  const s=await openPresentation(bytes,{format});expect(s.capabilities.readOnly).toBe(false);const n=structuredClone(s.document);n.slides[0].objects.push(object('insert'));expect((await openPresentation((await s.export(n)).bytes,{format})).document.slides[0].objects).toHaveLength(1);
  const zip=await JSZip.loadAsync(bytes);zip.file(format==='pptx'?'_xmlsignatures/sig.xml':'META-INF/documentsignatures.xml','<signature/>');const signed=await openPresentation(await zip.generateAsync({type:'uint8array'}),{format});
  expect(signed.capabilities.readOnly).toBe(true);const signedNext=structuredClone(signed.document);signedNext.slides[0].objects.push(object('insert'));await expect(signed.export(signedNext)).rejects.toThrow(/signed/);
 });
 it('roundtrips PPTX rotation and explicitly rejects unsupported ODP rotation',async()=>{
  const s=await open(format),n=structuredClone(s.document);const shape=object('rot','shape');shape.geometry.rotation=30;n.slides[0].objects.push(shape);
  if(format==='odp')await expect(s.export(n)).rejects.toThrow(/rotation/);else expect((await openPresentation((await s.export(n)).bytes,{format})).document.slides[0].objects.at(-1).geometry.rotation).toBe(30);
 });
});

it('keeps PPTX shape-tree extension metadata last when inserting and reordering shapes',async()=>{
 const s=await open('pptx'), zip=await JSZip.loadAsync((await s.export(s.document)).bytes);
 const part=s.document.slides[0].source.part;
 zip.file(part,(await zip.file(part).async('string')).replace('</p:spTree>','<p:extLst><p:ext uri="urn:unknown"><x:keep xmlns:x="urn:unknown" value="retained"/></p:ext></p:extLst></p:spTree>'));
 const session=await openPresentation(await zip.generateAsync({type:'uint8array'}),{format:'pptx'});
 expect(session.document.slides[0].objects).toHaveLength(2);
 const next=structuredClone(session.document);next.slides[0].objects.reverse();next.slides[0].objects.push(object('new'));
 const result=await session.export(next), edited=await JSZip.loadAsync(result.bytes), xml=new DOMParser().parseFromString(await edited.file(part).async('string'),'application/xml');
 const tree=xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main','spTree')[0];
 expect(tree.lastElementChild.localName).toBe('extLst');expect(xml.getElementsByTagNameNS('urn:unknown','keep')[0].getAttribute('value')).toBe('retained');
});
it('keeps ODP page notes outside object editing and before/after structure valid',async()=>{
 const bytes=await writeOdp({...simpleDeck,slides:simpleDeck.slides.map(s=>({...s,notes:'Retained note'}))});
 const s=await openPresentation(bytes,{format:'odp'});expect(s.document.slides[0].objects).toHaveLength(2);
 const n=structuredClone(s.document);n.slides[0].objects=[object('text')];
 const output=await s.export(n),zip=await JSZip.loadAsync(output.bytes),xml=new DOMParser().parseFromString(await zip.file('content.xml').async('string'),'application/xml');
 const page=xml.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:drawing:1.0','page')[0];expect(page.lastElementChild.localName).toBe('notes');expect(page.lastElementChild.textContent).toBe('Retainednote');expect(page.lastElementChild.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0','s')).toHaveLength(1);
});
it('reserves existing ODP style names when existing run patches and authored text are combined',async()=>{
 const s=await open('odp'), n=structuredClone(s.document);n.slides[0].objects[0].text.paragraphs[0].runs[0].style.overrides={bold:false};n.slides[0].objects.unshift(object('new'));
 const result=await s.export(n), zip=await JSZip.loadAsync(result.bytes),xml=new DOMParser().parseFromString(await zip.file('content.xml').async('string'),'application/xml');
 const names=Array.from(xml.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:style:1.0','style')).map(n=>n.getAttribute('style:name'));expect(new Set(names).size).toBe(names.length);
 const again=await openPresentation(result.bytes,{format:'odp'});expect(again.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.odpAppearance.bold).toBe(true);expect(again.document.slides[0].objects[1].text.paragraphs[0].runs[0].extensions.odpAppearance.bold).toBe(false);
});
it('reopens an empty authored ODP text run and can edit it again',async()=>{
 const s=await open('odp'),n=structuredClone(s.document),text=object('empty');text.text.paragraphs[0].runs[0].text='';n.slides[0].objects=[text];
 const reopened=await openPresentation((await s.export(n)).bytes,{format:'odp'}),next=structuredClone(reopened.document);expect(next.slides[0].objects[0].text.paragraphs[0].runs).toHaveLength(1);
 next.slides[0].objects[0].text.paragraphs[0].runs[0].text='Restored';
 expect(JSON.stringify((await openPresentation((await reopened.export(next)).bytes,{format:'odp'})).document)).toContain('Restored');
});
it('removes deleted PPTX slide references from custom shows and sections while retaining orphan slide data',async()=>{
 const s=await open('pptx'),zip=await JSZip.loadAsync((await s.export(s.document)).bytes),part='ppt/presentation.xml';
 const native=await zip.file(part).async('string'),doc=new DOMParser().parseFromString(native,'application/xml'),ref=doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main','sldId')[0],rid=ref.getAttribute('r:id'),id=ref.getAttribute('id');
 zip.file(part,native.replace('</p:presentation>',`<p:custShowLst><p:custShow name="custom" id="0"><p:sldLst><p:sld r:id="${rid}"/></p:sldLst></p:custShow></p:custShowLst><p:extLst><p:ext uri="sections"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p14:section name="section" id="section"><p14:sldIdLst><p14:sldId id="${id}"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst></p:presentation>`));
 const source=await openPresentation(await zip.generateAsync({type:'uint8array'}),{format:'pptx'}),next=structuredClone(source.document);const removedPart=next.slides.shift().source.part;
 const out=await source.export(next),after=await JSZip.loadAsync(out.bytes),result=new DOMParser().parseFromString(await after.file(part).async('string'),'application/xml');
 expect(result.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main','sld')).toHaveLength(0);expect(Array.from(result.getElementsByTagNameNS('http://schemas.microsoft.com/office/powerpoint/2010/main','sldId')).some(n=>n.getAttribute('id')===id)).toBe(false);expect(after.file(removedPart)).toBeTruthy();
});

// A deterministic 1x1 PNG so image tests need no external resource.
const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const authText = (id, value) => ({ paragraphs: [{ id: id + '-p', runs: [{ id: id + '-r', text: value, editable: true, style: { sz: '2400', b: '1' }, extensions: { stagecraftAuthored: true } }] }] });

describe.each(['pptx', 'odp'])('%s extended authoring', format => {
  it('round-trips slide name, solid background and notes', async () => {
    const s = await open(format), n = structuredClone(s.document);
    n.slides[0].name = 'Authored name';
    n.slides[0].background = { type: 'solid', color: '#e9eff7' };
    n.slides[0].notes = 'Speaker note line one\nline two';
    const again = await openPresentation((await s.export(n)).bytes, { format });
    expect(again.document.slides[0].name).toBe('Authored name');
    expect(again.document.slides[0].background).toEqual({ type: 'solid', color: '#e9eff7' });
    expect(again.document.slides[0].notes).toBe('Speaker note line one\nline two');
    // Clearing removes the explicit values again.
    const cleared = structuredClone(again.document);
    delete cleared.slides[0].name; delete cleared.slides[0].background; delete cleared.slides[0].notes;
    const clean = await openPresentation((await again.export(cleared)).bytes, { format });
    expect(clean.document.slides[0].name).toBeUndefined();
    expect(clean.document.slides[0].background).toBeUndefined();
    expect(clean.document.slides[0].notes).toBeUndefined();
  });

  it('patches notes without destroying other notes-part content', async () => {
    if (format !== 'pptx') return; // ODP notes live inside content.xml with no separate part
    const s = await open('pptx'), n = structuredClone(s.document);
    n.slides[0].notes = 'First';
    const first = await s.export(n);
    const zip = await JSZip.loadAsync(first.bytes);
    const notesPart = Object.keys(zip.files).find(p => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p));
    expect(notesPart).toBeTruthy();
    const notesXml = await zip.file(notesPart).async('string');
    zip.file(notesPart, notesXml.replace('</p:spTree>', '<p:sp><p:nvSpPr><p:cNvPr id="99" name="keep"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>unknown-marker</a:t></a:r></a:p></p:txBody></p:sp></p:spTree>'));
    const edited = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
    const next = structuredClone(edited.document);
    next.slides[0].notes = 'Second';
    const out = await edited.export(next);
    const after = await JSZip.loadAsync(out.bytes);
    const text = await after.file(notesPart).async('string');
    expect(text).toContain('unknown-marker');
    expect(text).toContain('Second');
    expect(text).not.toContain('First');
  });

  it('writes rich multi-paragraph text and text inside an authored shape', async () => {
    const s = await open(format), n = structuredClone(s.document);
    const rich = authText('rich', 'Rich');
    rich.paragraphs.push({ id: 'second-p', runs: [{ id: 'second-r', text: 'Second', editable: true, style: { i: '1' }, extensions: { stagecraftAuthored: true } }] });
    n.slides[0].objects.push(
      { id: 'authored-text', type: 'text', geometry: { x: 12700, y: 12700, width: 900000, height: 300000 }, extensions: { stagecraftAuthored: true }, text: rich },
      { id: 'authored-shape', type: 'shape', shape: 'rect', fill: '#336699', geometry: { x: 12700, y: 400000, width: 900000, height: 300000 }, extensions: { stagecraftAuthored: true }, text: authText('shape', 'Inside') }
    );
    const again = await openPresentation((await s.export(n)).bytes, { format });
    const texts = again.document.slides[0].objects.filter(o => o.text);
    const all = JSON.stringify(texts);
    expect(all).toContain('Rich');
    expect(all).toContain('Second');
    expect(all).toContain('Inside');
    const shape = again.document.slides[0].objects.find(o => o.shape === 'rect' && o.text);
    expect(shape.fill_ ?? shape.fill).toBe('#336699');
    expect(shape.extensions.editableFill).toBe(true);
  });

  it('rewrites a native rect fill in place and refuses ineligible objects', async () => {
    const s = await open(format);
    const rect = s.document.slides[0].objects.find(o => o.shape === 'rect');
    expect(rect.extensions.editableFill).toBe(true);
    const n = structuredClone(s.document);
    n.slides[0].objects.find(o => o.id === rect.id).fill = '#010203';
    const again = await openPresentation((await s.export(n)).bytes, { format });
    expect(again.document.slides[0].objects.find(o => o.shape === 'rect').fill).toBe('#010203');
    // A text object has no editable fill.
    const bad = structuredClone(s.document);
    const textObject = bad.slides[0].objects.find(o => o.text);
    textObject.fill = '#010203';
    await expect(s.export(bad)).rejects.toThrow();
  });

  it('round-trips an authored table with geometry and cell text', async () => {
    const s = await open(format), n = structuredClone(s.document);
    n.slides[0].objects.push({ id: 'authored-table', type: 'table', geometry: { x: 12700, y: 12700, width: 762000, height: 381000 }, extensions: { stagecraftAuthored: true }, table: {
      columns: [{ id: 'col-1', width: 381000 }, { id: 'col-2', width: 381000 }],
      rows: [{ id: 'row-1', cells: [{ id: 'cell-11', text: authText('c11', 'A1') }, { id: 'cell-12', text: authText('c12', 'B1') }] }]
    } });
    const again = await openPresentation((await s.export(n)).bytes, { format });
    const table = again.document.slides[0].objects.find(o => o.type === 'table');
    expect(table).toBeTruthy();
    expect(table.geometry).toEqual({ x: 12700, y: 12700, width: 762000, height: 381000 });
    const cells = table.table.rows.map(row => row.cells.map(cell => cell.text.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('')));
    expect(cells).toEqual([['A1', 'B1']]);
  });

  it('round-trips an authored image, keeps preview bytes and copies them', async () => {
    const s = await open(format);
    const registered = s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
    const n = structuredClone(s.document);
    n.assets.push({ id: registered.assetId, extensions: { stagecraftAuthored: true, contentType: 'image/png' } });
    n.slides[0].objects.push({ id: 'authored-image', type: 'image', geometry: { x: 12700, y: 12700, width: 100000, height: 100000 }, extensions: { stagecraftAuthored: true }, image: { assetId: registered.assetId, alt: 'Dot' } });
    const preview = s.getImage(registered.assetId);
    expect(preview.contentType).toBe('image/png');
    preview.bytes[0] = 0; // a returned copy must not corrupt the private store
    expect(s.getImage(registered.assetId).bytes[0]).toBe(137);
    const exported = await s.export(n);
    const again = await openPresentation(exported.bytes, { format });
    const image = again.document.slides[0].objects.find(o => o.type === 'image');
    expect(image).toBeTruthy();
    expect(image.geometry).toEqual({ x: 12700, y: 12700, width: 100000, height: 100000 });
    const reopenedPreview = again.getImage(image.image.assetId);
    expect(reopenedPreview.contentType).toBe('image/png');
    expect(reopenedPreview.bytes.length).toBe(PNG_1PX.length);
    expect(again.images).toContain(image.image.assetId);
    // No-op export after reopen is byte-identical even with images present.
    expect((await again.export(again.document)).bytes).toEqual(exported.bytes);
  });

  it('bounds registered images and refuses non-PNG/JPEG payloads', async () => {
    const s = await open(format);
    expect(() => s.registerImage({ bytes: Uint8Array.from([1, 2, 3]), contentType: 'image/png' })).toThrow(/Unsupported image/);
    expect(() => s.registerImage({ bytes: PNG_1PX, contentType: 'image/jpeg' })).toThrow(/content type/i);
    expect(() => s.registerImage({ bytes: new Uint8Array(6 * 1024 * 1024), contentType: 'image/png' })).toThrow(/per-image/);
    const first = s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
    expect(first.assetId).toBeTruthy();
  });

  it('never accepts a forged or dangling retained asset descriptor', async () => {
    const s = await open(format);
    const registered = s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
    const withAsset = structuredClone(s.document);
    withAsset.assets.push({ id: registered.assetId, extensions: { stagecraftAuthored: true, contentType: 'image/png' } });
    // A descriptor on its own writes nothing, so the export stays byte-identical.
    const plain = await s.export(withAsset);
    expect(plain.bytes).toEqual((await s.export(s.document)).bytes);
    for (const forged of [
      { id: 'asset-x', extensions: { stagecraftAuthored: true, contentType: 'image/gif' } },
      { id: 'asset-x', extensions: { stagecraftAuthored: true, contentType: 'image/png', extra: 1 } },
      { id: 'asset-x', unexpected: true },
      { id: 'asset-x', extensions: { stagecraftAuthored: false, contentType: 'image/png' } }
    ]) {
      const candidate = structuredClone(withAsset);
      candidate.assets.push(forged);
      await expect(s.export(candidate)).rejects.toThrow();
    }
    // Removing an asset an object still references fails document validation.
    const dangling = structuredClone(withAsset);
    dangling.slides[0].objects.push({ id: 'img-x', type: 'image', geometry: { x: 0, y: 0, width: 10, height: 10 }, extensions: { stagecraftAuthored: true }, image: { assetId: registered.assetId } });
    const withImage = structuredClone(dangling);
    withImage.assets.pop();
    await expect(s.export(withImage)).rejects.toThrow();
  });
});

describe.each(['pptx', 'odp'])('%s slide-property preservation', format => {
  it('clearing notes keeps the notes container and unrelated metadata', async () => {
    const s = await open(format), n = structuredClone(s.document);
    n.slides[0].notes = 'Keep the container';
    const withNotes = await s.export(n);
    const zip = await JSZip.loadAsync(withNotes.bytes);
    let target, marker;
    if (format === 'pptx') {
      target = Object.keys(zip.files).find(p => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p));
      marker = '<p:extLst><p:ext uri="urn:marker"><x:m xmlns:x="urn:marker"/></p:ext></p:extLst>';
      zip.file(target, (await zip.file(target).async('string')).replace('</p:notes>', `${marker}</p:notes>`));
    } else {
      target = 'content.xml';
      marker = '<presentation:header-fields-pending-marker/>';
      zip.file(target, (await zip.file(target).async('string')).replace('</presentation:notes>', `${marker}</presentation:notes>`));
    }
    const edited = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format });
    expect(edited.document.slides[0].notes).toBe('Keep the container');
    const next = structuredClone(edited.document);
    delete next.slides[0].notes;
    const cleared = await edited.export(next);
    expect((await openPresentation(cleared.bytes, { format })).document.slides[0].notes).toBeUndefined();
    const after = await JSZip.loadAsync(cleared.bytes);
    const text = await after.file(target).async('string');
    expect(text).toContain(format === 'pptx' ? 'urn:marker' : 'header-fields-pending-marker');
    if (format === 'pptx') expect(after.file(target)).toBeTruthy();
  });

  if (format === 'odp') {
    it('clearing a background keeps unrelated page-style semantics', async () => {
      const s = await open('odp');
      const zip = await JSZip.loadAsync((await s.export(s.document)).bytes);
      const content = await zip.file('content.xml').async('string');
      // Give the page a style carrying unrelated semantics (a transition + display flags).
      zip.file('content.xml', content
        .replace('<draw:page ', '<draw:page draw:style-name="NativePageStyle" ')
        .replace('</office:automatic-styles>', '<style:style style:name="NativePageStyle" style:family="drawing-page"><style:drawing-page-properties presentation:transition-type="automatic" presentation:transition-speed="slow" presentation:display-footer="true" presentation:background-visible="true"/></style:style></office:automatic-styles>'));
      const edited = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'odp' });
      expect(edited.document.slides[0].background).toBeUndefined();
      const painted = structuredClone(edited.document);
      painted.slides[0].background = { type: 'solid', color: '#e9eff7' };
      // Clearing must be measured against a baseline that actually had the background.
      const withBackground = await openPresentation((await edited.export(painted)).bytes, { format: 'odp' });
      expect(withBackground.document.slides[0].background).toEqual({ type: 'solid', color: '#e9eff7' });
      const cleared = structuredClone(withBackground.document);
      delete cleared.slides[0].background;
      const out = await withBackground.export(cleared);
      const result = await JSZip.loadAsync(out.bytes);
      const xml = await result.file('content.xml').async('string');
      const page = xml.match(/<draw:page[^>]*>/)[0];
      const styleName = /draw:style-name="([^"]+)"/.exec(page)[1];
      const chain = [styleName];
      let guard = 0;
      while (guard++ < 5) {
        const style = new RegExp(`<style:style[^>]*style:name="${chain[chain.length - 1]}"[\\s\\S]{0,600}?</style:style>`).exec(xml);
        if (!style) break;
        const parent = /style:parent-style-name="([^"]+)"/.exec(style[0]);
        if (!parent) break;
        chain.push(parent[1]);
      }
      expect(chain).toContain('NativePageStyle');
      const nativeStyle = /<style:style[^>]*style:name="NativePageStyle"[\s\S]{0,400}?<\/style:style>/.exec(xml)[0];
      expect(nativeStyle).toContain('presentation:transition-type="automatic"');
      expect(nativeStyle).toContain('presentation:display-footer="true"');
      // The cleared style overrides the fill but inherits everything else.
      const clearedStyle = new RegExp(`<style:style[^>]*style:name="${styleName}"[\\s\\S]{0,300}?</style:style>`).exec(xml)[0];
      expect(clearedStyle).toContain('draw:fill="none"');
    });
  }
});

const chart = (kind, extra = {}) => ({ kind, categories: ['North', 'South', 'East'], series: [{ name: 'Revenue', values: [30, 20, 50] }], ...extra });
describe.each(['pptx', 'odp'])('%s chart authoring', format => {
  it.each(['bar', 'line', 'pie'])('round-trips an authored %s chart and keeps a byte-identical no-op', async kind => {
    const s = await open(format);
    const n = structuredClone(s.document);
    n.slides[0].objects.push({ id: 'authored-chart', type: 'chart', geometry: { x: 12700, y: 12700, width: 6000000, height: 3000000 }, extensions: { stagecraftAuthored: true }, chart: chart(kind) });
    const result = await s.export(n);
    const again = await openPresentation(result.bytes, { format });
    const object = again.document.slides[0].objects.find(o => o.type === 'chart');
    expect(object).toBeTruthy();
    expect(object.chart.kind).toBe(kind);
    expect(object.chart.categories).toEqual(['North', 'South', 'East']);
    expect(object.chart.series.map(series => [series.name, series.values])).toEqual([['Revenue', [30, 20, 50]]]);
    expect(object.geometry).toEqual({ x: 12700, y: 12700, width: 6000000, height: 3000000 });
    // Native chart data is preview-only: not authored, so it cannot be rewritten through setChart.
    expect(object.extensions?.stagecraftAuthored).toBeUndefined();
    const noop = await again.export(again.document);
    expect(Buffer.compare(Buffer.from(noop.bytes), Buffer.from(result.bytes))).toBe(0);
    // Removing the authored chart removes it and still reopens cleanly.
    const removed = structuredClone(again.document);
    removed.slides[0].objects = removed.slides[0].objects.filter(o => o.type !== 'chart');
    const cleaned = await openPresentation((await again.export(removed)).bytes, { format });
    expect(cleaned.document.slides[0].objects.some(o => o.type === 'chart')).toBe(false);
  });
  it('rejects nonzero chart rotation before writing anything', async () => {
    const s = await open(format);
    const n = structuredClone(s.document);
    n.slides[0].objects.push({ id: 'rotated-chart', type: 'chart', geometry: { x: 0, y: 0, width: 6000000, height: 3000000, rotation: 10 }, extensions: { stagecraftAuthored: true }, chart: chart('bar') });
    await expect(s.export(n)).rejects.toThrow();
  });
  it('keeps unsupported chart payloads out of the document', async () => {
    const s = await open(format);
    const n = structuredClone(s.document);
    n.slides[0].objects.push({ id: 'bad-chart', type: 'chart', geometry: { x: 0, y: 0, width: 6000000, height: 3000000 }, extensions: { stagecraftAuthored: true }, chart: { kind: 'bar', categories: ['A'], series: [{ name: 'S', values: [1, 2] }] } });
    await expect(s.export(n)).rejects.toThrow();
  });
});

describe.each(['pptx', 'odp'])('%s authored-slide properties', format => {
  it('keeps name, background and notes on a newly authored slide', async () => {
    const s = await open(format), n = structuredClone(s.document);
    n.slides.push({
      id: 'authored-slide', objects: [], extensions: { stagecraftAuthored: true },
      name: 'Authored Name', background: { type: 'solid', color: '#123456' }, notes: 'Authored notes'
    });
    const exported = await s.export(n);
    const again = await openPresentation(exported.bytes, { format });
    expect(again.document.slides).toHaveLength(n.slides.length);
    const slide = again.document.slides.at(-1);
    expect(slide.name).toBe('Authored Name');
    expect(slide.background).toEqual({ type: 'solid', color: '#123456' });
    expect(slide.notes).toBe('Authored notes');
    // Re-exporting unchanged keeps byte identity even with authored slide properties present.
    const noop = await again.export(again.document);
    expect(Buffer.compare(Buffer.from(noop.bytes), Buffer.from(exported.bytes))).toBe(0);
  });
});

describe('ODF whitespace fidelity', () => {
  it('round-trips notes with repeated spaces, tabs and newlines', async () => {
    const s = await open('odp'), n = structuredClone(s.document);
    const notes = 'A  B\tC\nD  ';
    n.slides[0].notes = notes;
    const again = await openPresentation((await s.export(n)).bytes, { format: 'odp' });
    expect(again.document.slides[0].notes).toBe(notes);
  });
  it('round-trips authored table cell text with repeated spaces', async () => {
    const s = await open('odp'), n = structuredClone(s.document);
    const cell = (id, value) => ({ id, text: { paragraphs: [{ id: `${id}-p`, runs: [{ id: `${id}-r`, text: value, editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }] } });
    n.slides[0].objects.push({ id: 'table-ws', type: 'table', geometry: { x: 0, y: 0, width: 762000, height: 254000 }, extensions: { stagecraftAuthored: true }, table: {
      columns: [{ id: 'ws-col', width: 762000 }],
      rows: [{ id: 'ws-row', cells: [cell('ws-cell', 'A  B\tC')] }]
    } });
    const again = await openPresentation((await s.export(n)).bytes, { format: 'odp' });
    const table = again.document.slides[0].objects.find(o => o.type === 'table');
    const text = table.table.rows[0].cells[0].text.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');
    expect(text).toBe('A  B\tC');
  });
  it('advertises object-chart so hosts can enable chart controls', async () => {
    for (const format of ['pptx', 'odp']) {
      const s = await open(format);
      expect(s.capabilities.edits).toContain('object-chart');
      s.dispose();
    }
  });
});

describe('PPTX notes part without a body placeholder', () => {
  it('creates a body placeholder instead of silently dropping the notes edit', async () => {
    const s = await open('pptx'), n = structuredClone(s.document);
    n.slides[0].notes = 'First note';
    const first = await s.export(n);
    const zip = await JSZip.loadAsync(first.bytes);
    const notesPart = Object.keys(zip.files).find(p => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p));
    // Strip the body placeholder (as some third-party notes parts do).
    const stripped = (await zip.file(notesPart).async('string'))
      .replace(/<p:sp><p:nvSpPr>[^]*?<p:ph type="body"[^/]*\/>[^]*?<\/p:sp>/, '');
    expect(stripped).not.toContain('type="body"');
    zip.file(notesPart, stripped);
    const edited = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
    const next = structuredClone(edited.document);
    next.slides[0].notes = 'Second note';
    const out = await edited.export(next);
    const after = await JSZip.loadAsync(out.bytes);
    const text = await after.file(notesPart).async('string');
    expect(text).toContain('type="body"');
    expect(text).toContain('Second note');
    expect((await openPresentation(out.bytes, { format: 'pptx' })).document.slides[0].notes).toBe('Second note');
  });
});
