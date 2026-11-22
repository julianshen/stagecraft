import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { validateDocument } from '@stagecraft/core/document';
import { openPresentation } from './index.js';
import { all, child, NS } from './xml.js';

async function fixture(paragraphs, notes = false) {
  const deck = new PptxGenJS();
  const slide = deck.addSlide();
  slide.addTable([['Original']], { x: 1, y: 1, w: 4, h: 1 });
  if (notes) slide.addNotes('Original notes');
  const zip = await JSZip.loadAsync(await deck.write({ outputType: 'arraybuffer' }));
  const part = notes ? 'ppt/notesSlides/notesSlide1.xml' : 'ppt/slides/slide1.xml';
  const doc = new DOMParser().parseFromString(await zip.file(part).async('string'), 'application/xml');
  const body = notes
    ? all(doc, 'p', 'sp').filter(sp => child(child(child(sp, 'p', 'nvSpPr'), 'p', 'nvPr'), 'p', 'ph')?.getAttribute('type') === 'body').map(sp => child(sp, 'p', 'txBody'))[0]
    : child(all(doc, 'a', 'tc')[0], 'a', 'txBody');
  for (const p of all(body, 'a', 'p')) p.remove();
  const fragment = new DOMParser().parseFromString(`<root xmlns:a="${NS.a}">${paragraphs}</root>`, 'application/xml');
  for (const p of Array.from(fragment.documentElement.children)) body.appendChild(doc.importNode(p, true));
  zip.file(part, new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: 'uint8array' });
}

const cases = [
  ['soft break', '<a:p><a:pPr/><a:r><a:t>Before</a:t></a:r><a:br/><a:r><a:t>After</a:t></a:r><a:endParaRPr/></a:p>', [['Before', '\n', 'After']]],
  ['mixed field', '<a:p><a:r><a:t>Slide </a:t></a:r><a:fld id="field" type="slidenum"><a:rPr b="1"/><a:t>7</a:t></a:fld><a:r><a:t> end</a:t></a:r></a:p>', [['Slide ', '7', ' end']]],
  ['field only', '<a:p><a:fld id="field" type="slidenum"><a:t>7</a:t></a:fld></a:p>', [['7']]],
  ['empty paragraph', '<a:p><a:r><a:t>Above</a:t></a:r></a:p><a:p><a:pPr/><a:endParaRPr/></a:p><a:p><a:r><a:t>Below</a:t></a:r></a:p>', [['Above'], [], ['Below']]],
];

it.each(cases)('preserves native table %s in read-only canonical runs and exact no-op export', async (_name, xml, expected) => {
  const bytes = await fixture(xml);
  const session = await openPresentation(bytes, { format: 'pptx' });
  try {
    const table = session.document.slides[0].objects.find(object => object.type === 'table');
    const paragraphs = table.table.rows[0].cells[0].text.paragraphs;
    expect(paragraphs.map(p => p.runs.map(r => r.text))).toEqual(expected);
    const runs = paragraphs.flatMap(p => p.runs);
    expect(runs.every(r => r.editable === false)).toBe(true);
    expect(new Set(runs.map(r => r.id)).size).toBe(runs.length);
    expect(validateDocument(session.document)).toBe(true);
    expect((await session.export(session.document)).bytes).toEqual(bytes);
    const edited = structuredClone(session.document);
    edited.slides[0].objects.find(object => object.id === table.id).table.rows[0].cells[0].text.paragraphs[0].runs[0].text = 'Changed';
    await expect(session.export(edited)).rejects.toThrow('Unsupported source document edit');
  } finally { session.dispose(); }
});

it.each(cases)('preserves native notes %s and exact no-op export', async (_name, xml, expected) => {
  const bytes = await fixture(xml, true);
  const session = await openPresentation(bytes, { format: 'pptx' });
  try {
    expect(session.document.slides[0].notes).toBe(expected.map(runs => runs.join('')).join('\n'));
    expect((await session.export(session.document)).bytes).toEqual(bytes);
  } finally { session.dispose(); }
});
