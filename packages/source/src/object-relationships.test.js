import JSZip from 'jszip';
import { writePptx } from '@stagecraft/pptx';
import { openPresentation } from './index.js';
import { all } from './xml.js';

it.each(['image', 'chart', 'both'])('persists new %s relationships when an existing slide has no relationships part', async kind => {
  const zip = await JSZip.loadAsync(await writePptx({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] }));
  const relPart = 'ppt/slides/_rels/slide1.xml.rels';
  zip.remove(relPart);
  const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
  let reopened;
  try {
    const next = structuredClone(session.document);
    const geometry = { x: 12700, y: 25400, width: 1000000, height: 1000000 };
    if (kind !== 'chart') {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWMkAAAAASUVORK5CYII='), char => char.charCodeAt(0));
      const image = session.registerImage({ bytes });
      next.assets.push({ id: image.assetId, extensions: { stagecraftAuthored: true, contentType: image.contentType } });
      next.slides[0].objects.push({ id: 'image', type: 'image', geometry, extensions: { stagecraftAuthored: true }, image: { assetId: image.assetId } });
    }
    if (kind !== 'image') next.slides[0].objects.push({
      id: 'chart', type: 'chart', geometry, extensions: { stagecraftAuthored: true },
      chart: { kind: 'bar', categories: ['A'], series: [{ name: 'Series', values: [2] }] },
    });
    if (kind === 'both') next.slides[0].notes = 'Notes added with image and chart';
    const output = await session.export(next);
    const exported = await JSZip.loadAsync(output.bytes);
    const relations = all(new DOMParser().parseFromString(await exported.file(relPart).async('string'), 'application/xml'), 'rel', 'Relationship');
    expect(relations.map(node => node.getAttribute('Type').split('/').pop()).sort()).toEqual(kind === 'both' ? ['chart', 'image', 'notesSlide'] : [kind]);
    expect(new Set(relations.map(node => node.getAttribute('Id'))).size).toBe(relations.length);
    expect(output.dirtyParts).toContain(relPart);
    reopened = await openPresentation(output.bytes, { format: 'pptx' });
    expect(reopened.document.slides[0].objects.map(object => object.type).sort()).toEqual(kind === 'both' ? ['chart', 'image'] : [kind]);
    if (kind === 'both') expect(reopened.document.slides[0].notes).toBe('Notes added with image and chart');
    if (kind !== 'chart') {
      const image = reopened.document.slides[0].objects.find(object => object.type === 'image');
      expect(reopened.getImage(image.image.assetId).contentType).toBe('image/png');
    }
  } finally { session.dispose(); reopened?.dispose(); }
});
