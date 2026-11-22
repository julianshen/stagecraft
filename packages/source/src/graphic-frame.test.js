import JSZip from 'jszip';
import { writePptx } from '@stagecraft/pptx';
import { createEditor } from '@stagecraft/core/editor';
import { validateDocument, presentationPlugin } from '@stagecraft/core/document';
import { openPresentation } from './index.js';
import { all, child, NS } from './xml.js';

it.each(['table', 'chart'])('edits imported native %s graphic-frame geometry without rewriting other parts', async type => {
  const seed = await openPresentation(await writePptx({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] }), { format: 'pptx' });
  const authored = structuredClone(seed.document);
  const object = { id: 'frame', type, geometry: { x: 0, y: 0, width: 6000000, height: 3000000 }, extensions: { stagecraftAuthored: true } };
  if (type === 'chart') object.chart = { kind: 'bar', categories: ['A'], series: [{ name: 'Series', values: [2] }] };
  else object.table = {
    columns: [{ id: 'col', width: 6000000 }],
    rows: [{ id: 'row', cells: [{ id: 'cell', text: { paragraphs: [{ id: 'p', runs: [{ id: 'r', text: 'Cell', editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }] } }] }],
  };
  authored.slides[0].objects.push(object);
  const original = (await seed.export(authored)).bytes;
  seed.dispose();
  const session = await openPresentation(original, { format: 'pptx' });
  const editor = createEditor({ document: session.document, validateDocument, plugins: [presentationPlugin] });
  let reopened;
  try {
    const slide = session.document.slides[0], imported = slide.objects[0];
    expect(imported.type).toBe(type);
    expect(imported.extensions.editableGeometry).toBe(true);
    const geometry = { x: 12700, y: 25400, width: 5000000, height: 2500000, rotation: type === 'table' ? 15 : 0 };
    editor.dispatch('presentation.setGeometry', { slideId: slide.id, objectId: imported.id, geometry });
    const output = await session.export(editor.getSnapshot().document);
    reopened = await openPresentation(output.bytes, { format: 'pptx' });
    expect(reopened.document.slides[0].objects[0].geometry).toEqual(geometry);
    const before = await JSZip.loadAsync(original), after = await JSZip.loadAsync(output.bytes);
    expect(output.dirtyParts).toEqual([slide.source.part]);
    for (const entry of Object.values(before.files).filter(entry => !entry.dir && entry.name !== slide.source.part)) {
      expect(await after.file(entry.name).async('uint8array'), entry.name).toEqual(await entry.async('uint8array'));
    }
    const doc = new DOMParser().parseFromString(await after.file(slide.source.part).async('string'), 'application/xml');
    const frame = all(doc, 'p', 'graphicFrame')[0];
    const transform = child(frame, 'p', 'xfrm');
    expect(transform.getAttribute('rot')).toBe(String(geometry.rotation * 60000));
    expect(child(transform, 'a', 'off').namespaceURI).toBe(NS.a);
    expect(child(transform, 'a', 'ext').namespaceURI).toBe(NS.a);
    expect(child(frame, 'p', 'spPr')).toBeUndefined();
  } finally { session.dispose(); editor.dispose(); reopened?.dispose(); }
});
