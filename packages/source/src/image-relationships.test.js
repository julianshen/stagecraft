import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { writePptx } from '@stagecraft/pptx';
import { openPresentation } from './index.js';
import { NS } from './xml.js';

it('reuses a same-asset internal image relationship while preserving external image relationships', async () => {
  const zip = await JSZip.loadAsync(await writePptx({
    sections: [{ id: 'section', slides: ['slide'] }], slides: [{ id: 'slide', layout: 'blank', elements: [] }],
  }));
  const relPart = 'ppt/slides/_rels/slide1.xml.rels';
  const rels = new DOMParser().parseFromString(await zip.file(relPart).async('string'), 'application/xml');
  const external = rels.createElementNS(NS.rel, 'Relationship');
  for (const [key, value] of Object.entries({ Id: 'external-image', Type: `${NS.r}/image`, TargetMode: 'External', Target: 'https://example.com/image.png' })) external.setAttribute(key, value);
  rels.documentElement.appendChild(external);
  zip.file(relPart, new XMLSerializer().serializeToString(rels));
  const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  const asset = session.registerImage({ bytes: png });
  const next = structuredClone(session.document);
  next.assets.push({ id: asset.assetId, extensions: { stagecraftAuthored: true, contentType: asset.contentType } });
  for (const id of ['first-image', 'second-image']) next.slides[0].objects.push({
    id, type: 'image', geometry: { x: 0, y: 0, width: 9525, height: 9525 },
    image: { assetId: asset.assetId }, extensions: { stagecraftAuthored: true },
  });
  const result = await session.export(next);
  const output = await JSZip.loadAsync(result.bytes);
  const written = new DOMParser().parseFromString(await output.file(relPart).async('string'), 'application/xml');
  const imageRels = Array.from(written.documentElement.children).filter(node => node.getAttribute('Type') === `${NS.r}/image`);
  expect(imageRels.filter(node => node.getAttribute('TargetMode') !== 'External')).toHaveLength(1);
  expect(imageRels.find(node => node.getAttribute('TargetMode') === 'External')?.getAttribute('Target')).toBe('https://example.com/image.png');
  expect((await openPresentation(result.bytes, { format: 'pptx' })).document.slides[0].objects.filter(object => object.type === 'image')).toHaveLength(2);
});
