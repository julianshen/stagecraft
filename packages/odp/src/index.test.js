import JSZip from 'jszip';
import { describe, it, expect, vi } from 'vitest';
import { odpAdapter, ODP_MIME } from './index.js';

const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
async function fixture(body = '', extras = {}) {
  const zip = new JSZip();
  zip.file('mimetype', ODP_MIME);
  zip.file('META-INF/manifest.xml', '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>');
  zip.file('content.xml', `<office:document-content ${ns}><office:body><office:presentation><draw:page draw:name="Native">${body}</draw:page></office:presentation></office:body></office:document-content>`);
  for (const [path, value] of Object.entries(extras)) zip.file(path, value);
  return zip.generateAsync({ type: 'uint8array' });
}
const deck = () => ({ title: 'Example & title', size: { w: 1920, h: 1440 }, sections: [{ id: 'section', name: 'Slides', slides: ['s'] }], slides: [{ id: 's', title: 'One', layout: 'blank', notes: 'Notes & <text>', elements: [
  { id: 'r', type: 'rect', x: 80, y: 50, w: 300, h: 120, fill: '#123456' },
  { id: 'e', type: 'ellipse', x: 400, y: 50, w: 200, h: 200, fill: '#abcdef' },
  { id: 't', type: 'text', x: 40, y: 320, w: 800, h: 150, content: 'Hello & <world>\n  Again', color: '#112233', fontSize: 64, bold: true, italic: true, fontFamily: 'Arial', align: 'center' },
] }] });

