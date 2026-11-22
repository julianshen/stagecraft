import JSZip from 'jszip';
import { writePptx } from '@stagecraft/pptx';
import { createEditor } from '@stagecraft/core/editor';
import { presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { openPresentation } from './index.js';
import { createPptxChartParts } from './chart-authoring.js';
import { all } from './xml.js';

const chart = { kind: 'bar', categories: ['A'], series: [{ name: 'Series', values: [2] }] };
const geometry = { x: 0, y: 0, width: 914400, height: 914400 };

it.each(['Slide 1.xml', 'Slide %.xml'])('inserts a chart into an imported decoded slide path %s', async filename => {
  const zip = await JSZip.loadAsync(await writePptx({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] }));
  const part = `ppt/slides/${filename}`, relPart = `ppt/slides/_rels/${filename}.rels`;
  zip.file(part, await zip.file('ppt/slides/slide1.xml').async('uint8array'));
  zip.remove('ppt/slides/slide1.xml');
  zip.file(relPart, await zip.file('ppt/slides/_rels/slide1.xml.rels').async('uint8array'));
  zip.remove('ppt/slides/_rels/slide1.xml.rels');
  for (const entry of Object.values(zip.files).filter(entry => entry.name.endsWith('.rels')))
    zip.file(entry.name, (await entry.async('string')).replaceAll('slides/slide1.xml', `slides/${encodeURIComponent(filename)}`));
  const types = new DOMParser().parseFromString(await zip.file('[Content_Types].xml').async('string'), 'application/xml');
  all(types, 'ct', 'Override').find(n => n.getAttribute('PartName') === '/ppt/slides/slide1.xml').setAttribute('PartName', `/${part}`);
  zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(types));
  const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
  const editor = createEditor({ document: session.document, validateDocument, plugins: [presentationPlugin] });
  let reopened;
  try {
    expect(session.document.slides[0].source.part).toBe(part);
    editor.dispatch('presentation.addObject', { slideId: session.document.slides[0].id, object: { id: 'chart', type: 'chart', geometry, chart, extensions: { stagecraftAuthored: true } } });
    const output = await session.export(editor.getSnapshot().document);
    reopened = await openPresentation(output.bytes, { format: 'pptx' });
    expect(reopened.document.slides[0].objects.find(o => o.type === 'chart').chart).toEqual(chart);
    const after = await JSZip.loadAsync(output.bytes);
    for (const entry of Object.values(zip.files).filter(entry => !entry.dir && ![part, relPart, '[Content_Types].xml'].includes(entry.name)))
      expect(await after.file(entry.name).async('uint8array'), entry.name).toEqual(await entry.async('uint8array'));
  } finally { reopened?.dispose(); editor.dispose(); session.dispose(); }
});

it.each(['../slide.xml', '/ppt/slide.xml', 'ppt//slide.xml', 'ppt/./slide.xml', 'ppt/../slide.xml', 'ppt/slide\\1.xml', 'ppt/slide\u0001.xml', 'ppt/slide?1.xml', 'ppt/slide#1.xml', 'http:slide.xml', 'ppt/Slide%20.xml'])('rejects unsafe or ambiguously encoded chart owner %s', async ownerPart => {
  await expect(createPptxChartParts({ chart, geometry, ownerPart, nonVisualId: 1, usedPartNames: new Set(), usedRelationshipIds: new Set() })).rejects.toThrow('INVALID_CHART_OWNER');
});
