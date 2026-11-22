import JSZip from 'jszip';
import { writeOdp } from '@stagecraft/odp';
import { openPresentation } from './index.js';
import { NS, all, attr, child } from './xml.js';

async function fixture() {
  const session = await openPresentation(await writeOdp({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] }), { format: 'odp' });
  try {
    const next = structuredClone(session.document);
    next.slides[0].objects.push({
      id: 'table', type: 'table', geometry: { x: 0, y: 0, width: 2743200, height: 914400 }, extensions: { stagecraftAuthored: true },
      table: { columns: [{ id: 'col1', width: 914400 }, { id: 'col2', width: 1828800 }], rows: [{ id: 'row', cells: [1, 2].map(i => ({
        id: `cell${i}`, text: { paragraphs: [{ id: `p${i}`, runs: [{ id: `r${i}`, text: String(i), editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }] },
      })) }] },
    });
    return (await session.export(next)).bytes;
  } finally { session.dispose(); }
}

it('reopens authored ODP tables with their unequal widths in EMU', async () => {
  const bytes = await fixture();
  const session = await openPresentation(bytes, { format: 'odp' });
  try {
    expect(session.document.slides[0].objects[0].table.columns.map(column => column.width)).toEqual([914400, 1828800]);
    expect((await session.export(session.document)).bytes).toEqual(bytes);
  } finally { session.dispose(); }
});

it.each(['cm', 'mm', 'in', 'pt', 'pc', 'px'])('resolves inherited table-column widths in %s from styles.xml', async unit => {
  const zip = await JSZip.loadAsync(await fixture());
  const parse = text => new DOMParser().parseFromString(text, 'application/xml');
  const content = parse(await zip.file('content.xml').async('string'));
  const styles = parse(await zip.file('styles.xml').async('string'));
  const columns = all(content, 'table', 'table-column');
  const width = { cm: 2.54, mm: 25.4, in: 1, pt: 72, pc: 6, px: 96 }[unit];
  columns.forEach((column, index) => {
    const local = all(content, 'style', 'style').find(node => attr(node, 'style', 'name') === attr(column, 'table', 'style-name'));
    child(local, 'style', 'table-column-properties').removeAttributeNS(NS.style, 'column-width');
    local.setAttributeNS(NS.style, 'style:parent-style-name', `InheritedColumn${index}`);
    const parent = styles.createElementNS(NS.style, 'style:style');
    parent.setAttributeNS(NS.style, 'style:name', `InheritedColumn${index}`);
    parent.setAttributeNS(NS.style, 'style:family', 'table-column');
    const properties = styles.createElementNS(NS.style, 'style:table-column-properties');
    properties.setAttributeNS(NS.style, 'style:column-width', `${width * (index + 1)}${unit}`);
    parent.appendChild(properties);
    child(styles.documentElement, 'office', 'styles').appendChild(parent);
  });
  zip.file('content.xml', new XMLSerializer().serializeToString(content));
  zip.file('styles.xml', new XMLSerializer().serializeToString(styles));
  const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'odp' });
  try {
    expect(session.document.slides[0].objects[0].table.columns.map(column => column.width)).toEqual([914400, 1828800]);
  } finally { session.dispose(); }
});

it.each(['missing', 'percentage', 'negative', 'ambiguous', 'cycle'])('keeps a bounded fallback for %s column widths', async variant => {
  const zip = await JSZip.loadAsync(await fixture());
  const content = new DOMParser().parseFromString(await zip.file('content.xml').async('string'), 'application/xml');
  const column = all(content, 'table', 'table-column')[0];
  const style = all(content, 'style', 'style').find(node => attr(node, 'style', 'name') === attr(column, 'table', 'style-name'));
  const properties = child(style, 'style', 'table-column-properties');
  if (variant === 'ambiguous') style.parentNode.appendChild(style.cloneNode(true));
  else if (variant === 'percentage' || variant === 'negative') properties.setAttributeNS(NS.style, 'style:column-width', variant === 'percentage' ? '25%' : '-1cm');
  else {
    properties.removeAttributeNS(NS.style, 'column-width');
    if (variant === 'cycle') {
      style.setAttributeNS(NS.style, 'style:parent-style-name', attr(style, 'style', 'name'));
      const styles = new DOMParser().parseFromString(await zip.file('styles.xml').async('string'), 'application/xml');
      child(styles.documentElement, 'office', 'styles').appendChild(styles.importNode(style, true));
      zip.file('styles.xml', new XMLSerializer().serializeToString(styles));
    }
  }
  zip.file('content.xml', new XMLSerializer().serializeToString(content));
  const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'odp' });
  try {
    expect(session.document.slides[0].objects[0].table.columns.map(column => column.width)).toEqual([1, 1828800]);
  } finally { session.dispose(); }
});
