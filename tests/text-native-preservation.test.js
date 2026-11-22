import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { writePptx } from '../packages/pptx/src/index.js';
import { openPresentation } from '../packages/source/src/index.js';
import { createEditor } from '../packages/core/src/editor/index.js';
import { documentPlugin, validateDocument } from '../packages/core/src/document/index.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const serialize = node => new XMLSerializer().serializeToString(node);
const first = (node, name) => node.getElementsByTagNameNS(A, name)[0];
const element = (doc, name, attrs = {}) => {
  const node = doc.createElementNS(A, `a:${name}`);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
async function fixture() {
  const bytes = await writePptx({ title: 'Preservation', sections: [{ id: 'section', name: 'Slides', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [{ id: 't', type: 'text', x: 10, y: 10, w: 200, h: 100, content: 'Keep formatting' }] }] });
  const zip = await JSZip.loadAsync(bytes), part = 'ppt/slides/slide1.xml';
  const doc = parse(await zip.file(part).async('string'));
  const body = first(doc, 'bodyPr');
  body.setAttribute('anchor', 't'); body.setAttribute('lIns', '12345');
  for (const node of [...body.childNodes]) if (node.nodeType === 1 && ['normAutofit', 'noAutofit', 'spAutoFit'].includes(node.localName)) body.removeChild(node);
  body.insertBefore(element(doc, 'prstTxWarp', { prst: 'textNoShape' }), body.firstChild);
  body.appendChild(element(doc, 'normAutofit', { fontScale: '80000', lnSpcReduction: '15000' }));
  body.appendChild(element(doc, 'scene3d')); body.appendChild(element(doc, 'flatTx', { z: '0' }));
  const bodyExt = element(doc, 'extLst'); bodyExt.appendChild(element(doc, 'ext', { uri: 'body-keep' })); body.appendChild(bodyExt);
  const p = first(doc, 'p');
  let props = first(p, 'pPr');
  if (!props) { props = element(doc, 'pPr'); p.insertBefore(props, p.firstChild); }
  while (props.firstChild) props.removeChild(props.firstChild);
  props.setAttribute('rtl', '1');
  const bullet = element(doc, 'buBlip'); bullet.appendChild(element(doc, 'blip')); props.appendChild(bullet);
  props.appendChild(element(doc, 'defRPr', { b: '1' }));
  const ext = element(doc, 'extLst'); ext.appendChild(element(doc, 'ext', { uri: 'keep-me' })); props.appendChild(ext);
  const nativeRun = first(p, 'r');
  let rPr = first(nativeRun, 'rPr');
  if (!rPr) { rPr = element(doc, 'rPr'); nativeRun.insertBefore(rPr, nativeRun.firstChild); }
  for (const n of [...rPr.children]) if (['solidFill', 'latin'].includes(n.localName)) rPr.removeChild(n);
  const fill = element(doc, 'solidFill'), color = element(doc, 'schemeClr', { val: 'accent2' });
  color.appendChild(element(doc, 'alpha', { val: '70000' })); color.appendChild(element(doc, 'lumMod', { val: '60000' })); fill.appendChild(color);
  rPr.insertBefore(fill, rPr.firstChild);
  rPr.appendChild(element(doc, 'latin', { typeface: 'Georgia', panose: '02020603050405020304', pitchFamily: '18', charset: '0' }));
  zip.file(part, serialize(doc)); zip.file('unknown/keep.bin', new Uint8Array([1, 3, 5]));
  const original = await zip.generateAsync({ type: 'uint8array' });
  const source = await openPresentation(original, { format: 'pptx' });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin] });
  const object = source.document.slides[0].objects.find(o => o.text);
  return { original, source, editor, object, part, close() { editor.dispose(); source.dispose(); } };
}
async function exported(f) {
  const result = await f.source.export(f.editor.getSnapshot().document);
  const zip = await JSZip.loadAsync(result.bytes);
  return { result, zip, doc: parse(await zip.file(f.part).async('string')) };
}

