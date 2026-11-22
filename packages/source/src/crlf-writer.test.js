import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { writePptx } from '../../pptx/src/index.js';
import { writeOdp } from '../../odp/src/index.js';
import { openPresentation } from './index.js';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';

// FU-CR: a CRLF split across runs must not double-break. The PPTX writer used to emit a literal
// CR, which every XML parser normalizes to a second LF (an extra blank line); the ODP writer
// emitted two text:line-break elements for the same split.

const authoredText = () => ({
  id: 'crlf', type: 'text', geometry: { x: 12700, y: 25400, width: 1270000, height: 635000 },
  extensions: { stagecraftAuthored: true },
  text: { paragraphs: [{ id: 'crlf-p', runs: [
    { id: 'crlf-r1', text: 'A\r', editable: true, style: {}, extensions: { stagecraftAuthored: true } },
    { id: 'crlf-r2', text: '\nB', editable: true, style: {}, extensions: { stagecraftAuthored: true } },
  ] }] },
});

async function exportedBytes(format) {
  const write = format === 'pptx' ? writePptx : writeOdp;
  const bytes = await write({ title: 'Deck', sections: [{ id: 'sec', name: 'Section', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const source = await openPresentation(bytes, { format });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  try {
    editor.dispatch('presentation.addObject', { slideId: source.document.slides[0].id, object: authoredText() });
    const result = await source.export(editor.getSnapshot().document);
    return { bytes: result.bytes, source };
  } finally { editor.dispose(); }
}

const partFor = format => format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml';

it.each(['pptx', 'odp'])('writes a split CRLF as one native break (%s)', async format => {
  const { bytes, source } = await exportedBytes(format);
  try {
    const xml = await (await JSZip.loadAsync(bytes)).file(partFor(format)).async('string');
    const breaks = xml.match(/<text:line-break/g)?.length ?? 0;
    const cr = xml.match(/&#13;|[\r]/g)?.filter(token => token === '&#13;').length ?? 0;
    if (format === 'pptx') {
      // The CR survives as a character reference: the parser keeps CR and the paired LF in the
      // next run renders as the single native break, never two.
      expect(cr).toBe(1);
      expect(xml.includes('&#13;')).toBe(true);
      expect(/[\r]/.test(xml)).toBe(false);
      expect(breaks).toBe(0);
    } else {
      // ODF has no carriage-return text: one text:line-break for the whole split.
      expect(breaks).toBe(1);
      expect(/[\r]/.test(xml)).toBe(false);
    }
    // Reopen: the folded paragraph text is a single newline, not two. For PPTX the CR is
    // preserved exactly (character reference), so the canonical round-trips unchanged.
    const reopened = await openPresentation(bytes, { format });
    try {
      const runs = reopened.document.slides[0].objects.find(o => o.type === 'text').text.paragraphs[0].runs;
      if (format === 'pptx') {
        expect(runs.map(r => r.text)).toEqual(['A\r', '\nB']);
        // And the reopened document exports byte-identically: the encoding is stable.
        expect((await reopened.export(reopened.document)).bytes).toEqual(new Uint8Array(bytes));
      }
      const folded = runs.map(r => r.text).join('').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      expect(folded).toBe('A\nB');
    } finally { reopened.dispose(); }
  } finally { source.dispose(); }
});

it.each(['pptx', 'odp'])('writes CRLF slide notes as single breaks (%s)', async format => {
  const write = format === 'pptx' ? writePptx : writeOdp;
  const bytes = await write({ title: 'Deck', sections: [{ id: 'sec', name: 'Section', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const source = await openPresentation(bytes, { format });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  let reopened;
  try {
    editor.dispatch('presentation.setSlideProperties', { slideId: source.document.slides[0].id, properties: { notes: 'top\r\nbottom' } });
    const result = await source.export(editor.getSnapshot().document);
    reopened = await openPresentation(result.bytes, { format });
    expect(reopened.document.slides[0].notes).toBe('top\nbottom');
  } finally { editor.dispose(); reopened?.dispose(); source.dispose(); }
});
