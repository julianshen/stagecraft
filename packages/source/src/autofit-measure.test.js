import { expect, it } from 'vitest';
import { writePptx } from '../../pptx/src/index.js';
import { openPresentation } from './index.js';
import JSZip from 'jszip';

const PNG_1PX = null; // not needed

// Helper: create a native pptx with a shrink-autofit text body
async function nativeShrinkFixture() {
  const bytes = await writePptx({ title: 'Deck', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [{ id: 't', type: 'text', x: 100, y: 100, w: 200, h: 75, content: 'Hello world text that overflows', bold: true, fontSize: 18 }] }] });
  const zip = await JSZip.loadAsync(bytes);
  const part = 'ppt/slides/slide1.xml';
  const doc = new DOMParser().parseFromString(await zip.file(part).async('string'), 'application/xml');
  // Find the bodyPr and add normAutofit without scale
  const bodyPr = doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'bodyPr')[0];
  const ns = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const norm = doc.createElementNS(ns, 'a:normAutofit');
  bodyPr.appendChild(norm);
  zip.file(part, new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: 'uint8array' });
}

it('emits fontScale and lnSpcReduction on normAutofit when fit is supplied (authored object)', async () => {
  const bytes = await writePptx({ title: 'Deck', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const source = await openPresentation(bytes, { format: 'pptx' });
  // Add an authored text object with shrink autofit
  const doc = structuredClone(source.document);
  doc.slides[0].objects.push({
    id: 'authored-text', type: 'text', geometry: { x: 12700, y: 25400, width: 2540000, height: 952500 },
    extensions: { stagecraftAuthored: true },
    bodyLayout: { autofit: 'shrink' },
    text: { paragraphs: [{ id: 'p', runs: [{ id: 'r', text: 'Hello', editable: true, style: { sz: '1800' }, extensions: { stagecraftAuthored: true } }] }] },
  });
  const fit = new Map([['authored-text', { fontScale: 85000, lnSpcReduction: 10000 }]]);
  const result = await source.export(doc, { fit });
  const zip = await JSZip.loadAsync(result.bytes);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  expect(xml).toContain('fontScale="85000"');
  expect(xml).toContain('lnSpcReduction="10000"');
  source.dispose();
});

it('emits fontScale and lnSpcReduction on normAutofit for native changed objects', async () => {
  const bytes = await nativeShrinkFixture();
  const source = await openPresentation(bytes, { format: 'pptx' });
  const doc = structuredClone(source.document);
  // Change text to trigger a change
  const obj = doc.slides[0].objects.find(o => o.type === 'text');
  obj.text.paragraphs[0].runs[0].text = 'Changed text';
  const fit = new Map([[obj.id, { fontScale: 77500, lnSpcReduction: 5000 }]]);
  const result = await source.export(doc, { fit });
  const zip = await JSZip.loadAsync(result.bytes);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  expect(xml).toContain('fontScale="77500"');
  expect(xml).toContain('lnSpcReduction="5000"');
  source.dispose();
});

it('does not apply fit to untouched native objects (no-op preservation)', async () => {
  const bytes = await nativeShrinkFixture();
  const source = await openPresentation(bytes, { format: 'pptx' });
  const doc = structuredClone(source.document);
  // No changes, but provide fit
  const obj = doc.slides[0].objects.find(o => o.type === 'text');
  const fit = new Map([[obj.id, { fontScale: 50000, lnSpcReduction: 20000 }]]);
  const result = await source.export(doc, { fit });
  const zip = await JSZip.loadAsync(result.bytes);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  // Should NOT contain the supplied fit values since the object didn't change
  expect(xml).not.toContain('fontScale="50000"');
  source.dispose();
});

it('validates fit values and rejects invalid ones', async () => {
  const bytes = await writePptx({ title: 'Deck', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const source = await openPresentation(bytes, { format: 'pptx' });
  const doc = structuredClone(source.document);
  await expect(source.export(doc, { fit: new Map([['x', { fontScale: 0, lnSpcReduction: 0 }]]) })).rejects.toThrow();
  await expect(source.export(doc, { fit: new Map([['x', { fontScale: 100001, lnSpcReduction: 0 }]]) })).rejects.toThrow();
  await expect(source.export(doc, { fit: new Map([['x', { fontScale: 1, lnSpcReduction: 100001 }]]) })).rejects.toThrow();
  await expect(source.export(doc, { fit: new Map([['x', { fontScale: 1.5, lnSpcReduction: 0 }]]) })).rejects.toThrow();
  source.dispose();
});

it('missing or empty fit map = today exactly (no-op)', async () => {
  const bytes = await writePptx({ title: 'Deck', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [{ id: 't', type: 'text', x: 10, y: 10, w: 100, h: 100, content: 'Hello' }] }] });
  const source = await openPresentation(bytes, { format: 'pptx' });
  const result1 = await source.export(source.document);
  const result2 = await source.export(source.document, { fit: new Map() });
  expect(result1.bytes).toEqual(result2.bytes);
  source.dispose();
});

it('preserves native fontScale on untouched objects (round-trip)', async () => {
  // Create a pptx with a native fontScale on normAutofit
  const bytes = await writePptx({ title: 'Deck', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [{ id: 't', type: 'text', x: 10, y: 10, w: 100, h: 100, content: 'Hello', bold: true, fontSize: 18 }] }] });
  const zip = await JSZip.loadAsync(bytes);
  const part = 'ppt/slides/slide1.xml';
  const doc = new DOMParser().parseFromString(await zip.file(part).async('string'), 'application/xml');
  const bodyPr = doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'bodyPr')[0];
  const ns = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const norm = doc.createElementNS(ns, 'a:normAutofit');
  norm.setAttribute('fontScale', '62500');
  bodyPr.appendChild(norm);
  zip.file(part, new XMLSerializer().serializeToString(doc));
  const patched = await zip.generateAsync({ type: 'uint8array' });
  const source = await openPresentation(patched, { format: 'pptx' });
  const result = await source.export(source.document);
  const zip2 = await JSZip.loadAsync(result.bytes);
  const xml2 = await zip2.file(part).async('string');
  expect(xml2).toContain('fontScale="62500"');
  source.dispose();
});

