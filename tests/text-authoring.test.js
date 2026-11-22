import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { createTextFixture } from '../scripts/text-authoring-fixtures.mjs';
import { openPresentation } from '../packages/source/src/index.js';
import { createEditor } from '../packages/core/src/editor/index.js';
import { documentPlugin, validateDocument } from '../packages/core/src/document/index.js';

const textOf = object => object.text.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');

it.each(['pptx', 'odp'])('exports command-authored text formatting and preserves reopened %s bytes', async format => {
  const result = await createTextFixture(format);
  const source = await openPresentation(result.bytes, { format });
  try {
    const text = source.document.slides[0].objects.filter(o => o.text);
    expect(text.map(textOf)).toEqual(['Text editing acceptance', 'Plain left middle right', 'Bullet item\nNumbered item\nTwo  spaces\tand tab']);
    const original = result.document.slides[0].objects.find(o => o.id === 'range');
    expect(original.text.paragraphs[0].runs.map(r => r.text)).toEqual(['Plain ', 'left ', 'middle', ' right']);
    expect(original.text.paragraphs[0].runs.map(r => r.style.color)).toEqual([undefined, '#cc3300', '#cc3300', undefined]);
    expect((await source.export(source.document)).bytes).toEqual(result.bytes);
    // Native encoding checks complement reader self-consistency; Office checks use the same fixture.
    const zip = await JSZip.loadAsync(result.bytes);
    const native = await zip.file(format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml').async('string');
    const doc = new DOMParser().parseFromString(native, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    if (format === 'pptx') {
      const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
      expect([...doc.getElementsByTagNameNS(drawing, 'latin')].map(n => n.getAttribute('typeface'))).toContain('Georgia');
      expect([...doc.getElementsByTagNameNS(drawing, 'srgbClr')].map(n => n.getAttribute('val').toLowerCase())).toContain('cc3300');
      expect(doc.getElementsByTagNameNS(drawing, 'buChar')[0].getAttribute('char')).toBe('•');
      expect(doc.getElementsByTagNameNS(drawing, 'buAutoNum')[0].getAttribute('type')).toBe('arabicPeriod');
      expect(doc.getElementsByTagNameNS(drawing, 'spAutoFit')).toHaveLength(1);
    } else {
      const textNs = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
      expect(doc.getElementsByTagNameNS(textNs, 'list-level-style-bullet').length).toBeGreaterThan(0);
      expect(doc.getElementsByTagNameNS(textNs, 'list-level-style-number').length).toBeGreaterThan(0);
      expect(native).toContain('Georgia');
      expect(native.toLowerCase()).toContain('#cc3300');
    }
  } finally { source.dispose(); }
});

it('keeps reopened ODP list runs editable while retaining native list structure', async () => {
  const result = await createTextFixture('odp');
  const source = await openPresentation(result.bytes, { format: 'odp' });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin] });
  try {
    const object = source.document.slides[0].objects.find(o => o.text?.paragraphs.some(p => p.runs.map(r => r.text).join('') === 'Bullet item'));
    const paragraph = object.text.paragraphs[0];
    expect(paragraph.style).toMatchObject({ bullet: { type: 'char', char: '•' }, lineSpacing: 150, spaceAfter: 8 });
    expect(object.text.paragraphs[1].style.bullet).toEqual({ type: 'number', format: 'arabicPeriod' });
    const run = paragraph.runs.find(r => r.text.startsWith('Bullet'));
    editor.dispatch('document.setRunText', { runId: run.id, text: run.text.replace('Bullet', 'Changed') });
    const exported = await source.export(editor.getSnapshot().document);
    const reopened = await openPresentation(exported.bytes, { format: 'odp' });
    try {
      expect(reopened.document.slides[0].objects.map(o => o.text && textOf(o))).toContain('Changed item\nNumbered item\nTwo  spaces\tand tab');
      const zip = await JSZip.loadAsync(exported.bytes);
      const xml = new DOMParser().parseFromString(await zip.file('content.xml').async('string'), 'application/xml');
      const page = xml.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'page')[0];
      expect(page.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'list')).toHaveLength(2);
    } finally { reopened.dispose(); }
    editor.undo(); expect((await source.export(editor.getSnapshot().document)).bytes).toEqual(result.bytes);
  } finally { editor.dispose(); source.dispose(); }
});