describe('ODP subset adapter', () => {
  it('writes a native ODF package and round trips supported geometry/text/styles/notes', async () => {
    const result = await odpAdapter.export(deck());
    const zip = await JSZip.loadAsync(result.bytes);
    expect(await zip.file('mimetype').async('string')).toBe(ODP_MIME);
    expect(await zip.file('META-INF/manifest.xml').async('string')).toContain(ODP_MIME);
    expect(await zip.file('content.xml').async('string')).toContain('draw:ellipse');
    const imported = await odpAdapter.import(result.bytes);
    expect(imported.document.size.h).toBeCloseTo(1440);
    const slide = imported.document.slides[0];
    expect(slide.notes).toBe('Notes & <text>');
    expect(slide.elements[0]).toMatchObject({ type: 'rect', w: 300, h: 120, fill: '#123456' });
    expect(slide.elements[0].x).toBeCloseTo(80);
    expect(slide.elements[0].y).toBeCloseTo(50);
    expect(slide.elements[2]).toMatchObject({ content: 'Hello & <world>\n  Again', fontSize: 64, color: '#112233', bold: true, italic: true, align: 'center', fontFamily: 'Arial' });
    expect(imported.diagnostics.some(d => d.code === 'subset-import')).toBe(true);
  });
  it('imports a native text frame and reports unsupported images without fetching them', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      const bytes = await fixture('<draw:frame svg:x="1in" svg:y="2cm" svg:width="3in" svg:height="1in"><draw:text-box><text:p>Native<text:s text:c="2"/>text<text:line-break/>next</text:p></draw:text-box></draw:frame><draw:frame><draw:image/></draw:frame>');
      const { document, diagnostics } = await odpAdapter.import(bytes);
      expect(document.slides[0].elements[0].content).toBe('Native  text\nnext');
      expect(diagnostics.some(d => d.code === 'unsupported-object')).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('rejects unsupported export properties and semantic layouts', async () => {
    const doc = deck(); doc.slides[0].layout = 'cover';
    await expect(odpAdapter.export(doc)).rejects.toThrow('layout');
    doc.slides[0].layout = 'blank'; doc.slides[0].elements[0].shadow = {};
    await expect(odpAdapter.export(doc)).rejects.toThrow('shadow');
    delete doc.slides[0].elements[0].shadow; doc.slides[0].elements[0].type = 'image';
    await expect(odpAdapter.export(doc)).rejects.toThrow('image');
  });
  it('rejects invalid MIME, malformed XML, encryption and declarations', async () => {
    await expect(odpAdapter.import(await fixture('', { mimetype: 'application/vnd.oasis.opendocument.text' }))).rejects.toThrow('MIME');
    await expect(odpAdapter.import(await fixture('', { 'content.xml': '<broken>' }))).rejects.toThrow('XML');
    await expect(odpAdapter.import(await fixture('', { 'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:encryption-data/></manifest:manifest>' }))).rejects.toThrow('Encrypted');
    await expect(odpAdapter.import(await fixture('', { 'content.xml': '<!DOCTYPE bad><bad/>' }))).rejects.toThrow('declarations');
  });
  it('honors limits, cancellation and injected XML runtime', async () => {
    const bytes = await fixture();
    await expect(odpAdapter.import(bytes, { maxEntries: 1 })).rejects.toThrow('maxEntries');
    await expect(odpAdapter.import(bytes, { maxEntryBytes: 1 })).rejects.toThrow('limits');
    await expect(odpAdapter.import(bytes, { signal: AbortSignal.abort() })).rejects.toThrow();
    const parse = vi.fn(text => new DOMParser().parseFromString(text, 'application/xml'));
    await odpAdapter.import(bytes, { xml: { parse } });
    expect(parse).toHaveBeenCalled();
    await expect(odpAdapter.export(deck(), { maxBytes: 1 })).rejects.toThrow('maxBytes');
    await expect(odpAdapter.export(deck(), { signal: AbortSignal.abort() })).rejects.toThrow();
  });
  it('bounds repeated-space amplification and preserves large supported whitespace', async () => {
    const frame = text => `<draw:frame svg:x="0in" svg:y="0in" svg:width="1in" svg:height="1in"><draw:text-box><text:p>${text}</text:p></draw:text-box></draw:frame>`;
    await expect(odpAdapter.import(await fixture(frame('<text:s text:c="1001"/>')))).rejects.toThrow('limit');
    await expect(odpAdapter.import(await fixture(frame('<text:s text:c="1000"/>'.repeat(1050))))).rejects.toThrow('character limit');
    const doc = deck(); doc.slides[0].elements[2].content = ' '.repeat(1200) + '\t\r\n';
    const { bytes } = await odpAdapter.export(doc);
    expect((await odpAdapter.import(bytes)).document.slides[0].elements[2].content).toBe(doc.slides[0].elements[2].content);
  });
  it('rejects invalid geometry, colors, text, order and XML characters on export', async () => {
    const mutations = [
      d => { d.slides[0].elements[0].w = -1; },
      d => { d.slides[0].elements[0].fill = 'url(http://example.org)'; },
      d => { d.slides[0].elements[2].content = 4; },
      d => { d.slides[0].elements[2].color = 'red'; },
      d => { d.slides[0].elements[2].align = 'justify'; },
      d => { d.slides[0].elements[2].bold = 'yes'; },
      d => { d.slides[0].elements[2].content = '\u0000'; },
      d => { d.slides[0].elements[2].content = '\ud800'; },
      d => { d.size.w = 100; },
      d => { d.size.h = 0; },
      d => { d.sections[0].slides = []; },
      d => { d.sections[0].slides = ['missing']; },
      d => { d.sections[0].slides = null; },
      d => { d.slides[0].elements = null; },
      d => { d.slides[0].notes = {}; },
      d => { d.slides = null; },
    ];
    for (const mutate of mutations) { const doc = deck(); mutate(doc); await expect(odpAdapter.export(doc)).rejects.toThrow(); }
  });
  it('requires manifest and a namespace-correct presentation body', async () => {
    await expect(odpAdapter.import(await fixture('', { 'META-INF/manifest.xml': '<manifest/>' }))).rejects.toThrow('manifest');
    await expect(odpAdapter.import(await fixture('', { 'content.xml': `<office:document-content ${ns}/>` }))).rejects.toThrow('body');
    await expect(odpAdapter.import(await fixture('', { 'content.xml': '<office:document-content xmlns:office="bad"/>' }))).rejects.toThrow('content');
    const zip = await JSZip.loadAsync(await fixture()); zip.remove('content.xml');
    await expect(odpAdapter.import(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('content');
  });
  it('reports unsupported transformations, invalid geometry, shape text and rich text', async () => {
    const bytes = await fixture('<draw:rect draw:transform="rotate(1)"/><draw:rect/><draw:rect svg:x="0in" svg:y="0in" svg:width="1in" svg:height="1in"><text:p>omitted</text:p></draw:rect><draw:frame svg:x="0in" svg:y="0in" svg:width="1in" svg:height="1in"><draw:text-box><text:p><text:span>rich</text:span></text:p><text:p>second</text:p></draw:text-box></draw:frame>');
    const { document, diagnostics } = await odpAdapter.import(bytes);
    expect(document.slides[0].elements).toHaveLength(2);
    expect(document.slides[0].elements[1].content).toBe('rich\nsecond');
    expect(diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['unsupported-object', 'invalid-geometry', 'unsupported-shape-text', 'flattened-text']));
  });
  it('rejects overflowing page lengths and reports invalid font size instead of producing nonfinite geometry', async () => {
    const source = await odpAdapter.export(deck());
    let zip = await JSZip.loadAsync(source.bytes);
    zip.file('styles.xml', (await zip.file('styles.xml').async('string')).replace('fo:page-width="20in"', `fo:page-width="${'9'.repeat(400)}in"`));
    await expect(odpAdapter.import(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('page dimensions');
    zip = await JSZip.loadAsync(source.bytes);
    zip.file('content.xml', (await zip.file('content.xml').async('string')).replace('fo:font-size="48pt"', `fo:font-size="${'9'.repeat(400)}pt"`));
    const { document, diagnostics } = await odpAdapter.import(await zip.generateAsync({ type: 'uint8array' }));
    expect(document.slides[0].elements[2].fontSize).toBe(48);
    expect(diagnostics.some(d => d.code === 'invalid-font-size')).toBe(true);
  });
});