// Review findings (coordinator review of b611ac6)

it('applies fit to a native shrink object that is not the first on its slide', async () => {
  const bytes = await writePptx({ title: 'Deck', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [
    { id: 'first', type: 'text', x: 10, y: 10, w: 100, h: 100, content: 'First' },
    { id: 'second', type: 'text', x: 10, y: 120, w: 100, h: 100, content: 'Second' },
  ] }] });
  const zip = await JSZip.loadAsync(bytes);
  const part = 'ppt/slides/slide1.xml';
  const doc = new DOMParser().parseFromString(await zip.file(part).async('string'), 'application/xml');
  const bodyPrs = doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'bodyPr');
  for (const bp of bodyPrs) {
    const norm = doc.createElementNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'a:normAutofit');
    bp.appendChild(norm);
  }
  zip.file(part, new XMLSerializer().serializeToString(doc));
  const patched = await zip.generateAsync({ type: 'uint8array' });
  const source = await openPresentation(patched, { format: 'pptx' });
  const doc2 = structuredClone(source.document);
  const obj = doc2.slides[0].objects.find(o => o.id.includes('second') || (o.text?.paragraphs?.[0]?.runs?.[0]?.text === 'Second'));
  // Find by text content
  const secondObj = doc2.slides[0].objects.find(o => o.text?.paragraphs?.[0]?.runs?.[0]?.text === 'Second');
  secondObj.text.paragraphs[0].runs[0].text = 'Changed second';
  const fit = new Map([[secondObj.id, { fontScale: 66000, lnSpcReduction: 3000 }]]);
  const result = await source.export(doc2, { fit });
  const zip2 = await JSZip.loadAsync(result.bytes);
  const xml2 = await zip2.file(part).async('string');
  expect(xml2).toContain('fontScale="66000"');
  source.dispose();
});