it('native anchor-only edits preserve autofit scaling and untouched insets', async () => {
  const f = await fixture();
  try {
    f.editor.dispatch('document.setTextBodyLayout', { objectId: f.object.id, layout: { anchor: 'middle' } });
    const { doc, zip, result } = await exported(f);
    expect(first(doc, 'bodyPr').getAttribute('anchor')).toBe('ctr');
    expect(first(doc, 'bodyPr').getAttribute('lIns')).toBe('12345');
    expect(first(doc, 'normAutofit').getAttribute('fontScale')).toBe('80000');
    expect(first(doc, 'normAutofit').getAttribute('lnSpcReduction')).toBe('15000');
    expect(result.dirtyParts).toContain(f.part);
    expect(await zip.file('unknown/keep.bin').async('uint8array')).toEqual(new Uint8Array([1, 3, 5]));
  } finally { f.close(); }
});

it.each([
  ['anchor', { anchor: null }, doc => expect(first(doc, 'bodyPr').hasAttribute('anchor')).toBe(false)],
  ['inset', { insets: { left: null } }, doc => expect(first(doc, 'bodyPr').hasAttribute('lIns')).toBe(false)],
  ['autofit', { autofit: null }, doc => expect(first(doc, 'normAutofit')).toBeUndefined()],
])('removes imported direct %s on reset while preserving other properties', async (_, layout, check) => {
  const f = await fixture();
  try {
    f.editor.dispatch('document.setTextBodyLayout', { objectId: f.object.id, layout });
    const { doc } = await exported(f); check(doc);
    if (!Object.hasOwn(layout, 'autofit')) expect(first(doc, 'normAutofit').getAttribute('fontScale')).toBe('80000');
    if (!Object.hasOwn(layout, 'anchor')) expect(first(doc, 'bodyPr').getAttribute('anchor')).toBe('t');
  } finally { f.close(); }
});

it('replaces native picture bullet and writes paragraph children in schema order', async () => {
  const f = await fixture();
  try {
    f.editor.dispatch('document.setParagraphFormat', { paragraphId: f.object.text.paragraphs[0].id, format: { bullet: { type: 'none' }, spaceBefore: 12, lineSpacing: 150 } });
    const { doc, result } = await exported(f), props = first(doc, 'pPr');
    expect(first(props, 'buBlip')).toBeUndefined(); expect(first(props, 'buNone')).toBeDefined();
    expect(first(props, 'spcPts').getAttribute('val')).toBe('1200');
    expect(first(props, 'spcPct').getAttribute('val')).toBe('150000');
    expect(first(props, 'defRPr').getAttribute('b')).toBe('1'); expect(first(props, 'ext').getAttribute('uri')).toBe('keep-me');
    const names = [...props.children].map(n => n.localName);
    expect(names).toEqual(['lnSpc', 'spcBef', 'buNone', 'defRPr', 'extLst']);
    expect(result.dirtyParts).toContain(f.part);
  } finally { f.close(); }
});

it('preserves exact native bytes before edits and after undo', async () => {
  const f = await fixture();
  try {
    expect((await f.source.export(f.source.document)).bytes).toEqual(f.original);
    f.editor.dispatch('document.setTextBodyLayout', { objectId: f.object.id, layout: { anchor: 'bottom' } });
    f.editor.undo();
    const { result } = await exported(f); expect(result.bytes).toEqual(f.original); expect(result.dirtyParts).toEqual([]);
  } finally { f.close(); }
});


it('bold-only edits preserve theme color transforms and Latin font metadata', async () => {
  const f = await fixture();
  try {
    const input = parse(await (await JSZip.loadAsync(f.original)).file(f.part).async('string'));
    const fill = serialize(first(first(input, 'r'), 'solidFill'));
    const latin = serialize(first(first(input, 'r'), 'latin'));
    f.editor.dispatch('document.setRunFormat', { runId: f.object.text.paragraphs[0].runs[0].id, format: { bold: true } });
    const { doc } = await exported(f), rPr = first(first(doc, 'r'), 'rPr');
    expect(rPr.getAttribute('b')).toBe('1');
    expect(serialize(first(rPr, 'solidFill'))).toBe(fill);
    expect(serialize(first(rPr, 'latin'))).toBe(latin);
  } finally { f.close(); }
});

