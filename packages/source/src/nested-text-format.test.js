import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { createTextFixture } from '../../../scripts/text-authoring-fixtures.mjs';
import { openPresentation } from './index.js';
import { NS } from './xml.js';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, validateDocument } from '@stagecraft/core/document';

const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const serialize = doc => new XMLSerializer().serializeToString(doc);
const descendants = objects => objects.flatMap(o => [o, ...descendants(o.children ?? [])]);
const findText = document => [...document.slides, ...document.layouts, ...document.masters]
  .flatMap(owner => descendants(owner.objects ?? []))
  .find(o => o.text?.paragraphs.some(p => p.runs.map(r => r.text).join('') === 'Text editing acceptance'));

async function fixture(format, owner) {
  const { bytes } = await createTextFixture(format);
  const zip = await JSZip.loadAsync(bytes);
  const slidePart = format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml';
  const slide = parse(await zip.file(slidePart).async('string'));
  const node = [...slide.getElementsByTagNameNS(NS[format === 'pptx' ? 'p' : 'draw'], format === 'pptx' ? 'sp' : 'frame')]
    .find(n => n.textContent.replace(/\s/g, '').includes('Texteditingacceptance'));
  let part = slidePart;
  let doc = slide;
  if (owner === 'group') {
    const group = doc.createElementNS(NS[format === 'pptx' ? 'p' : 'draw'], format === 'pptx' ? 'p:grpSp' : 'draw:g');
    node.parentNode.insertBefore(group, node);
    group.appendChild(node);
  } else {
    part = format === 'pptx' ? `ppt/${owner === 'layout' ? 'slideLayouts/slideLayout' : 'slideMasters/slideMaster'}1.xml` : 'styles.xml';
    doc = parse(await zip.file(part).async('string'));
    const parent = doc.getElementsByTagNameNS(NS[format === 'pptx' ? 'p' : 'style'], format === 'pptx' ? 'spTree' : 'master-page')[0];
    parent.appendChild(doc.importNode(node, true));
    if (format === 'odp') {
      const name = node.getAttributeNS(NS.draw, 'style-name');
      const style = [...slide.getElementsByTagNameNS(NS.style, 'style')].find(n => n.getAttributeNS(NS.style, 'name') === name);
      doc.getElementsByTagNameNS(NS.office, 'styles')[0].appendChild(doc.importNode(style, true));
      // Exercise a legal styles.xml with no automatic styles: page layouts can live in content.xml.
      const automatic = doc.getElementsByTagNameNS(NS.office, 'automatic-styles')[0];
      if (automatic) {
        const contentStyles = slide.getElementsByTagNameNS(NS.office, 'automatic-styles')[0];
        for (const child of [...automatic.children]) contentStyles.appendChild(slide.importNode(child, true));
        automatic.remove();
      }
    }
    node.remove();
    zip.file(slidePart, serialize(slide));
  }
  zip.file(part, serialize(doc));
  return { bytes: await zip.generateAsync({ type: 'uint8array' }), part };
}

it.each([['pptx', 'group'], ['pptx', 'layout'], ['pptx', 'master'], ['odp', 'group'], ['odp', 'master']])(
  'exports mapped %s %s text formatting without expanding structural or geometry edits', async (format, owner) => {
    const { bytes, part } = await fixture(format, owner);
    const source = await openPresentation(bytes, { format });
    const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin] });
    try {
      const object = findText(source.document);
      expect(object).toBeDefined();
      if (format === 'pptx') editor.dispatch('document.setParagraphFormat', { paragraphId: object.text.paragraphs[0].id, format: { alignment: 'right', spaceAfter: 19 } });
      editor.dispatch('document.setTextBodyLayout', { objectId: object.id, layout: { autofit: 'resize' } });
      const result = await source.export(editor.getSnapshot().document);
      expect(result.dirtyParts).toEqual([part]);
      const reopened = await openPresentation(result.bytes, { format });
      try {
        const actual = findText(reopened.document);
        expect(actual.bodyLayout.autofit).toBe('resize');
        if (format === 'pptx') expect(actual.text.paragraphs[0].style).toMatchObject({ alignment: 'right', spaceAfter: 19 });
      } finally { reopened.dispose(); }
      const originalZip = await JSZip.loadAsync(bytes), exportedZip = await JSZip.loadAsync(result.bytes);
      if (format === 'odp' && owner === 'master') {
        const native = parse(await exportedZip.file(part).async('string'));
        const sections = [...native.documentElement.children].map(n => n.localName);
        expect(sections.indexOf('automatic-styles')).toBeLessThan(sections.indexOf('master-styles'));
      }
      for (const name of Object.keys(originalZip.files).filter(name => !originalZip.files[name].dir && name !== part))
        expect(await exportedZip.file(name).async('uint8array'), name).toEqual(await originalZip.file(name).async('uint8array'));
      const geometryChange = structuredClone(source.document);
      findText(geometryChange).geometry.x += 12700;
      await expect(source.export(geometryChange)).rejects.toThrow();
      const fillChange = structuredClone(source.document);
      findText(fillChange).fill = '#123456';
      await expect(source.export(fillChange)).rejects.toThrow();
      const structuralChange = structuredClone(source.document);
      const owners = [...structuralChange.slides, ...structuralChange.layouts, ...structuralChange.masters];
      const container = owner === 'group' ? owners.flatMap(o => o.objects ?? []).find(o => o.children)?.children : owners.find(o => o.objects?.some(n => n.id === object.id)).objects;
      container.splice(container.findIndex(o => o.id === object.id), 1);
      await expect(source.export(structuralChange)).rejects.toThrow();
      editor.undo();
      if (format === 'pptx') editor.undo();
      expect((await source.export(editor.getSnapshot().document)).bytes).toEqual(bytes);
    } finally { editor.dispose(); source.dispose(); }
  });