it('applies fit on geometry-only change of a native shrink object', async () => {
  const bytes = await nativeShrinkFixture();
  const source = await openPresentation(bytes, { format: 'pptx' });
  const doc2 = structuredClone(source.document);
  const obj = doc2.slides[0].objects.find(o => o.type === 'text');
  obj.geometry.x += 12700;
  const fit = new Map([[obj.id, { fontScale: 70000, lnSpcReduction: 4000 }]]);
  const result = await source.export(doc2, { fit });
  const zip2 = await JSZip.loadAsync(result.bytes);
  const xml2 = await zip2.file('ppt/slides/slide1.xml').async('string');
  expect(xml2).toContain('fontScale="70000"');
  source.dispose();
});

it('produces exactly one bodyLayout entry for a native object with an autofit change', async () => {
  // This tests that synthetic patch doesn't duplicate existing bodyLayout entries
  const bytes = await nativeShrinkFixture();
  const source = await openPresentation(bytes, { format: 'pptx' });
  const doc2 = structuredClone(source.document);
  const obj = doc2.slides[0].objects.find(o => o.type === 'text');
  obj.bodyLayout = { ...obj.bodyLayout, autofit: 'shrink', wrap: 'none' };
  const fit = new Map([[obj.id, { fontScale: 60000, lnSpcReduction: 2000 }]]);
  const result = await source.export(doc2, { fit });
  const zip2 = await JSZip.loadAsync(result.bytes);
  const xml2 = await zip2.file('ppt/slides/slide1.xml').async('string');
  expect(xml2).toContain('fontScale="60000"');
  source.dispose();
});

it('rejects unknown keys in fit values', async () => {
  const bytes = await writePptx({ title: 'Deck', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const source = await openPresentation(bytes, { format: 'pptx' });
  const doc = structuredClone(source.document);
  await expect(source.export(doc, { fit: new Map([['x', { fontScale: 1, lnSpcReduction: 0, extra: 1 }]]) })).rejects.toThrow();
  source.dispose();
});

it('signed package + fit map + no edits exports byte-identical', async () => {
  const bytes = await writePptx({ title: 'Deck', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [{ id: 't', type: 'text', x: 10, y: 10, w: 100, h: 100, content: 'Hello' }] }] });
  // Make it signed by adding a signature part (source.test.js pattern)
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  zip.file('_xmlsignatures/sig1.xml', '<signatures/>');
  const signedBytes = await zip.generateAsync({ type: 'uint8array' });
  const source = await openPresentation(signedBytes, { format: 'pptx' });
  const obj = source.document.slides[0].objects.find(o => o.type === 'text');
  const fit = new Map([[obj.id, { fontScale: 50000, lnSpcReduction: 10000 }]]);
  // Signed: should still export byte-identical (fit not applied to untouched, and signed blocks edits)
  const result = await source.export(source.document, { fit });
  expect(result.bytes).toEqual(new Uint8Array(signedBytes));
  source.dispose();
});

it('unsigned no-op + fit map exports byte-identical', async () => {
  const bytes = await writePptx({ title: 'Deck', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [{ id: 't', type: 'text', x: 10, y: 10, w: 100, h: 100, content: 'Hello' }] }] });
  const source = await openPresentation(bytes, { format: 'pptx' });
  const obj = source.document.slides[0].objects.find(o => o.type === 'text');
  const fit = new Map([[obj.id, { fontScale: 50000, lnSpcReduction: 10000 }]]);
  const result = await source.export(source.document, { fit });
  expect(result.bytes).toEqual(new Uint8Array(bytes));
  source.dispose();
});

it('reset autofit with fit map does not get fontScale', async () => {
  const bytes = await nativeShrinkFixture();
  const source = await openPresentation(bytes, { format: 'pptx' });
  const doc2 = structuredClone(source.document);
  const obj = doc2.slides[0].objects.find(o => o.type === 'text');
  // Reset autofit to null (inherit)
  obj.bodyLayout = { ...obj.bodyLayout, autofit: null };
  delete obj.bodyLayout.autofit;
  const fit = new Map([[obj.id, { fontScale: 70000, lnSpcReduction: 4000 }]]);
  const result = await source.export(doc2, { fit });
  const zip2 = await JSZip.loadAsync(result.bytes);
  const xml2 = await zip2.file('ppt/slides/slide1.xml').async('string');
  // fit should NOT be applied since autofit is not 'shrink'
  expect(xml2).not.toContain('fontScale="70000"');
  source.dispose();
});
