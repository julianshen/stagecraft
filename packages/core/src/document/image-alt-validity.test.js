import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { createEditor } from '../editor/index.js';
import { presentationPlugin, validateDocument } from './index.js';
import { writePptx } from '@stagecraft/pptx';
import { writeOdp } from '@stagecraft/odp';
import { openPresentation } from '@stagecraft/source';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWMkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
it.each([['pptx', 'addImage'], ['pptx', 'addObject'], ['odp', 'addImage'], ['odp', 'addObject']])(
  'rejects invalid alt text atomically for %s %s and exports valid Unicode', async (format, method) => {
    const source = await openPresentation(await (format === 'pptx' ? writePptx : writeOdp)({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] }), { format });
    const registered = source.registerImage({ bytes: PNG, contentType: 'image/png' });
    const asset = { id: registered.assetId, contentType: registered.contentType };
    const document = structuredClone(source.document);
    if (method === 'addObject') document.assets.push({ id: asset.id, extensions: { stagecraftAuthored: true, contentType: asset.contentType } });
    const editor = createEditor({ document, validateDocument, plugins: [presentationPlugin] });
    try {
      const command = presentationPlugin.commands.find(c => c.id === `presentation.${method}`);
      const payload = alt => ({ slideId: document.slides[0].id, object: {
        id: 'image', type: 'image', geometry: { x: 0, y: 0, width: 914400, height: 914400 },
        extensions: { stagecraftAuthored: true }, image: { assetId: asset.id, alt },
      }, ...(method === 'addImage' ? { asset } : {}) });
      const before = editor.getSnapshot();
      for (const alt of ['\ufffe', '\uffff', '\ud800', '\udfff', '\0', '\t', '\n', '\u007f', 'x'.repeat(513)]) {
        expect(command.validate(payload(alt))).toBe(false);
        expect(() => editor.dispatch(command.id, payload(alt))).toThrow();
        expect(editor.getSnapshot()).toBe(before);
        expect(editor.getSnapshot().canUndo).toBe(false);
      }
      const alt = 'A picture 😀 & <detail> \u{10ffff}';
      editor.dispatch(command.id, payload(alt));
      const output = await source.export(editor.getSnapshot().document);
      const reopened = await openPresentation(output.bytes, { format });
      try {
        const image = reopened.document.slides[0].objects.find(o => o.type === 'image');
        expect(image).toBeDefined();
        expect(image.image.alt).toBe(alt);
        const zip = await JSZip.loadAsync(output.bytes);
        const xml = new DOMParser().parseFromString(await zip.file(format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml').async('string'), 'application/xml');
        expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
        if (format === 'odp') expect(xml.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0', 'title')[0].textContent).toBe(alt);
      } finally { reopened.dispose(); }
      editor.undo();
      expect(editor.getSnapshot().document).toEqual(before.document);
    } finally { editor.dispose(); source.dispose(); }
  });
