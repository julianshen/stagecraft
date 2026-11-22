import JSZip from 'jszip';
import { writePptx } from '@stagecraft/pptx';
import { openPresentation } from './index.js';

it('reads native PPTX image alternative text and retains it after export/reopen', async () => {
  const bytes = await writePptx({
    sections: [{ id: 'sec', slides: ['s'] }],
    slides: [{ id: 's', layout: 'blank', elements: [{
      id: 'image', type: 'image', x: 0, y: 0, w: 100, h: 100,
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWMkAAAAASUVORK5CYII=',
    }] }],
  });
  const zip = await JSZip.loadAsync(bytes);
  const part = 'ppt/slides/slide1.xml';
  const slide = new DOMParser().parseFromString(await zip.file(part).async('string'), 'application/xml');
  const ns = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  slide.getElementsByTagNameNS(ns, 'pic')[0].getElementsByTagNameNS(ns, 'cNvPr')[0].setAttribute('descr', 'Accessible diagram');
  zip.file(part, new XMLSerializer().serializeToString(slide));
  const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
  let reopened;
  try {
    expect(session.document.slides[0].objects.find(object => object.type === 'image').image.alt).toBe('Accessible diagram');
    const output = await session.export(session.document);
    reopened = await openPresentation(output.bytes, { format: 'pptx' });
    expect(reopened.document.slides[0].objects.find(object => object.type === 'image').image.alt).toBe('Accessible diagram');
  } finally {
    session.dispose();
    reopened?.dispose();
  }
});
