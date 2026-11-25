import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { writeOdp } from '@stagecraft/odp';
import { odfText, readOdp, readOdpTable } from './odp.js';
import { NS, runtime } from './xml.js';

const XLINK = 'http://www.w3.org/1999/xlink';
const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const serialize = doc => new XMLSerializer().serializeToString(doc);
const deck = { sections: [{ id: 'section', slides: ['slide'] }], slides: [{ id: 'slide', layout: 'blank', elements: [{ id: 'text', type: 'text', x: 0, y: 0, w: 2000, h: 1000, content: 'Editable' }] }] };
const namespaces = `xmlns:office="${NS.office}" xmlns:text="${NS.text}" xmlns:draw="${NS.draw}" xmlns:style="${NS.style}" xmlns:svg="${NS.svg}" xmlns:table="${NS.table}" xmlns:presentation="${NS.presentation}" xmlns:fo="${NS.fo}" xmlns:xlink="${XLINK}"`;

function element(doc, ns, name, attributes = {}) {
  const node = doc.createElementNS(NS[ns], `${ns}:${name}`);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('xlink:')) node.setAttributeNS(XLINK, key, value);
    else if (key.includes(':')) node.setAttributeNS(NS[key.split(':')[0]], key, value);
    else node.setAttribute(key, value);
  }
  return node;
}
function appendMarkup(doc, parent, markup) {
  const wrapper = parse(`<wrapper ${namespaces}>${markup}</wrapper>`).documentElement;
  for (const node of Array.from(wrapper.childNodes)) parent.appendChild(doc.importNode(node, true));
}
async function fixture(change) {
  const zip = await JSZip.loadAsync(await writeOdp(deck));
  const content = parse(await zip.file('content.xml').async('string'));
  const styles = parse(await zip.file('styles.xml').async('string'));
  await change?.(zip, content, styles);
  zip.file('content.xml', serialize(content));
  zip.file('styles.xml', serialize(styles));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
const read = async bytes => {
  const zip = await JSZip.loadAsync(bytes);
  return readOdp(zip, runtime(), new Map());
};
const page = doc => doc.getElementsByTagNameNS(NS.draw, 'page')[0];
const paragraph = doc => doc.getElementsByTagNameNS(NS.text, 'p')[0];
const automaticStyles = doc => doc.getElementsByTagNameNS(NS.office, 'automatic-styles')[0];

it('expands CDATA, tabs, breaks and nested spans without treating comments as text', () => {
  const node = parse(`<text:p xmlns:text="${NS.text}">A<![CDATA[B]]><!--ignored--><text:tab/><text:line-break/><text:span>C</text:span></text:p>`).documentElement;
  expect(odfText(node)).toBe('AB\t\nC');
});

it.each(['table-header-rows', 'table-rows', 'table-row-group', 'table-header-columns', 'table-columns', 'table-column-group'])('retains tables with wrapped %s instead of dropping their content', name => {
  const frame = parse(`<draw:frame xmlns:draw="${NS.draw}" xmlns:table="${NS.table}"><table:table><table:table-column/><table:${name}/></table:table></draw:frame>`).documentElement;
  expect(readOdpTable(frame, 'content.xml')).toBeNull();
});

it.each([
  ['table-row', 'number-rows-repeated'], ['table-column', 'number-columns-repeated'],
  ['table-cell', 'number-columns-repeated'], ['covered-table-cell', 'number-columns-repeated'],
])('retains repeated native %s structures', (name, attribute) => {
  const frame = parse(`<draw:frame xmlns:draw="${NS.draw}" xmlns:table="${NS.table}"><table:table><table:table-column/><table:table-row><table:table-cell><table:${name} table:${attribute}="2"/></table:table-cell></table:table-row></table:table></draw:frame>`).documentElement;
  expect(readOdpTable(frame, 'content.xml')).toBeNull();
});

it('resolves inherited table-column widths and bounds cyclic or invalid style chains', () => {
  const frame = parse(`<draw:frame xmlns:draw="${NS.draw}" xmlns:table="${NS.table}" xmlns:style="${NS.style}"><table:table><table:table-column table:style-name="Column"/><table:table-row><table:table-cell/></table:table-row></table:table></draw:frame>`).documentElement;
  const style = (parent, width) => parse(`<style:style xmlns:style="${NS.style}" style:parent-style-name="${parent}"><style:table-column-properties style:column-width="${width}"/></style:style>`).documentElement;
  const column = style('Parent', ''), parent = style('', '2cm');
  expect(readOdpTable(frame, 'content.xml', (_part, _family, name) => ({ Column: column, Parent: parent })[name]).columns[0].width).toBe(720000);
  expect(readOdpTable(frame, 'content.xml', (_part, _family, name) => ({ Column: column, Parent: style('Column', '') })[name]).columns[0].width).toBe(1);
  expect(readOdpTable(frame, 'content.xml', () => style('', 'bogus')).columns[0].width).toBe(1);
});

it('projects inherited bullet and numbered list levels while resetting list headers', async () => {
  const bytes = await fixture((_zip, doc) => {
    const listStyle = element(doc, 'text', 'list-style', { 'style:name': 'List' });
    listStyle.append(element(doc, 'text', 'list-level-style-bullet', { 'text:level': '1', 'text:bullet-char': '•' }));
    listStyle.append(element(doc, 'text', 'list-level-style-number', { 'text:level': '2', 'style:num-format': '1', 'style:num-suffix': ')' }));
    automaticStyles(doc).appendChild(listStyle);
    const box = doc.getElementsByTagNameNS(NS.draw, 'text-box')[0];
    box.replaceChildren();
    appendMarkup(doc, box, '<text:list text:style-name="List"><text:list-item><text:p>Outer</text:p><text:list><text:list-item><text:p>Nested</text:p><text:list-header><text:p>Header</text:p></text:list-header></text:list-item></text:list></text:list-item></text:list>');
  });
  const paragraphs = (await read(bytes)).slides[0].objects[0].text.paragraphs;
  expect(paragraphs.map(item => item.style)).toMatchObject([
    { level: 0, bullet: { type: 'char', char: '•' } },
    { level: 1, bullet: { type: 'number', format: 'arabicParenR' } },
    {},
  ]);
});

it('projects all supported native number formats through nested lists', async () => {
  const bytes = await fixture((_zip, doc) => {
    const listStyle = element(doc, 'text', 'list-style', { 'style:name': 'Numbers' });
    for (const [level, format] of ['1', 'a', 'A', 'i', 'I'].entries()) listStyle.append(element(doc, 'text', 'list-level-style-number', { 'text:level': String(level + 1), 'style:num-format': format }));
    automaticStyles(doc).appendChild(listStyle);
    const box = doc.getElementsByTagNameNS(NS.draw, 'text-box')[0];
    box.replaceChildren();
    let markup = '';
    for (let depth = 4; depth >= 0; depth--) markup = `<text:list text:style-name="${depth === 0 ? 'Numbers' : ''}"><text:list-item><text:p>Level ${depth}</text:p>${markup}</text:list-item></text:list>`;
    appendMarkup(doc, box, markup);
  });
  const styles = (await read(bytes)).slides[0].objects[0].text.paragraphs.map(item => item.style);
  expect(styles.map(style => style.bullet.format)).toEqual(['arabicPeriod', 'lowerAlphaPeriod', 'upperAlphaPeriod', 'lowerRomanPeriod', 'upperRomanPeriod']);
  expect(styles.map(style => style.level)).toEqual([0, 1, 2, 3, 4]);
});

it('ignores ambiguous, unknown and incomplete list-style definitions', async () => {
  const bytes = await fixture((_zip, doc) => {
    const styles = automaticStyles(doc);
    for (const name of ['Ambiguous', 'Ambiguous', 'Unknown', 'MissingLevel']) {
      const listStyle = element(doc, 'text', 'list-style', { 'style:name': name });
      if (name === 'Unknown') listStyle.append(element(doc, 'text', 'list-level-style-number', { 'text:level': '1', 'style:num-format': 'native' }));
      if (name === 'MissingLevel') listStyle.append(element(doc, 'text', 'list-level-style-bullet', { 'text:level': '2', 'text:bullet-char': '*' }));
      styles.appendChild(listStyle);
    }
    const box = doc.getElementsByTagNameNS(NS.draw, 'text-box')[0];
    box.replaceChildren();
    for (const name of ['Ambiguous', 'Unknown', 'MissingLevel', 'Absent']) appendMarkup(doc, box, `<text:list text:style-name="${name}"><text:list-item><text:p>${name}</text:p></text:list-item></text:list>`);
  });
  const styles = (await read(bytes)).slides[0].objects[0].text.paragraphs.map(item => item.style);
  expect(styles.every(style => style.bullet === undefined)).toBe(true);
  expect(styles.map(style => style.level)).toEqual([0, 0, 0, 0]);
});

it('inherits paragraph styles across parts and ignores cycles and unsupported lengths', async () => {
  const bytes = await fixture((_zip, content, styles) => {
    const local = automaticStyles(content);
    const first = element(content, 'style', 'style', { 'style:name': 'First', 'style:family': 'paragraph', 'style:parent-style-name': 'Second' });
    const second = element(styles, 'style', 'style', { 'style:name': 'Second', 'style:family': 'paragraph', 'style:parent-style-name': 'Second' });
    const shared = element(styles, 'style', 'style', { 'style:name': 'Shared', 'style:family': 'paragraph' });
    shared.appendChild(element(styles, 'style', 'paragraph-properties', { 'fo:text-align': 'center' }));
    const properties = element(styles, 'style', 'paragraph-properties', { 'fo:text-align': 'justify', 'fo:margin-top': '12pt', 'fo:margin-bottom': '2mm', 'fo:margin-left': '1cm', 'fo:margin-right': 'bogus', 'fo:text-indent': '3px', 'fo:line-height': '125%' });
    second.appendChild(properties);
    local.appendChild(first);
    styles.getElementsByTagNameNS(NS.office, 'automatic-styles')[0].append(second, shared);
    const original = paragraph(content);
    original.setAttributeNS(NS.text, 'text:style-name', 'First');
    const fallback = element(content, 'text', 'p', { 'text:style-name': 'Shared' });
    fallback.textContent = 'Fallback';
    original.parentNode.appendChild(fallback);
  });
  const document = await read(bytes);
  const paragraphs = document.slides[0].objects[0].text.paragraphs;
  expect(paragraphs[0].style).toMatchObject({ alignment: 'justify', spaceBefore: 12, indentStart: 360000, firstLineIndent: 28575, lineSpacing: 125 });
  expect(paragraphs[0].style.spaceAfter).toBeCloseTo(72000 / 12700);
  expect(paragraphs[0].style.indentEnd).toBeUndefined();
  expect(paragraphs[1].style.alignment).toBe('center');
});

it('bounds paragraph list nesting and aggregate text expansion', async () => {
  const nested = await fixture((_zip, doc) => {
    const box = doc.getElementsByTagNameNS(NS.draw, 'text-box')[0];
    box.replaceChildren();
    appendMarkup(doc, box, '<text:list>'.repeat(130) + '<text:p>Hidden</text:p>' + '</text:list>'.repeat(130));
  });
  await expect(read(nested)).rejects.toThrow('ODP list nesting limit');
  const oversized = await fixture((_zip, doc) => {
    const box = doc.getElementsByTagNameNS(NS.draw, 'text-box')[0];
    box.replaceChildren();
    for (let index = 0; index < 2; index++) {
      const p = element(doc, 'text', 'p'); p.textContent = 'x'.repeat(600000); box.appendChild(p);
    }
  });
  await expect(read(oversized)).rejects.toThrow('ODP text expansion limit');
});

it('distinguishes empty, CDATA, styled whitespace and opaque element text runs', async () => {
  const bytes = await fixture((_zip, doc) => {
    const box = doc.getElementsByTagNameNS(NS.draw, 'text-box')[0];
    box.replaceChildren();
    appendMarkup(doc, box, '<text:p/><text:p><![CDATA[Data]]><text:s text:c="2" text:style-name="Styled"/><text:s/><draw:frame><text:p>Opaque</text:p></draw:frame><!--ignored--></text:p>');
  });
  const paragraphs = (await read(bytes)).slides[0].objects[0].text.paragraphs;
  expect(paragraphs[0].runs[0]).toMatchObject({ text: '', editable: true });
  expect(paragraphs[1].runs.map(run => [run.text, run.editable])).toEqual([['Data', true], ['  ', false], [' ', true], ['Opaque', false]]);
});

it.each([
  ['%E0%A4%A', /encoding/], ['../Pictures/one.png', /escapes package/], ['/Pictures/one.png', /Unsafe/],
  ['Pictures//one.png', /Ambiguous/], ['Pictures/%252Fone.png', /Unsafe/], ['Pictures/missing.png', /Missing/],
  ['Pictures/one.png?query', /Unsafe/],
])('rejects unsafe or unresolved embedded image reference %s', async (href, message) => {
  const bytes = await fixture((zip, doc) => {
    zip.file('Pictures/one.png', new Uint8Array([1, 2, 3]));
    appendMarkup(doc, page(doc), `<draw:frame><draw:image xlink:href="${href}"/></draw:frame>`);
  });
  await expect(read(bytes)).rejects.toThrow(message);
});

it.each(['image', 'object', 'object-ole'])('requires an href or embedded binary data for draw:%s', async name => {
  const bytes = await fixture((_zip, doc) => appendMarkup(doc, page(doc), `<draw:frame><draw:${name}/></draw:frame>`));
  await expect(read(bytes)).rejects.toThrow('Missing ODP embedded href');
});

it('retains inline binary media without inventing a package relationship', async () => {
  const bytes = await fixture((_zip, doc) => appendMarkup(doc, page(doc), '<draw:frame><draw:image><office:binary-data>AQID</office:binary-data></draw:image></draw:frame>'));
  const document = await read(bytes);
  expect(document.relationships.filter(relationship => relationship.type === 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0#image')).toEqual([]);
  expect(document.assets).toEqual([]);
});

it.each([
  ['Pictures/./one.png', 'internal', 'Pictures/one.png'],
  ['Pictures/sub/../one.png', 'internal', 'Pictures/one.png'],
  ['Pictures/', 'internal', 'Pictures'],
  ['https://example.invalid/image.png', 'external', 'https://example.invalid/image.png'],
  ['//cdn.invalid/image.png', 'external', '//cdn.invalid/image.png'],
])('classifies embedded media href %s as %s', async (href, mode, target) => {
  const bytes = await fixture((zip, doc) => {
    zip.file('Pictures/one.png', new Uint8Array([1, 2, 3]));
    appendMarkup(doc, page(doc), `<draw:frame><draw:image xlink:href="${href}"/></draw:frame>`);
  });
  const document = await read(bytes), relationship = document.relationships.find(item => item.type.endsWith('#image'));
  expect(relationship).toMatchObject({ mode, target });
  if (target === 'Pictures') expect(document.assets[0].extensions.directory).toBe(true);
});

it('retains fragment and external hyperlinks without fetching them', async () => {
  const bytes = await fixture((_zip, doc) => appendMarkup(doc, paragraph(doc), '<text:a xlink:href="#target">Inside</text:a><text:a xlink:href="mailto:test@example.invalid">Mail</text:a>'));
  const relationships = (await read(bytes)).relationships.filter(item => item.type.endsWith('#a'));
  expect(relationships).toMatchObject([
    { mode: 'internal', target: 'content.xml', extensions: { fragment: 'target' } },
    { mode: 'external', target: 'mailto:test@example.invalid' },
  ]);
});

it('keeps every media asset on a frame and reads native image alternative text', async () => {
  const bytes = await fixture((zip, doc) => {
    zip.file('Pictures/one.png', new Uint8Array([1, 2, 3]));
    appendMarkup(doc, page(doc), '<draw:frame><draw:image xlink:href="Pictures/one.png"/><draw:image xlink:href="https://example.invalid/two.png"/><svg:title>Diagram</svg:title></draw:frame>');
  });
  const object = (await read(bytes)).slides[0].objects.at(-1);
  expect(object.type).toBe('image');
  expect(object.extensions.assetIds).toHaveLength(2);
  expect(object.image).toMatchObject({ assetId: object.assetId, alt: 'Diagram' });
});

it('projects only unambiguous solid graphic styles and frame autofit', async () => {
  const bytes = await fixture((_zip, doc) => {
    const style = element(doc, 'style', 'style', { 'style:name': 'Graphic', 'style:family': 'graphic' });
    style.appendChild(element(doc, 'style', 'graphic-properties', { 'draw:fill': 'solid', 'draw:fill-color': '#A1B2C3', 'draw:auto-grow-height': 'false' }));
    automaticStyles(doc).appendChild(style);
    appendMarkup(doc, page(doc), '<draw:rect draw:style-name="Graphic"/><draw:frame draw:style-name="Graphic"/>');
  });
  const objects = (await read(bytes)).slides[0].objects.slice(-2);
  expect(objects[0]).toMatchObject({ type: 'shape', shape: 'rect', fill: '#A1B2C3', extensions: { editableFill: true } });
  expect(objects[1].bodyLayout).toEqual({ autofit: 'none' });
});

it('rejects a solid page background when a competing gradient is present', async () => {
  const bytes = await fixture((_zip, doc) => {
    const style = element(doc, 'style', 'style', { 'style:name': 'Page', 'style:family': 'drawing-page' });
    style.appendChild(element(doc, 'style', 'drawing-page-properties', { 'draw:fill': 'solid', 'draw:fill-color': '#123456', 'draw:fill-gradient-name': 'Gradient' }));
    automaticStyles(doc).appendChild(style);
    page(doc).setAttributeNS(NS.draw, 'draw:style-name', 'Page');
  });
  expect((await read(bytes)).slides[0].background).toBeUndefined();
});

it('reads notes from the nested notes frame and ignores non-notes frames', async () => {
  const bytes = await fixture((_zip, doc) => appendMarkup(doc, page(doc), '<presentation:notes><draw:frame presentation:class="other"><draw:text-box><text:p>Ignore</text:p></draw:text-box></draw:frame><draw:g><draw:frame presentation:class="notes"><draw:text-box><text:p>First</text:p><text:h>Second</text:h></draw:text-box></draw:frame></draw:g></presentation:notes>'));
  expect((await read(bytes)).slides[0].notes).toBe('First\nSecond');
});

it('falls back to a notes container without a notes frame without inventing notes', async () => {
  const bytes = await fixture((_zip, doc) => appendMarkup(doc, page(doc), '<presentation:notes><text:p>Unresolved notes</text:p></presentation:notes>'));
  expect((await read(bytes)).slides[0].notes).toBeUndefined();
});

it('reads master graphic styles from styles.xml and refuses invalid or competing fills', async () => {
  const bytes = await fixture((_zip, _doc, styles) => {
    const automatic = styles.getElementsByTagNameNS(NS.office, 'automatic-styles')[0];
    for (const [name, colour, competing] of [['MasterGraphic', '#123456', false], ['InvalidGraphic', 'not-a-colour', false], ['CompetingGraphic', '#654321', true]]) {
      const style = element(styles, 'style', 'style', { 'style:name': name, 'style:family': 'graphic' });
      const properties = element(styles, 'style', 'graphic-properties', { 'draw:fill': 'solid', 'draw:fill-color': colour });
      if (competing) properties.setAttributeNS(NS.draw, 'draw:fill-gradient-name', 'Gradient');
      style.appendChild(properties); automatic.appendChild(style);
    }
    const master = styles.getElementsByTagNameNS(NS.style, 'master-page')[0];
    for (const name of ['MasterGraphic', 'InvalidGraphic', 'CompetingGraphic']) master.appendChild(element(styles, 'draw', 'rect', { 'draw:style-name': name }));
  });
  const objects = (await read(bytes)).masters[0].objects;
  expect(objects[0]).toMatchObject({ fill: '#123456', extensions: { editableFill: true } });
  expect(objects[1].fill).toBeUndefined();
  expect(objects[1].extensions.editableFill).toBeUndefined();
  expect(objects[2].fill).toBe('#654321');
  expect(objects[2].extensions.editableFill).toBeUndefined();
});

it.each(['missing-master', 'missing-layout', 'missing-size', 'duplicate-layout', 'unnamed-master'])('rejects %s page style relationships', async kind => {
  const bytes = await fixture((_zip, doc, styles) => {
    const currentPage = page(doc), layout = styles.getElementsByTagNameNS(NS.style, 'page-layout')[0], master = styles.getElementsByTagNameNS(NS.style, 'master-page')[0];
    if (kind === 'missing-master') currentPage.setAttributeNS(NS.draw, 'draw:master-page-name', 'Absent');
    if (kind === 'missing-layout') master.removeAttributeNS(NS.style, 'page-layout-name');
    if (kind === 'missing-size') layout.getElementsByTagNameNS(NS.style, 'page-layout-properties')[0].removeAttributeNS(NS.fo, 'page-width');
    if (kind === 'duplicate-layout') layout.parentNode.appendChild(layout.cloneNode(true));
    if (kind === 'unnamed-master') master.removeAttributeNS(NS.style, 'name');
  });
  await expect(read(bytes)).rejects.toThrow(kind === 'missing-master' ? 'Missing ODP master page' : kind === 'missing-layout' ? 'Missing ODP page layout' : kind === 'missing-size' ? 'Missing ODP page dimensions' : 'Ambiguous');
});

it.each(['width', 'height'])('rejects mixed page %s sizes instead of normalizing slides to the first page', async dimension => {
  const bytes = await fixture((_zip, doc, styles) => {
    const oldPage = page(doc), oldLayout = styles.getElementsByTagNameNS(NS.style, 'page-layout')[0], oldMaster = styles.getElementsByTagNameNS(NS.style, 'master-page')[0];
    const layout = oldLayout.cloneNode(true), master = oldMaster.cloneNode(true), second = oldPage.cloneNode(true);
    layout.setAttributeNS(NS.style, 'style:name', 'Layout2');
    master.setAttributeNS(NS.style, 'style:name', 'Master2');
    master.setAttributeNS(NS.style, 'style:page-layout-name', 'Layout2');
    second.setAttributeNS(NS.draw, 'draw:name', 'Second');
    second.setAttributeNS(NS.draw, 'draw:master-page-name', 'Master2');
    layout.getElementsByTagNameNS(NS.style, 'page-layout-properties')[0].setAttributeNS(NS.fo, `page-${dimension}`, '30cm');
    oldLayout.parentNode.appendChild(layout); oldMaster.parentNode.appendChild(master); oldPage.parentNode.appendChild(second);
  });
  await expect(read(bytes)).rejects.toThrow('Mixed ODP page sizes');
});
