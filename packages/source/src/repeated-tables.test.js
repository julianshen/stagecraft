import JSZip from 'jszip';
import { writeOdp } from '@stagecraft/odp';
import { openPresentation } from './index.js';
import { NS, all } from './xml.js';

const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const serialize = doc => new XMLSerializer().serializeToString(doc);
async function fixture(kind, count, wrapper) {
  const zip = await JSZip.loadAsync(await writeOdp({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [{ id: 'text', type: 'text', x: 100, y: 100, w: 80, h: 80, content: 'Unrelated' }] }] }));
  const doc = parse(await zip.file('content.xml').async('string'));
  const frame = parse(`<draw:frame xmlns:draw="${NS.draw}" xmlns:svg="${NS.svg}" xmlns:table="${NS.table}" xmlns:text="${NS.text}" svg:x="0in" svg:y="0in" svg:width="2in" svg:height="1in"><table:table table:name="Repeated"><table:table-column/><table:table-row><table:table-cell><text:p>Retained cell</text:p></table:table-cell></table:table-row></table:table></draw:frame>`).documentElement;
  const attribute = kind === 'table-row' ? 'number-rows-repeated' : 'number-columns-repeated';
  all(frame, 'table', kind)[0].setAttributeNS(NS.table, `table:${attribute}`, count);
  if (wrapper) {
    const table = all(frame, 'table', 'table')[0];
    const container = frame.ownerDocument.createElementNS(NS.table, `table:${wrapper}`);
    const wrapped = all(frame, 'table', kind)[0].cloneNode(true);
    const paragraph = all(wrapped, 'text', 'p')[0];
    if (paragraph) paragraph.textContent = 'Wrapped cell';
    container.appendChild(wrapped);
    table.insertBefore(container, table.firstChild);
  }
  all(doc, 'draw', 'page')[0].appendChild(doc.importNode(frame, true));
  zip.file('content.xml', serialize(doc));
  return zip.generateAsync({ type: 'uint8array' });
}

it.each([
  ...['table-row', 'table-column', 'table-cell'].map(kind => [kind, '3']),
  ...['table-header-rows', 'table-rows', 'table-row-group'].map(wrapper => ['table-row', '1', wrapper]),
  ...['table-header-columns', 'table-columns', 'table-column-group'].map(wrapper => ['table-column', '1', wrapper]),
])('retains %s repetition %s wrapper %s as opaque through no-op and unrelated edits', async (kind, count, wrapper) => {
  const bytes = await fixture(kind, count, wrapper);
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

it.each(['table-row', 'table-column', 'table-cell'])('accepts explicit unit repetition on %s', async kind => {
  const session = await openPresentation(await fixture(kind, '1'), { format: 'odp' });
  try { expect(session.document.slides[0].objects[1].type).toBe('table'); }
  finally { session.dispose(); }
});
