import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { writePptx } from '../packages/pptx/src/index.js';
import { openPresentation } from '../packages/source/src/index.js';
import { createEditor } from '../packages/core/src/editor/index.js';
import { documentPlugin, validateDocument } from '../packages/core/src/document/index.js';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const parse = s => new DOMParser().parseFromString(s, 'application/xml');
const serialize = n => new XMLSerializer().serializeToString(n);
const first = (n, name) => n.getElementsByTagNameNS(A, name)[0];
async function fixture({ fill = '<a:solidFill><a:schemeClr val="accent1"><a:alpha val="80000"/><a:lumMod val="60000"/></a:schemeClr></a:solidFill>', font = '+mn-lt' } = {}) {
  const bytes = await writePptx({ title: 'Typography', sections: [{ id: 'sec', name: 'Slides', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [{ id: 't', type: 'text', x: 10, y: 10, w: 300, h: 100, content: 'Native text' }] }] });
  const zip = await JSZip.loadAsync(bytes), part = 'ppt/slides/slide1.xml';
  const doc = parse(await zip.file(part).async('string')), r = first(doc, 'r');
  const before = first(r, 'rPr');
  const replacement = parse(`<a:rPr xmlns:a="${A}" lang="en-US" sz="2400">${fill}<a:latin typeface="${font}" panose="02020603050405020304" pitchFamily="18" charset="0"/><a:ea typeface="CJK Font"/><a:cs typeface="Complex Font"/><a:extLst><a:ext uri="keep"/></a:extLst></a:rPr>`).documentElement;
  if (before) r.replaceChild(doc.importNode(replacement, true), before); else r.insertBefore(doc.importNode(replacement, true), r.firstChild);
  zip.file(part, serialize(doc));
  const original = await zip.generateAsync({ type: 'uint8array' });
  const source = await openPresentation(original, { format: 'pptx' });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin] });
  const run = source.document.slides[0].objects.find(o => o.text).text.paragraphs[0].runs[0];
  return { source, editor, run, original, part, close() { editor.dispose(); source.dispose(); } };
}
async function output(f) {
  const { bytes } = await f.source.export(f.editor.getSnapshot().document);
  const doc = parse(await (await JSZip.loadAsync(bytes)).file(f.part).async('string'));
  const reopened = await openPresentation(bytes, { format: 'pptx' });
  const run = reopened.document.slides[0].objects.find(o => o.text).text.paragraphs[0].runs[0];
  reopened.dispose(); return { doc, run, bytes, props: first(first(doc, 'r'), 'rPr') };
}
const format = (f, value) => f.editor.dispatch('document.setRunFormat', { runId: f.run.id, format: value });

it('imports theme-font aliases and opaque fill sentinels while preserving exact no-op bytes', async () => {
  const f = await fixture();
  try {
    expect(f.run.style).toMatchObject({ typeface: '+mn-lt', color: null });
    expect((await f.source.export(f.source.document)).bytes).toEqual(f.original);
  } finally { f.close(); }
});
it('changes the Latin font while preserving font metadata, other scripts and theme fill', async () => {
  const f = await fixture();
  try {
    format(f, { fontFamily: 'Georgia' }); const { props, run } = await output(f);
    expect(run.style.typeface).toBe('Georgia');
    const latin = first(props, 'latin');
    expect(latin.getAttribute('panose')).toBe('02020603050405020304'); expect(latin.getAttribute('pitchFamily')).toBe('18'); expect(latin.getAttribute('charset')).toBe('0');
    expect(first(props, 'ea').getAttribute('typeface')).toBe('CJK Font'); expect(first(props, 'cs').getAttribute('typeface')).toBe('Complex Font');
    expect(first(props, 'schemeClr').getAttribute('val')).toBe('accent1'); expect(first(props, 'alpha').getAttribute('val')).toBe('80000');
    expect(first(props, 'ext').getAttribute('uri')).toBe('keep');
  } finally { f.close(); }
});
it('resets theme-font and opaque direct fill independently through commands', async () => {
  const f = await fixture();
  try {
    format(f, { fontFamily: null, color: null }); const { props, run } = await output(f);
    expect(first(props, 'latin')).toBeUndefined(); expect(first(props, 'solidFill')).toBeUndefined();
    expect(run.style).not.toHaveProperty('typeface'); expect(run.style).not.toHaveProperty('color');
    expect(first(props, 'ea')).toBeDefined(); expect(first(props, 'cs')).toBeDefined();
  } finally { f.close(); }
});
it.each([
  '<a:noFill/>', '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs></a:gsLst></a:gradFill>',
  '<a:solidFill><a:srgbClr val="112233"><a:alpha val="50000"/></a:srgbClr></a:solidFill>',
  '<a:solidFill><a:sysClr val="windowText" lastClr="000000"/></a:solidFill>',
])('replaces opaque direct fill with RGB in schema order: %s', async fill => {
  const f = await fixture({ fill });
  try {
    format(f, { color: '#aBcDeF', bold: true }); const { props, run } = await output(f);
    expect(run.style.color).toBe('#abcdef'); expect(run.style.b).toBe('1');
    expect([...props.children].map(n => n.localName)).toEqual(['solidFill', 'latin', 'ea', 'cs', 'extLst']);
    expect(first(props, 'srgbClr').getAttribute('val')).toBe('ABCDEF'); expect(first(props, 'alpha')).toBeUndefined();
    format(f, { color: null }); const reset = await output(f); expect(first(reset.props, 'solidFill')).toBeUndefined(); expect(first(reset.props, 'gradFill')).toBeUndefined(); expect(first(reset.props, 'noFill')).toBeUndefined();
  } finally { f.close(); }
});
it('bold-only changes preserve every direct typography child exactly', async () => {
  const f = await fixture();
  try {
    const original = parse(await (await JSZip.loadAsync(f.original)).file(f.part).async('string'));
    const before = [...first(first(original, 'r'), 'rPr').children].map(serialize);
    format(f, { bold: true }); const { props } = await output(f);
    expect([...props.children].map(serialize)).toEqual(before);
  } finally { f.close(); }
});
it.each([{ typeface: '' }, { typeface: 'Bad\nFont' }, { typeface: 42 }, { color: 'red' }, { color: '#abc' }, { color: 42 }, { arbitrary: true }])('rejects direct typography tampering %j', async patch => {
  const f = await fixture();
  try {
    const document = structuredClone(f.source.document);
    Object.assign(document.slides[0].objects.find(o => o.text).text.paragraphs[0].runs[0].style, patch);
    expect(await f.source.export(document).then(() => false, () => true)).toBe(true);
    expect((await f.source.export(f.source.document)).bytes).toEqual(f.original);
  } finally { f.close(); }
});
