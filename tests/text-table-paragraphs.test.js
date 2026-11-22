import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { writeOdp } from '../packages/odp/src/index.js';
import { openPresentation } from '../packages/source/src/index.js';
import { createEditor } from '../packages/core/src/editor/index.js';
import { documentPlugin, presentationPlugin, validateDocument } from '../packages/core/src/document/index.js';
const text = ['First  item', 'Nested\titem', 'Nested\nnext', 'Last item'];
async function authoredTable() {
  const source = await openPresentation(await writeOdp({ title: 'Cell lists', sections: [{ id: 'sec', name: 'S', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] }), { format: 'odp' });
  const editor = createEditor({ document: source.document, plugins: [documentPlugin, presentationPlugin], validateDocument });
  try {
    editor.dispatch('presentation.addObject', { slideId: source.document.slides[0].id, object: { id: 'table', type: 'table', geometry: { x: 0, y: 0, width: 1000000, height: 1000000 }, extensions: { stagecraftAuthored: true }, table: {
      columns: [{ id: 'col', width: 1000000 }], rows: [{ id: 'row', cells: [{ id: 'cell', text: { paragraphs: text.map((value, i) => ({ id: `p${i}`, runs: [{ id: `r${i}`, text: value, editable: true, style: {}, extensions: { stagecraftAuthored: true } }] })) } }] }]
    } } });
    for (const [i, level] of [0, 1, 1, 0].entries()) editor.dispatch('document.setParagraphFormat', { paragraphId: `p${i}`, format: { bullet: { type: 'number', format: 'arabicPeriod' }, level } });
    return (await source.export(editor.getSnapshot().document)).bytes;
  } finally { editor.dispose(); source.dispose(); }
}
const cellParagraphs = source => source.document.slides[0].objects.find(o => o.table).table.rows[0].cells[0].text.paragraphs;
it('reopens authored ODP table-cell lists in order without losing whitespace or enabling native edits', async () => {
  const bytes = await authoredTable(), source = await openPresentation(bytes, { format: 'odp' });
  try {
    const paragraphs = cellParagraphs(source);
    expect(paragraphs.map(p => p.runs.map(r => r.text).join(''))).toEqual(text);
    expect(paragraphs.flatMap(p => p.runs).every(r => r.editable === false)).toBe(true);
    expect(new Set(paragraphs.map(p => p.id)).size).toBe(4);
    expect((await source.export(source.document)).bytes).toEqual(bytes);
  } finally { source.dispose(); }
});
it('reads list headers but excludes paragraphs from unrelated nested objects', async () => {
  const zip = await JSZip.loadAsync(await authoredTable());
  const doc = new DOMParser().parseFromString(await zip.file('content.xml').async('string'), 'application/xml');
  const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', D = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
  const list = doc.getElementsByTagNameNS(T, 'list')[0], header = doc.createElementNS(T, 'text:list-header'), p = doc.createElementNS(T, 'text:p');
  p.textContent = 'List heading'; header.appendChild(p); list.insertBefore(header, list.firstChild);
  const unrelated = doc.createElementNS(D, 'draw:frame'), hidden = doc.createElementNS(T, 'text:p'); hidden.textContent = 'Not cell text'; unrelated.appendChild(hidden); list.parentNode.appendChild(unrelated);
  zip.file('content.xml', new XMLSerializer().serializeToString(doc));
  const source = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'odp' });
  try { expect(cellParagraphs(source).map(p => p.runs.map(r => r.text).join(''))).toEqual(['List heading', ...text]); }
  finally { source.dispose(); }
});
