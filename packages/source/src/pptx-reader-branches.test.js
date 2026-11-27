import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { readPptx } from './pptx.js';
import { NS, runtime } from './xml.js';

const REL = `${NS.r}/`;
const relationship = (id, type, target, extra = '') => `<Relationship Id="${id}" Type="${REL}${type}" Target="${target}" ${extra}/>`;
const relationships = body => `<Relationships xmlns="${NS.rel}">${body}</Relationships>`;
const slide = body => `<p:sld xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;

function fixture() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<Types xmlns="${NS.ct}"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`);
  zip.file('_rels/.rels', relationships(relationship('office', 'officeDocument', 'ppt/presentation.xml')));
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="${NS.p}" xmlns:r="${NS.r}"><p:sldIdLst><p:sldId r:id="s"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', relationships(relationship('s', 'slide', 'slides/slide1.xml')));
  zip.file('ppt/slides/slide1.xml', slide(''));
  return zip;
}

const read = zip => readPptx(zip, runtime(), new Map());
const appendRelationship = async (zip, part, value) => {
  const body = zip.file(part) ? await zip.file(part).async('string') : relationships('');
  zip.file(part, body.replace('</Relationships>', `${value}</Relationships>`));
};

it('rejects multiple office-document identities instead of choosing one implicitly', async () => {
  const zip = fixture();
  await appendRelationship(zip, '_rels/.rels', relationship('other-office', 'officeDocument', 'ppt/presentation.xml'));
  await expect(read(zip)).rejects.toThrow('Unsupported presentation package identity');
});

it('rejects an external relationship with no target', async () => {
  const zip = fixture();
  await appendRelationship(zip, '_rels/.rels', relationship('empty-link', 'hyperlink', '', 'TargetMode="External"'));
  await expect(read(zip)).rejects.toThrow('Missing relationship target');
});

it('marks non-harmless default paragraph properties as unsupported text defaults', async () => {
  const zip = fixture();
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:defaultTextStyle><a:defPPr marL="12700"><a:defRPr sz="1800"/></a:defPPr></p:defaultTextStyle><p:sldIdLst><p:sldId r:id="s"/></p:sldIdLst></p:presentation>`);
  const document = await read(zip);
  expect(document.extensions.pptxTextDefaultsSupported).toBe(false);
});

it('rejects ambiguous slide inheritance relationships', async () => {
  const zip = fixture();
  zip.file('ppt/slides/_rels/slide1.xml.rels', relationships(
    relationship('layout-a', 'slideLayout', '../slideLayouts/a.xml') + relationship('layout-b', 'slideLayout', '../slideLayouts/b.xml'),
  ));
  for (const name of ['a', 'b']) zip.file(`ppt/slideLayouts/${name}.xml`, `<p:sldLayout xmlns:p="${NS.p}"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
  await expect(read(zip)).rejects.toThrow('Ambiguous inheritance');
});

