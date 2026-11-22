import JSZip from 'jszip';
import { writeOdp } from '@stagecraft/odp';
import { openPresentation } from './index.js';
import { NS, all, attr, child } from './xml.js';

it.each([false, true])('isolates shared graphic style paint edits (also change body layout: %s)', async changeLayout => {
  const slides = ['a', 'b'].map(id => ({ id, layout: 'blank', elements: [0, 1].map(i => ({
    id: `${id}${i}`, type: 'rect', x: i * 100, y: 0, w: 80, h: 80, fill: '#abcdef',
  })) }));
  const zip = await JSZip.loadAsync(await writeOdp({ sections: [{ id: 'sec', slides: ['a', 'b'] }], slides }));
  const parse = text => new DOMParser().parseFromString(text, 'application/xml');
  const serialize = doc => new XMLSerializer().serializeToString(doc);
  const doc = parse(await zip.file('content.xml').async('string'));
  const shapes = all(doc, 'draw', 'rect');
  const name = attr(shapes[0], 'draw', 'style-name');
  const style = all(doc, 'style', 'style').find(node => attr(node, 'style', 'name') === name);
  const properties = child(style, 'style', 'graphic-properties');
  properties.setAttributeNS(NS.draw, 'draw:opacity', '75%');
  properties.setAttributeNS(NS.svg, 'svg:stroke-width', '0.1cm');
  for (const shape of shapes) shape.setAttributeNS(NS.draw, 'draw:style-name', name);
  const paragraph = doc.createElementNS(NS.text, 'text:p');
  paragraph.textContent = 'Shape text';
  shapes[0].appendChild(paragraph);
  const originalStyle = serialize(style);
  zip.file('content.xml', serialize(doc));
  const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'odp' });
  let reopened;
  try {
    const edited = structuredClone(session.document);
    edited.slides[0].objects[0].fill = '#112233';
    if (changeLayout) edited.slides[0].objects[0].bodyLayout = { autofit: 'resize' };
    const output = await session.export(edited);
    reopened = await openPresentation(output.bytes, { format: 'odp' });
    expect(reopened.document.slides.flatMap(slide => slide.objects.map(object => object.fill))).toEqual(['#112233', '#abcdef', '#abcdef', '#abcdef']);
    const result = parse(await (await JSZip.loadAsync(output.bytes)).file('content.xml').async('string'));
    const resultShapes = all(result, 'draw', 'rect');
    const styles = all(result, 'style', 'style');
    expect(serialize(styles.find(node => attr(node, 'style', 'name') === name))).toBe(originalStyle);
    const newName = attr(resultShapes[0], 'draw', 'style-name');
    expect(newName).not.toBe(name);
    expect(resultShapes.slice(1).map(node => attr(node, 'draw', 'style-name'))).toEqual([name, name, name]);
    const newProperties = child(styles.find(node => attr(node, 'style', 'name') === newName), 'style', 'graphic-properties');
    expect(attr(newProperties, 'draw', 'opacity')).toBe('75%');
    expect(attr(newProperties, 'svg', 'stroke-width')).toBe('0.1cm');
    if (changeLayout) expect(reopened.document.slides[0].objects[0].bodyLayout).toEqual({ autofit: 'resize' });
  } finally { session.dispose(); reopened?.dispose(); }
});
