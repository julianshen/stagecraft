import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { writeOdp } from '@stagecraft/odp';
import { createEditor } from '@stagecraft/core/editor';
import { presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { openPresentation } from './index.js';
import { NS, all, child } from './xml.js';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWMkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
async function authoredFixture() {
  const source = await openPresentation(await writeOdp({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] }), { format: 'odp' });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [presentationPlugin] });
  try {
    const image = source.registerImage({ bytes: PNG, contentType: 'image/png' });
    editor.dispatch('presentation.addImage', { slideId: source.document.slides[0].id,
      object: { id: 'image', type: 'image', geometry: { x: 0, y: 0, width: 914400, height: 914400 }, extensions: { stagecraftAuthored: true }, image: { assetId: image.assetId, alt: 'Authored picture 😀 & detail' } },
      asset: { id: image.assetId, contentType: image.contentType },
    });
    return (await source.export(editor.getSnapshot().document)).bytes;
  } finally { editor.dispose(); source.dispose(); }
}

it.each(['authored', 'native', 'empty', 'absent', 'nested'])('preserves ODP image alt semantics for %s title and exact no-op bytes', async variant => {
  let bytes = await authoredFixture();
  const expected = variant === 'authored' ? 'Authored picture 😀 & detail' : variant === 'native' ? ' Native\ttitle\n😀 ' : undefined;
  if (variant !== 'authored') {
    const zip = await JSZip.loadAsync(bytes);
    const doc = new DOMParser().parseFromString(await zip.file('content.xml').async('string'), 'application/xml');
    const frame = all(doc, 'draw', 'frame').find(n => child(n, 'draw', 'image'));
    child(frame, 'svg', 'title').remove();
    if (variant !== 'absent') {
      const title = doc.createElementNS(NS.svg, 'svg:title');
      title.textContent = variant === 'nested' ? 'Unrelated nested title' : expected ?? '';
      (variant === 'nested' ? child(frame, 'draw', 'image') : frame).appendChild(title);
    }
    zip.file('content.xml', new XMLSerializer().serializeToString(doc));
    bytes = await zip.generateAsync({ type: 'uint8array' });
  }
  const source = await openPresentation(bytes, { format: 'odp' });
  try {
    const image = source.document.slides[0].objects.find(o => o.type === 'image');
    expect(image.image.alt).toBe(expected);
    expect(Object.hasOwn(image.image, 'alt')).toBe(expected !== undefined);
    expect((await source.export(source.document)).bytes).toEqual(bytes);
  } finally { source.dispose(); }
});
