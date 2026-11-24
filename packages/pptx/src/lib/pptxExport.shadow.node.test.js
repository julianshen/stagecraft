// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { writePptx } from './pptxExport.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

async function exportedShadow(element) {
  const deck = {
    title: 'Shadow serialization',
    sections: [{ id: 'section', name: 'Shadows', slides: ['slide'] }],
    slides: [{ id: 'slide', layout: 'blank', elements: [element] }],
  };
  const bytes = await writePptx(deck);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const dom = new JSDOM(xml, { contentType: 'text/xml' });
  try {
    const shadow = dom.window.document.getElementsByTagNameNS(A, 'outerShdw')[0];
    expect(shadow).toBeTruthy();
    const color = shadow.getElementsByTagNameNS(A, 'srgbClr')[0];
    const alpha = color?.getElementsByTagNameNS(A, 'alpha')[0];
    const shape = dom.window.document.getElementsByTagNameNS(P, 'sp')[0];
    const rotation = shape?.getElementsByTagNameNS(A, 'xfrm')[0]?.getAttribute('rot') ?? null;
    return {
      attrs: Object.fromEntries([...shadow.attributes].map(attr => [attr.name, attr.value])),
      color: color?.getAttribute('val') ?? null,
      alpha: alpha?.getAttribute('val') ?? null,
      rotation,
    };
  } finally {
    dom.window.close();
  }
}

const rect = (extra = {}) => ({
  id: 'shadow-rect',
  type: 'rect',
  x: 0,
  y: 0,
  w: 192,
  h: 192,
  fill: '#ffffff',
  ...extra,
});

describe('real pptxgenjs shadow serialization', () => {
  it('serializes a centred sharp glow with zero blur, distance and direction', async () => {
    const shadow = await exportedShadow(rect({ shadow: { color: '#000000', blur: 0, x: 0, y: 0 } }));
    expect(shadow.attrs).toMatchObject({ blurRad: '0', dist: '0', dir: '0', rotWithShape: '0' });
    expect(shadow.color).toBe('000000');
    expect(shadow.alpha).toBe('35000');
  });

  it('serializes a rightward shadow with zero direction and real blur/distance', async () => {
    const shadow = await exportedShadow(rect({ shadow: { color: '#000000', blur: 8, x: 10, y: 0 } }));
    expect(shadow.attrs).toMatchObject({ blurRad: '38100', dist: '47625', dir: '0', rotWithShape: '0' });
    expect(shadow.alpha).toBe('35000');
  });

  it('serializes a sharp downward shadow without defaulting blur to 8pt', async () => {
    const shadow = await exportedShadow(rect({ shadow: { color: '#000000', blur: 0, x: 0, y: 8 } }));
    expect(shadow.attrs).toMatchObject({ blurRad: '0', dist: '38100', dir: '5400000' });
    expect(shadow.alpha).toBe('35000');
  });

  it('bakes element rotation into the absolute shadow direction', async () => {
    const shadow = await exportedShadow(rect({ rot: 45, shadow: { color: '#000000', blur: 8, x: 0, y: 8 } }));
    expect(shadow.rotation).toBe('2700000');
    expect(shadow.attrs).toMatchObject({ blurRad: '38100', dist: '38100', dir: '8100000', rotWithShape: '0' });
    expect(shadow.alpha).toBe('35000');
  });

  it.each([
    [0, '0'],
    [50, '18000'],
    [100, '35000'],
  ])('serializes shadow alpha after dimming by element opacity %i%%', async (opacity, alpha) => {
    const shadow = await exportedShadow(rect({ opacity, shadow: { color: '#000000', blur: 8, x: 0, y: 8 } }));
    expect(shadow.alpha).toBe(alpha);
  });
});