it('retains partial theme fonts and ignores incomplete supplemental font declarations', async () => {
  const zip = fixture();
  zip.file('ppt/slides/_rels/slide1.xml.rels', relationships(relationship('layout', 'slideLayout', '../slideLayouts/layout.xml')));
  zip.file('ppt/slideLayouts/layout.xml', `<p:sldLayout xmlns:p="${NS.p}"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/layout.xml.rels', relationships(relationship('master', 'slideMaster', '../slideMasters/master.xml')));
  zip.file('ppt/slideMasters/master.xml', `<p:sldMaster xmlns:p="${NS.p}"><p:cSld><p:spTree/></p:cSld></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/master.xml.rels', relationships(relationship('theme', 'theme', '../theme/theme.xml')));
  zip.file('ppt/theme/theme.xml', `<a:theme xmlns:a="${NS.a}"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Georgia"/><a:font script="Arab"/><a:font typeface="No script"/><a:font script="Hebr" typeface="Arial"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>`);
  const document = await read(zip);
  expect(document.slides[0].layoutId).toBeTruthy();
  expect(document.themes[0].extensions.pptxFontScheme).toEqual({ major: { latin: 'Georgia', supplemental: { Hebr: 'Arial' } } });
});

it('records a theme override without treating it as an inherited theme', async () => {
  const zip = fixture();
  zip.file('ppt/slides/_rels/slide1.xml.rels', relationships(relationship('override', 'themeOverride', '../theme/override.xml', 'TargetMode="External"')));
  const document = await read(zip);
  expect(document.slides[0].extensions.pptxThemeOverride).toBe(true);
});

it('reads only body-placeholder notes and ignores other notes shapes', async () => {
  const zip = fixture();
  await appendRelationship(zip, 'ppt/slides/_rels/slide1.xml.rels', relationship('notes', 'notesSlide', '../notesSlides/notes.xml'));
  const shape = (type, text) => `<p:sp><p:nvSpPr><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  zip.file('ppt/notesSlides/notes.xml', `<p:notes xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:cSld><p:spTree>${shape('slideImage', 'Do not import')}${shape('body', 'First')}${shape('body', 'Second')}</p:spTree></p:cSld></p:notes>`);
  expect((await read(zip)).slides[0].notes).toBe('First\nSecond');
});

it('leaves chart frames opaque when their chart reference or relationship is unauthorized', async () => {
  const zip = fixture();
  const frame = reference => `<p:graphicFrame><a:graphic><a:graphicData>${reference}</a:graphicData></a:graphic></p:graphicFrame>`;
  zip.file('ppt/slides/slide1.xml', slide(frame('<c:other xmlns:c="urn:other"/>') + frame(`<c:chart xmlns:c="${NS.c}" r:id="missing"/>`)));
  const document = await read(zip);
  expect(document.slides[0].objects.map(object => object.type)).toEqual(['opaque', 'opaque']);
});

it('keeps a malformed authorized chart opaque rather than failing the presentation open', async () => {
  const zip = fixture();
  zip.file('ppt/slides/slide1.xml', slide(`<p:graphicFrame><a:graphic><a:graphicData xmlns:c="${NS.c}"><c:chart r:id="chart"/></a:graphicData></a:graphic></p:graphicFrame>`));
  await appendRelationship(zip, 'ppt/slides/_rels/slide1.xml.rels', relationship('chart', 'chart', '../charts/chart.xml'));
  zip.file('ppt/charts/chart.xml', `<c:chartSpace xmlns:c="${NS.c}"><c:chart/></c:chartSpace>`);
  const document = await read(zip);
  expect(document.slides[0].objects[0].type).toBe('opaque');
});

it('accepts an explicit no-bullet default paragraph style', async () => {
  const zip = fixture();
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:defaultTextStyle><a:defPPr><a:buNone/></a:defPPr></p:defaultTextStyle><p:sldIdLst><p:sldId r:id="s"/></p:sldIdLst></p:presentation>`);
  expect((await read(zip)).extensions.pptxTextDefaultsSupported).toBe(true);
});

it('omits font-scheme metadata when a retained theme has no font scheme', async () => {
  const zip = fixture();
  zip.file('ppt/slides/_rels/slide1.xml.rels', relationships(relationship('layout', 'slideLayout', '../slideLayouts/layout.xml')));
  zip.file('ppt/slideLayouts/layout.xml', `<p:sldLayout xmlns:p="${NS.p}"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/layout.xml.rels', relationships(relationship('master', 'slideMaster', '../slideMasters/master.xml')));
  zip.file('ppt/slideMasters/master.xml', `<p:sldMaster xmlns:p="${NS.p}"><p:cSld><p:spTree/></p:cSld></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/master.xml.rels', relationships(relationship('theme', 'theme', '../theme/theme.xml')));
  zip.file('ppt/theme/theme.xml', `<a:theme xmlns:a="${NS.a}"><a:themeElements/></a:theme>`);
  expect((await read(zip)).themes[0].extensions.pptxFontScheme).toBeUndefined();
});

it('treats a notes placeholder without a type as the body placeholder', async () => {
  const zip = fixture();
  await appendRelationship(zip, 'ppt/slides/_rels/slide1.xml.rels', relationship('notes', 'notesSlide', '../notesSlides/notes.xml'));
  zip.file('ppt/notesSlides/notes.xml', `<p:notes xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Default body</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`);
  expect((await read(zip)).slides[0].notes).toBe('Default body');
});

it('does not project a solid fill with a missing colour value', async () => {
  const zip = fixture();
  zip.file('ppt/slides/slide1.xml', slide('<p:sp><p:spPr><a:solidFill><a:srgbClr/></a:solidFill><a:prstGeom prst="rect"/></p:spPr></p:sp>'));
  const object = (await read(zip)).slides[0].objects[0];
  expect(object.shape).toBe('rect');
  expect(object.fill).toBeUndefined();
  expect(object.extensions.editableFill).toBeUndefined();
});
