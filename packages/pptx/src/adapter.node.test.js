// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { pptxAdapter, writePptx } from './index.js';
import { importDocument, exportDocument } from '@stagecraft/io';
const deck = { title: 'Headless', sections: [{ id: 'section', name: 'One', slides: ['slide'] }], slides: [
  { id: 'slide', layout: 'blank', elements: [
    { id: 'one', type: 'rect', x: 10, y: 10, w: 100, h: 100, fill: '#ff0000', groupId: 'g', gradient: { from: '#ff0000', to: '#0000ff', angle: 45 } },
    { id: 'two', type: 'rect', x: 120, y: 10, w: 100, h: 100, fill: '#0000ff', groupId: 'g' },
  ] },
] };
describe('Node PPTX adapter', () => {
  it('writes bytes, patches groups/gradients and imports using an explicit local XML runtime', async () => {
    expect(typeof document).toBe('undefined');
    expect(typeof DOMParser).toBe('undefined');
    const window = new JSDOM('').window;
    const xml = { parse: text => new window.DOMParser().parseFromString(text, 'application/xml'), serialize: doc => new window.XMLSerializer().serializeToString(doc) };
    try {
      const { bytes, metadata, diagnostics } = await exportDocument(deck, { adapter: pptxAdapter, xml });
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(metadata.format).toBe('pptx');
      expect(metadata.fileName).toBe('Headless.pptx');
      expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'source-not-preserved', severity: 'warning' }));
      const zip = await JSZip.loadAsync(bytes);
      const slide = await zip.file('ppt/slides/slide1.xml').async('string');
      expect(slide).toContain('<p:grpSp>');
      expect(slide).toContain('<a:gradFill');
      const result = await importDocument(bytes, { adapter: pptxAdapter, xml });
      expect(result.document.title).toBe('Headless');
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'conversion-subset', severity: 'warning' }));
      expect(result.document.slides).toHaveLength(1);
      expect(result.document.slides[0].elements).toHaveLength(2);
      expect(typeof document).toBe('undefined');
    } finally { window.close(); }
  });
  it('reports a missing XML runtime instead of silently dropping postprocessing', async () => {
    await expect(writePptx(deck)).rejects.toThrow('XML runtime');
  });
  it('rejects malicious XML before calling the injected parser', async () => {
    const zip = new JSZip(); zip.file('ppt/presentation.xml', '<!DOCTYPE p [<!ENTITY x "x">]><p/>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    let calls = 0;
    await expect(pptxAdapter.import(bytes, { xml: { parse: () => { calls++; } } })).rejects.toThrow('DTD');
    expect(calls).toBe(0);
  });
});
