import JSZip from 'jszip';
import { writeOdp } from '@stagecraft/odp';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, validateDocument } from '@stagecraft/core/document';
import { openPresentation } from './index.js';
import { NS, all, attr, child } from './xml.js';

const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const serialize = doc => new XMLSerializer().serializeToString(doc);
async function fixture(styleName, reserveName = false) {
  const bytes = await writeOdp({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [0, 1].map(i => ({ id: `t${i}`, type: 'text', x: i * 100, y: 0, w: 80, h: 80, content: `Text ${i}` })) }] });
  if (styleName === undefined && !reserveName) return bytes;
  const zip = await JSZip.loadAsync(bytes), doc = parse(await zip.file('content.xml').async('string'));
  if (styleName !== undefined) all(doc, 'draw', 'frame')[0].setAttributeNS(NS.draw, 'draw:style-name', styleName);
  if (reserveName) {
    const styles = parse(await zip.file('styles.xml').async('string'));
    const reserved = styles.createElementNS(NS.style, 'style:style');
    reserved.setAttributeNS(NS.style, 'style:name', 'StagecraftBody1');
    reserved.setAttributeNS(NS.style, 'style:family', 'graphic');
    child(styles.documentElement, 'office', 'styles').appendChild(reserved);
    zip.file('styles.xml', serialize(styles));
  }
  if (styleName === 'Ambiguous') for (let i = 0; i < 2; i++) {
    const style = doc.createElementNS(NS.style, 'style:style');
    style.setAttributeNS(NS.style, 'style:name', styleName);
    style.setAttributeNS(NS.style, 'style:family', 'graphic');
    child(doc.documentElement, 'office', 'automatic-styles').appendChild(style);
  }
  zip.file('content.xml', serialize(doc));
  return zip.generateAsync({ type: 'uint8array' });
}

it.each([[undefined, 'none'], [undefined, 'resize'], ['', 'resize'], [undefined, null], [undefined, 'resize', true]])('exports unstyled ODP frame (%s) autofit %s through the command API', async (styleName, autofit, reserveName) => {
  const bytes = await fixture(styleName, reserveName), session = await openPresentation(bytes, { format: 'odp' });
  const editor = createEditor({ document: session.document, validateDocument, plugins: [documentPlugin] });
  let reopened;
  try {
    const object = session.document.slides[0].objects[0];
    expect(object.bodyLayout).toBeUndefined();
    editor.dispatch('document.setTextBodyLayout', { objectId: object.id, layout: { autofit } });
    const output = await session.export(editor.getSnapshot().document);
    if (autofit === null) {
      expect(output.bytes).toEqual(bytes);
      expect(output.dirtyParts).toEqual([]);
      return;
    }
    reopened = await openPresentation(output.bytes, { format: 'odp' });
    expect(reopened.document.slides[0].objects[0].bodyLayout).toEqual({ autofit });
    expect(reopened.document.slides[0].objects[1]).toEqual(session.document.slides[0].objects[1]);
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output.bytes);
    expect(output.dirtyParts).toEqual(['content.xml']);
    for (const entry of Object.values(before.files).filter(entry => !entry.dir && entry.name !== 'content.xml'))
      expect(await after.file(entry.name).async('uint8array'), entry.name).toEqual(await entry.async('uint8array'));
    const original = parse(await before.file('content.xml').async('string')), result = parse(await after.file('content.xml').async('string'));
    for (const style of all(original, 'style', 'style'))
      expect(serialize(all(result, 'style', 'style').find(n => attr(n, 'style', 'name') === attr(style, 'style', 'name')))).toBe(serialize(style));
    const frames = all(result, 'draw', 'frame'), name = attr(frames[0], 'draw', 'style-name');
    if (reserveName) expect(name).not.toBe('StagecraftBody1');
    const style = all(result, 'style', 'style').find(n => attr(n, 'style', 'name') === name);
    expect(attr(style, 'style', 'family')).toBe('graphic');
    expect(attr(frames[1], 'draw', 'style-name')).toBe('');
  } finally { reopened?.dispose(); editor.dispose(); session.dispose(); }
});

it.each(['Missing', 'Ambiguous'])('rejects an unresolved named ODP frame style: %s', async name => {
  const session = await openPresentation(await fixture(name), { format: 'odp' });
  const editor = createEditor({ document: session.document, validateDocument, plugins: [documentPlugin] });
  try {
    editor.dispatch('document.setTextBodyLayout', { objectId: session.document.slides[0].objects[0].id, layout: { autofit: 'resize' } });
    await expect(session.export(editor.getSnapshot().document)).rejects.toThrow('Unsupported ODP text layout');
  } finally { editor.dispose(); session.dispose(); }
});