it.each([
  ['unknown text container property', o => { o.text.injected = true; }],
  ['unknown paragraph property', o => { o.text.paragraphs[0].style.injected = 'ignored'; }],
  ['modified opaque paragraph attribute', o => { o.text.paragraphs[0].style.rtl = '0'; }],
  ['removed opaque paragraph attribute', o => { delete o.text.paragraphs[0].style.rtl; }],
  ['invalid alignment', o => { o.text.paragraphs[0].style.alignment = 'sideways'; }],
  ['negative spacing', o => { o.text.paragraphs[0].style.spaceBefore = -1; }],
  ['fractional line spacing', o => { o.text.paragraphs[0].style.lineSpacing = 150.5; }],
  ['out of range level', o => { o.text.paragraphs[0].style.level = 9; }],
  ['invalid bullet type', o => { o.text.paragraphs[0].style.bullet = { type: 'external', url: 'https://example.test' }; }],
  ['invalid numbering format', o => { o.text.paragraphs[0].style.bullet = { type: 'number', format: 'madeUp' }; }],
  ['invalid body anchor', o => { o.bodyLayout.anchor = 'sideways'; }],
  ['invalid body wrap', o => { o.bodyLayout.wrap = 'evil'; }],
  ['invalid autofit', o => { o.bodyLayout.autofit = 'growForever'; }],
  ['negative inset', o => { o.bodyLayout.insets.left = -1; }],
  ['fractional inset', o => { o.bodyLayout.insets.left = 1.5; }],
  ['oversized inset', o => { o.bodyLayout.insets.left = 10000001; }],
  ['unknown inset side', o => { o.bodyLayout.insets.diagonal = 1; }],
  ['unknown body key', o => { o.bodyLayout.unknown = true; }],
])('rejects caller tampering: %s', async (_, mutate) => {
  const f = await fixture();
  try {
    const document = structuredClone(f.source.document);
    mutate(document.slides[0].objects.find(o => o.id === f.object.id));
    const rejected = await f.source.export(document).then(() => false, () => true);
    expect(rejected, 'unsupported caller mutation must reject').toBe(true);
    expect((await f.source.export(f.source.document)).bytes).toEqual(f.original);
  } finally { f.close(); }
});

