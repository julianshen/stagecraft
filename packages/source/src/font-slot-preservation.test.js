import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { createTextFixture } from '../../../scripts/text-authoring-fixtures.mjs';
import { openPresentation } from './index.js';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, validateDocument } from '@stagecraft/core/document';

const structure = node => ({
  ns: node.namespaceURI, name: node.localName,
  attributes: [...node.attributes].filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/').map(a => [a.namespaceURI, a.localName, a.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  children: [...node.childNodes].map(n => n.nodeType === 1 ? structure(n) : [n.nodeType, n.nodeValue]),
});
const slots = (xml, format) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.getElementsByTagName('*')].filter(n => format === 'pptx'
    ? ['ea', 'cs', 'sym'].includes(n.localName)
    : n.localName === 'font-face' || (n.localName === 'text-properties' && [...n.attributes].some(a => a.localName === 'font-name-asian'))).map(structure);
};
it.each(['pptx', 'odp'].flatMap(format => ['canonical', 'single-quotes', 'entity'].map(spelling => [format, spelling])))(
  'preserves untouched %s script font bytes during a same-part edit (%s)', async (format, spelling) => {
    const { bytes } = await createTextFixture(format);
    const zip = await JSZip.loadAsync(bytes);
    const part = format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml';
    const original = await zip.file(part).async('string');
    const quote = spelling === 'single-quotes' ? "'" : '"';
    const ea = spelling === 'entity' ? '+mj-&#101;a' : '+mj-ea';
    const retained = format === 'pptx'
      ? `<a:ea typeface=${quote}${ea}${quote}/><a:cs typeface=${quote}+mn-cs${quote}/><a:sym typeface=${quote}Wingdings${quote}/>`
      : `style:font-name-asian=${quote}${spelling === 'entity' ? 'Native&#69;A' : 'NativeEA'}${quote} style:font-name-complex=${quote}NativeCS${quote}`;
    let modified = format === 'pptx'
      ? original.replace('</a:rPr>', `${retained}</a:rPr>`)
      : original.replace(/<style:text-properties\b([^>]*?)\/>/, `<style:text-properties$1 ${retained}/>`);
    if (format === 'odp') {
      const faces = '<style:font-face style:name="NativeEA" svg:font-family="Arial"/><style:font-face style:name="NativeCS" svg:font-family="Arial"/>';
      modified = modified.includes('</office:font-face-decls>')
        ? modified.replace('</office:font-face-decls>', `${faces}</office:font-face-decls>`)
        : modified.replace('<office:automatic-styles', `<office:font-face-decls>${faces}</office:font-face-decls><office:automatic-styles`);
    }
    expect(modified).not.toBe(original);
    zip.file(part, modified);
    const input = await zip.generateAsync({ type: 'uint8array' });
    const source = await openPresentation(input, { format });
    const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin] });
    try {
      expect((await source.export(editor.getSnapshot().document)).bytes).toEqual(input);
      const run = source.document.slides[0].objects.flatMap(o => o.text?.paragraphs.flatMap(p => p.runs) ?? [])
        .find(r => r.text.includes('Bullet'));
      expect(run?.editable).toBe(true);
      editor.dispatch('document.setRunText', { runId: run.id, text: 'Changed' });
      const result = await source.export(editor.getSnapshot().document);
      expect(result.dirtyParts).toEqual([part]);
      const outputZip = await JSZip.loadAsync(result.bytes);
      const output = await outputZip.file(part).async('string');
      expect(output).toContain('Changed');
      for (const name of Object.keys(zip.files).filter(name => !zip.files[name].dir && name !== part))
        expect(await outputZip.file(name).async('uint8array'), name).toEqual(await zip.file(name).async('uint8array'));
      expect(slots(output, format)).toEqual(slots(modified, format));
      if (spelling === 'canonical') expect(output).toContain(retained);
    } finally { editor.dispose(); source.dispose(); }
  });
