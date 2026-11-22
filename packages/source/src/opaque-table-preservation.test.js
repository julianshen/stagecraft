import JSZip from 'jszip';
import { writeOdp } from '@stagecraft/odp';
import { openPresentation } from './index.js';
import { NS, all } from './xml.js';

const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const serialize = doc => new XMLSerializer().serializeToString(doc);

// Covered cells carry merged-cell semantics readOdpTable cannot faithfully project;
// repetition of them must not be silently dropped into a truncated preview.
const COVERED_TABLES = {
  'covered-cell repetition':
    `<table:table table:name="Covered"><table:table-column/><table:table-column/>` +
    `<table:table-row><table:covered-table-cell table:number-columns-repeated="2"/></table:table-row></table:table>`,
  'non-repeated covered cells':
    `<table:table table:name="Spanned"><table:table-column/><table:table-column/><table:table-column/>` +
    `<table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>Spanning</text:p></table:table-cell>` +
    `<table:covered-table-cell/><table:table-cell><text:p>Tail</text:p></table:table-cell></table:table-row></table:table>`,
};

// Nested cell tables stay outside canonical text preview scope: the outer table may
// project its own canonical rows/text, but the nested table's rows/text must not leak
// into that preview and its native XML must survive unrelated edits untouched.
const NESTED_TABLE =
  `<table:table table:name="Outer"><table:table-column/><table:table-row>` +
  `<table:table-cell><text:p>Outer cell</text:p>` +
  `<table:table table:name="Nested"><table:table-column/><table:table-row>` +
  `<table:table-cell><text:p>Nested content</text:p></table:table-cell>` +
  `</table:table-row></table:table></table:table-cell></table:table-row></table:table>`;

async function fixture(tableXml) {
  const zip = await JSZip.loadAsync(await writeOdp({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [{ id: 'text', type: 'text', x: 100, y: 100, w: 80, h: 80, content: 'Unrelated' }] }] }));
  const doc = parse(await zip.file('content.xml').async('string'));
  const frame = parse(`<draw:frame xmlns:draw="${NS.draw}" xmlns:svg="${NS.svg}" xmlns:table="${NS.table}" xmlns:text="${NS.text}" svg:x="0in" svg:y="0in" svg:width="2in" svg:height="1in">${tableXml}</draw:frame>`).documentElement;
  all(doc, 'draw', 'page')[0].appendChild(doc.importNode(frame, true));
  zip.file('content.xml', serialize(doc));
  return zip.generateAsync({ type: 'uint8array' });
}

it.each(Object.entries(COVERED_TABLES))('retains a table with %s as opaque without losing original XML on unrelated edits', async (_name, tableXml) => {
  const bytes = await fixture(tableXml);
  const session = await openPresentation(bytes, { format: 'odp' });
  let reopened;
  try {
    const object = session.document.slides[0].objects[1];
    expect(object.type).toBe('opaque');
    expect(object.table).toBeUndefined();
    expect(object.text).toBeUndefined();
    expect((await session.export(session.document)).bytes).toEqual(bytes);
    const edited = structuredClone(session.document);
    edited.slides[0].objects[0].geometry.x += 12700;
    const output = await session.export(edited);
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output.bytes);
    const original = parse(await before.file('content.xml').async('string')), result = parse(await after.file('content.xml').async('string'));
    expect(serialize(all(result, 'table', 'table')[0])).toBe(serialize(all(original, 'table', 'table')[0]));
    for (const entry of Object.values(before.files).filter(entry => !entry.dir && entry.name !== 'content.xml'))
      expect(await after.file(entry.name).async('uint8array'), entry.name).toEqual(await entry.async('uint8array'));
    reopened = await openPresentation(output.bytes, { format: 'odp' });
    expect(reopened.document.slides[0].objects[1].type).toBe('opaque');
    expect(reopened.document.slides[0].objects[0].geometry.x).toBe(edited.slides[0].objects[0].geometry.x);
  } finally { reopened?.dispose(); session.dispose(); }
});

it('keeps nested cell table rows/text out of the canonical preview and retains the native XML on unrelated edits', async () => {
  const bytes = await fixture(NESTED_TABLE);
  const session = await openPresentation(bytes, { format: 'odp' });
  let reopened;
  try {
    const object = session.document.slides[0].objects[1];
    expect(object.type).toBe('table');
    expect(object.table.columns).toHaveLength(1);
    expect(object.table.rows).toHaveLength(1);
    const text = object.table.rows[0].cells[0].text.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');
    expect(text).toContain('Outer cell');
    expect(text).not.toContain('Nested content');
    expect((await session.export(session.document)).bytes).toEqual(bytes);
    const edited = structuredClone(session.document);
    edited.slides[0].objects[0].geometry.x += 12700;
    const output = await session.export(edited);
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output.bytes);
    const original = parse(await before.file('content.xml').async('string')), result = parse(await after.file('content.xml').async('string'));
    expect(serialize(all(result, 'table', 'table')[0])).toBe(serialize(all(original, 'table', 'table')[0]));
    for (const entry of Object.values(before.files).filter(entry => !entry.dir && entry.name !== 'content.xml'))
      expect(await after.file(entry.name).async('uint8array'), entry.name).toEqual(await entry.async('uint8array'));
    reopened = await openPresentation(output.bytes, { format: 'odp' });
    expect(reopened.document.slides[0].objects[1].type).toBe('table');
    expect(reopened.document.slides[0].objects[0].geometry.x).toBe(edited.slides[0].objects[0].geometry.x);
  } finally { reopened?.dispose(); session.dispose(); }
});