it('authors nested ODP lists with level styles, continuation and numbering suffixes', async () => {
  const { writeOdp } = await import('../packages/odp/src/index.js');
  const { presentationPlugin } = await import('../packages/core/src/document/index.js');
  const source = await openPresentation(await writeOdp({ title: 'Lists', sections: [{ id: 'sec', name: 'S', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] }), { format: 'odp' });
  const editor = createEditor({ document: source.document, plugins: [documentPlugin, presentationPlugin], validateDocument });
  try {
    editor.dispatch('presentation.addObject', { slideId: source.document.slides[0].id, object: { id: 'lists', type: 'text', geometry: { x: 0, y: 0, width: 1000000, height: 1000000 }, extensions: { stagecraftAuthored: true }, text: { paragraphs: [0, 1, 1, 0].map((level, i) => ({ id: `p${i}`, style: { level, bullet: { type: 'number', format: 'arabicParenR' } }, runs: [{ id: `r${i}`, text: `Item ${i}`, editable: true, style: {}, extensions: { stagecraftAuthored: true } }] })) } } });
    const bytes = (await source.export(editor.getSnapshot().document)).bytes;
    const doc = parse(await (await JSZip.loadAsync(bytes)).file('content.xml').async('string'));
    const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', S = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
    const lists = [...doc.getElementsByTagNameNS(T, 'list')];
    expect(lists).toHaveLength(2);
    expect(lists[1].parentNode.parentNode).toBe(lists[0]);
    expect([...lists[0].children].filter(n => n.localName === 'list-item')).toHaveLength(2);
    expect([...lists[1].children]).toHaveLength(2);
    const levels = [...doc.getElementsByTagNameNS(T, 'list-level-style-number')];
    expect(levels.map(n => n.getAttributeNS(T, 'level'))).toEqual(['1','2','3','4','5','6','7','8','9']);
    expect(levels.every(n => n.getAttributeNS(S, 'num-suffix') === ')')).toBe(true);
    expect([...doc.getElementsByTagNameNS(T, 'p')].every(n => !n.hasAttributeNS(T, 'outline-level'))).toBe(true);
  } finally { editor.dispose(); source.dispose(); }
});

it('isolates ODP body layout changes from shared graphic styles and competing shrink settings', async () => {
  const { writeOdp } = await import('../packages/odp/src/index.js');
  const D = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', S = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
  const zip = await JSZip.loadAsync(await writeOdp({ title: 'Shared', sections: [{ id: 'sec', name: 'S', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [0,1].map(i => ({ id: `t${i}`, type: 'text', x: 10, y: 10 + i * 30, w: 100, h: 20, content: `Text ${i}` })) }] }));
  const doc = parse(await zip.file('content.xml').async('string'));
  const frames = [...doc.getElementsByTagNameNS(D, 'frame')];
  const name = 'SharedTestGraphic'; frames.forEach(n => n.setAttributeNS(D, 'draw:style-name', name));
  const style = doc.createElementNS(S, 'style:style'); style.setAttributeNS(S, 'style:name', name); style.setAttributeNS(S, 'style:family', 'graphic');
  const props = doc.createElementNS(S, 'style:graphic-properties'); style.appendChild(props);
  doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'automatic-styles')[0].appendChild(style);
  props.setAttributeNS(D, 'draw:fit-to-size', 'true'); props.setAttributeNS(S, 'style:shrink-to-fit', 'true');
  const preserved = serialize(style);
  zip.file('content.xml', serialize(doc));
  const source = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'odp' });
  const editor = createEditor({ document: source.document, plugins: [documentPlugin], validateDocument });
  try {
    editor.dispatch('document.setTextBodyLayout', { objectId: source.document.slides[0].objects.find(o => o.text).id, layout: { autofit: 'none' } });
    const out = parse(await (await JSZip.loadAsync((await source.export(editor.getSnapshot().document)).bytes)).file('content.xml').async('string'));
    const outputFrames = [...out.getElementsByTagNameNS(D, 'frame')];
    expect(outputFrames[1].getAttributeNS(D, 'style-name')).toBe(name);
    const outputStyles = [...out.getElementsByTagNameNS(S, 'style')];
    expect(serialize(outputStyles.find(n => n.getAttributeNS(S, 'name') === name))).toBe(preserved);
    const patched = outputStyles.find(n => n.getAttributeNS(S, 'name') === outputFrames[0].getAttributeNS(D, 'style-name')).getElementsByTagNameNS(S, 'graphic-properties')[0];
    expect(patched.getAttributeNS(D, 'auto-grow-height')).toBe('false');
    expect(patched.getAttributeNS(D, 'fit-to-size')).toBe('false');
    expect(patched.getAttributeNS(S, 'shrink-to-fit')).toBe('false');
  } finally { editor.dispose(); source.dispose(); }
});


it('inserts changed autofit before 3D and extension body properties without losing them', async () => {
  const f = await fixture();
  try {
    f.editor.dispatch('document.setTextBodyLayout', { objectId: f.object.id, layout: { autofit: 'resize' } });
    const { doc } = await exported(f), body = first(doc, 'bodyPr');
    expect([...body.children].map(n => n.localName)).toEqual(['prstTxWarp','spAutoFit','scene3d','flatTx','extLst']);
    expect(first(body, 'prstTxWarp').getAttribute('prst')).toBe('textNoShape');
    expect(first(body, 'flatTx').getAttribute('z')).toBe('0');
    expect(first(body, 'ext').getAttribute('uri')).toBe('body-keep');
  } finally { f.close(); }
});
