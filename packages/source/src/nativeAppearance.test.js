// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { openPresentation } from './index.js';
import { projectNativeAppearance } from './nativeAppearance.js';
import { resolvePptxColor } from './pptxColor.js';
import { isNativeLayoutAppearanceValid, isNativeObjectAppearanceValid, isNativeSlideAppearanceValid, nativeObjectAppearanceInput } from '@stagecraft/core/lib/nativeAppearance.js';
import { NS, buildPptx, para, shape, textBox, tree, xfrm } from '../../../tests/helpers/pptxFixture.js';
import { resolveTextFamily } from '../../renderer/src/vendor/officeview/drawing/text-layout.ts';

const xml = {
  parse: text => new JSDOM(text, { contentType: 'text/xml' }).window.document,
  serialize: document => new document.defaultView.XMLSerializer().serializeToString(document),
};
const emptyMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
const emptyLayout = `<p:sldLayout ${NS}>${tree('')}</p:sldLayout>`;
const packageRels = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>';
const contentTypes = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>';
async function sourceReady(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  zip.file('_rels/.rels', packageRels);
  zip.file('[Content_Types].xml', contentTypes);
  return zip.generateAsync({ type: 'uint8array' });
}
const theme = `<a:theme ${NS} name="T"><a:themeElements><a:clrScheme name="C">
  <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
  <a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
  <a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
  </a:clrScheme><a:fontScheme name="F"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface="Yu Gothic"/><a:cs typeface="Tahoma"/></a:majorFont>
  <a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Noto Sans JP"/><a:cs typeface="Amiri"/></a:minorFont></a:fontScheme>
  <a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill></a:fillStyleLst>
  <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:ln></a:lnStyleLst>
  <a:effectStyleLst/><a:bgFillStyleLst><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements></a:theme>`;

const FONT_SLOTS = [
  { id: 'lt', tag: 'latin', field: 'fontFamily', text: 'Привет', language: 'ru-RU', script: 'Cyrl' },
  { id: 'ea', tag: 'ea', field: 'fontFamilyEastAsia', text: 'こんにちは', language: 'ja-JP', script: 'Jpan' },
  { id: 'cs', tag: 'cs', field: 'fontFamilyComplexScript', text: 'مرحبا', language: 'ar-SA', script: 'Arab' },
];
const FONT_PARITY_CASES = FONT_SLOTS.flatMap(slot => {
  const sources = ['direct-face', 'direct-alias', 'direct-major-alias', 'direct-over-inherited', 'inherited-face', 'inherited-alias', 'inherited-major-alias', 'theme', 'none'];
  if (slot.id !== 'lt') sources.push('latin-fallback');
  return sources.flatMap(source => [false, true].flatMap(populated => [false, true].map(supplemental => ({
    slot, source, populated, supplemental, themeLatin: 'Theme Latin',
  })))).concat([{ slot, source: 'none', populated: false, supplemental: false, themeLatin: '' }]);
}).concat([
  { id: 'ea', tag: 'ea', field: 'fontFamilyEastAsia', text: '漢字', language: 'ja-JP', script: 'Jpan' },
  { id: 'ea', tag: 'ea', field: 'fontFamilyEastAsia', text: '漢字', language: 'ko-KR', script: 'Hang' },
  { id: 'ea', tag: 'ea', field: 'fontFamilyEastAsia', text: '漢字', language: 'zh-TW', script: 'Hant' },
  { id: 'ea', tag: 'ea', field: 'fontFamilyEastAsia', text: '漢字', language: 'zh-HK', script: 'Hant' },
  { id: 'ea', tag: 'ea', field: 'fontFamilyEastAsia', text: '漢字', language: 'zh-MO', script: 'Hant' },
  { id: 'ea', tag: 'ea', field: 'fontFamilyEastAsia', text: '漢字', language: 'zh-Hant', script: 'Hant' },
  { id: 'ea', tag: 'ea', field: 'fontFamilyEastAsia', text: '漢字', language: 'zh-CN', script: 'Hans' },
  { id: 'ea', tag: 'ea', field: 'fontFamilyEastAsia', text: '漢字', language: undefined, script: 'Hans' },
  { id: 'lt', tag: 'latin', field: 'fontFamily', text: 'Ελληνικά', language: 'el-GR', script: 'Grek' },
].flatMap(slot => [false, true].flatMap(populated => [false, true].map(supplemental => ({
  slot, source: 'none', populated, supplemental, themeLatin: 'Theme Latin',
})))));

async function openFixture(slideXml, options = {}) {
  const bytes = await sourceReady(await buildPptx({
    theme, master: emptyMaster, layout: emptyLayout,
    slides: [{ xml: slideXml }], ...options,
  }));
  return openPresentation(bytes, { format: 'pptx', xml });
}

const proof = object => object.extensions.stagecraftNativeAppearance;
const appearanceContext = (document, slide) => {
  const layout = document.layouts.find(item => item.id === slide.layoutId);
  const master = document.masters.find(item => item.id === layout?.masterId);
  return {
    document,
    slide,
    theme: document.themes[0],
    colorMap: { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2', ...master?.extensions?.pptxColorMap, ...layout?.extensions?.pptxColorMap, ...slide.extensions?.pptxColorMap },
  };
};

describe('native PPTX appearance projection', () => {
  it('refuses unprojected paragraph alignment, signed insets and body anchors', async () => {
    const variants = [
      textBox(2, 20, 20, 300, 100, para('Native', { pPr: '<a:pPr algn="dist"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' }),
      textBox(2, 20, 20, 300, 100, para('Native'), { bodyPr: '<a:bodyPr lIns="-91440"><a:noAutofit/></a:bodyPr>' }),
      textBox(2, 20, 20, 300, 100, para('Native'), { bodyPr: '<a:bodyPr anchor="just"><a:noAutofit/></a:bodyPr>' }),
      textBox(2, 20, 20, 300, 100, para('Native'), { bodyPr: '<a:bodyPr anchor="dist"><a:noAutofit/></a:bodyPr>' }),
    ];
    for (const objectXml of variants) {
      const session = await openFixture(`<p:sld ${NS}>${tree(objectXml)}</p:sld>`);
      try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
      finally { session.dispose(); }
    }
  });

  it('resolves presentation default font aliases with the consuming slide theme', async () => {
    const box = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>Native</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const bytes = await sourceReady(await buildPptx({ theme, master: emptyMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const zip = await JSZip.loadAsync(bytes);
    const secondTheme = theme.replace('<a:latin typeface="Arial"/>', '<a:latin typeface="Georgia"/>');
    zip.file('ppt/theme/theme2.xml', secondTheme);
    const presentation = await zip.file('ppt/presentation.xml').async('string');
    zip.file('ppt/presentation.xml', presentation.replace('</p:presentation>', '<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>'));
    const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx', xml });
    try {
      const document = session.document;
      const second = structuredClone(document.themes[0]);
      second.id = 'themes:ppt/theme/theme2.xml';
      second.source.part = 'ppt/theme/theme2.xml';
      second.extensions.pptxFontScheme.minor.latin = 'Georgia';
      document.themes.push(second);
      expect(document.themes[1].source.part).toBe('ppt/theme/theme2.xml');
      document.slides[0].themeId = second.id;
      expect(document.extensions.pptxDefaultTextStyle.fontFamily).toBe('+mn-lt');
      delete document.slides[0].objects[0].extensions.stagecraftNativeAppearance;
      await projectNativeAppearance(document, zip, xml);
      expect(document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontFamily).toBe('Georgia');
    } finally { session.dispose(); }
  });

  it('refuses partial direct lines and fixed style-reference colour overrides', async () => {
    const partial = shape(2, 'rect', 20, 20, 200, 100, '<a:ln w="19050"/>', '<p:style><a:lnRef idx="1001"/></p:style>');
    const partialSession = await openFixture(`<p:sld ${NS}>${tree(partial)}</p:sld>`);
    try { expect(proof(partialSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { partialSession.dispose(); }

    const fixedOverride = shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:fillRef idx="1001"><a:schemeClr val="accent2"/></a:fillRef></p:style>');
    const fixedSession = await openFixture(`<p:sld ${NS}>${tree(fixedOverride)}</p:sld>`);
    try { expect(proof(fixedSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { fixedSession.dispose(); }

    const fixedLine = shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:lnRef idx="1001"><a:schemeClr val="accent2"/></a:lnRef></p:style>');
    const lineSession = await openFixture(`<p:sld ${NS}>${tree(fixedLine)}</p:sld>`);
    try { expect(proof(lineSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { lineSession.dispose(); }

    const placeholderTheme = theme.replace(/<a:fillStyleLst>[\s\S]*?<\/a:fillStyleLst>/, '<a:fillStyleLst><a:solidFill><a:phClr/></a:solidFill></a:fillStyleLst>');
    const unresolvedPlaceholder = shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:fillRef idx="1001"/></p:style>');
    const placeholderSession = await openFixture(`<p:sld ${NS}>${tree(unresolvedPlaceholder)}</p:sld>`, { theme: placeholderTheme });
    try { expect(proof(placeholderSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { placeholderSession.dispose(); }
  });

  it.each(FONT_PARITY_CASES)('matches renderer fonts: $slot.id/$slot.language/$slot.script/$source/component=$populated/supplemental=$supplemental', async ({ slot, source, populated, supplemental, themeLatin }) => {
    const component = populated ? `Theme ${slot.id.toUpperCase()}` : '';
    const supplementalFace = supplemental ? 'Supplemental Face' : null;
    const group = name => `<a:${name}><a:latin typeface="${themeLatin}"/><a:ea typeface="${slot.id === 'ea' ? component : 'Theme EA'}"/><a:cs typeface="${slot.id === 'cs' ? component : 'Theme CS'}"/>${supplementalFace ? `<a:font script="${slot.script}" typeface="${supplementalFace}"/>` : ''}</a:${name}>`;
    const customTheme = theme.replace(/<a:majorFont>[\s\S]*?<\/a:majorFont>/, group('majorFont'))
      .replace(/<a:minorFont>[\s\S]*?<\/a:minorFont>/, group('minorFont'));
    const inherited = source.startsWith('inherited') || source === 'direct-over-inherited';
    const direct = source.startsWith('direct') || source === 'latin-fallback';
    const aliasGroup = source.includes('major') ? 'mj' : 'mn';
    const face = source.includes('alias') ? `+${aliasGroup}-${slot.id}` : `${slot.id.toUpperCase()} Face`;
    const fontNode = source === 'latin-fallback' ? '<a:latin typeface="Latin Override"/>'
      : inherited || direct ? `<a:${slot.tag} typeface="${face}"/>` : '';
    const inheritedFontNode = source === 'direct-over-inherited' ? `<a:${slot.tag} typeface="Inherited Face"/>` : fontNode;
    const master = inherited
      ? `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800">${inheritedFontNode}</a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`
      : emptyMaster;
    const runXml = `<a:p><a:r><a:rPr sz="1800"${slot.language ? ` lang="${slot.language}"` : ''}>${direct ? fontNode : ''}</a:rPr><a:t>${slot.text}</a:t></a:r></a:p>`;
    const box = textBox(2, 20, 20, 300, 100, runXml, { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const bytes = await sourceReady(await buildPptx({ theme: customTheme, master, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try {
      const fonts = { latin: themeLatin, eastAsian: slot.id === 'ea' ? component : 'Theme EA', complexScript: slot.id === 'cs' ? component : 'Theme CS', supplemental: supplementalFace ? { [slot.script]: supplementalFace } : {} };
      const expectedRun = { text: slot.text, language: slot.language };
      if (source === 'latin-fallback') expectedRun.fontFamily = 'Latin Override';
      else if (direct || inherited) expectedRun[slot.field] = face;
      const expected = resolveTextFamily(expectedRun, { fonts: { major: fonts, minor: fonts } });
      const object = session.document.slides[0].objects[0];
      expect(proof(object), JSON.stringify({ slot, source, populated, supplemental, expected })).toBeDefined();
      expect(object.text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved[slot.field], JSON.stringify({ slot, source, populated, supplemental, expected })).toBe(expected);
    } finally { session.dispose(); }
  });

  it.each([
    ['Arabic + Cyrillic', 'مرحبا Привет', ['مرحبا', 'Привет']],
    ['Han + Arabic', '漢字 مرحبا', ['漢字', 'مرحبا']],
  ])('refuses mixed scripts while checking renderer resolution per script: %s', async (_label, text, pieces) => {
    const supplemental = theme.replace('<a:latin typeface="Arial"/><a:ea typeface="Noto Sans JP"/><a:cs typeface="Amiri"/>', '<a:latin typeface="Arial"/><a:ea typeface="Noto Sans JP"/><a:cs typeface="Amiri"/><a:font script="Arab" typeface="Noto Naskh Arabic"/><a:font script="Cyrl" typeface="Noto Sans Cyrillic"/><a:font script="Hans" typeface="Noto Sans CJK"/>');
    const fonts = { latin: 'Arial', eastAsian: 'Noto Sans JP', complexScript: 'Amiri', supplemental: { Arab: 'Noto Naskh Arabic', Cyrl: 'Noto Sans Cyrillic', Hans: 'Noto Sans CJK' } };
    const expected = { 'مرحبا': 'Amiri', 'Привет': 'Arial', '漢字': 'Noto Sans JP' };
    for (const piece of pieces) expect(resolveTextFamily({ text: piece }, { fonts: { minor: fonts } })).toBe(expected[piece]);
    const box = textBox(2, 20, 20, 300, 100, `<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>${text}</a:t></a:r></a:p>`, { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const session = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`, { theme: supplemental });
    try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it('refuses hidden native shapes before issuing appearance proofs', async () => {
    const hidden = shape(2, 'rect', 20, 20, 200, 100, '<a:solidFill><a:srgbClr val="112233"/></a:solidFill>')
      .replace('<p:cNvPr id="2"', '<p:cNvPr hidden="1" id="2"');
    const session = await openFixture(`<p:sld ${NS}>${tree(hidden)}</p:sld>`);
    try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it('fails closed for unresolved inherited colours and proves a valid scheme control', async () => {
    for (const [color, expected] of [
      ['<a:schemeClr val="phClr"/>', undefined],
      ['<a:schemeClr val="accent1"/>', undefined],
      ['<a:schemeClr val="tx1"/>', '#000000'],
    ]) {
      const master = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill>${color}</a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
      const box = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>Native</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
      const bytes = await sourceReady(await buildPptx({
        theme: color.includes('accent1') ? theme.replace('<a:accent1><a:srgbClr val="4472C4"/></a:accent1>', '<a:accent1/>') : theme,
        master, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }],
      }));
      const session = await openPresentation(bytes, { format: 'pptx', xml });
      try {
        const object = session.document.slides[0].objects[0];
        if (expected) expect(object.text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.color).toBe(expected);
        else expect(proof(object)).toBeUndefined();
      } finally { session.dispose(); }
    }
  });

  it('never substitutes defaults for unresolved direct, paragraph, fill, line or background colours', async () => {
    const unresolved = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
    const variants = [
      textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: unresolved }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' }),
      textBox(2, 20, 20, 300, 100, para('Native', { pPr: `<a:pPr><a:defRPr sz="1800">${unresolved}</a:defRPr></a:pPr>` }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' }),
      shape(2, 'rect', 20, 20, 200, 100, unresolved),
      shape(2, 'rect', 20, 20, 200, 100, `<a:ln w="9525">${unresolved}</a:ln>`),
    ];
    for (const objectXml of variants) {
      const session = await openFixture(`<p:sld ${NS}>${tree(objectXml)}</p:sld>`);
      try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
      finally { session.dispose(); }
    }
    const background = await openFixture(`<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100)).replace('<p:cSld>', `<p:cSld><p:bg><p:bgPr>${unresolved}</p:bgPr></p:bg>`)}</p:sld>`);
    try { expect(background.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined(); }
    finally { background.dispose(); }
  });

  it('lets higher-precedence inherited colours replace either representation', async () => {
    const master = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:defPPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:defPPr><a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const box = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>Native</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const bytes = await sourceReady(await buildPptx({ theme, master, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try { expect(session.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.color).toBe('#FF0000'); }
    finally { session.dispose(); }

    const zip = await JSZip.loadAsync(bytes);
    const presentation = await zip.file('ppt/presentation.xml').async('string');
    zip.file('ppt/presentation.xml', presentation.replace('</p:presentation>', '<p:defaultTextStyle><a:lvl1pPr><a:defRPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>'));
    zip.file('ppt/slideMasters/slideMaster1.xml', master.replace('<a:defPPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:defPPr><a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:defRPr></a:lvl1pPr>', '<a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr>'));
    const merged = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx', xml });
    try { expect(merged.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.color).toBe('#FF0000'); }
    finally { merged.dispose(); }
  });

  it('resolves empty complex-script aliases with the detected supplemental script', async () => {
    const supplemental = theme.replace('<a:cs typeface="Amiri"/>', '<a:cs typeface=""/><a:font script="Arab" typeface="Noto Naskh Arabic"/>');
    const arabic = textBox(2, 20, 20, 300, 100, para('مرحبا', { rPr: ' sz="1800"', rKids: '<a:cs typeface="+mn-cs"/>' }).replace('lang="en-US"', 'lang="ar-SA"'), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const session = await openFixture(`<p:sld ${NS}>${tree(arabic)}</p:sld>`, { theme: supplemental });
    try { expect(session.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontFamilyComplexScript).toBe('Noto Naskh Arabic'); }
    finally { session.dispose(); }

    const latin = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:cs typeface="+mn-cs"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const latinSession = await openFixture(`<p:sld ${NS}>${tree(latin)}</p:sld>`, { theme: supplemental });
    try { expect(proof(latinSession.document.slides[0].objects[0])).toBeDefined(); }
    finally { latinSession.dispose(); }
  });

  it.each(['<a:alpha val="50000"/>', '<a:lumMod val="bad"/>', '<a:lumOff val="9007199254740992"/>'])('refuses unsupported inherited colour transforms: %s', async transform => {
    const master = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1">${transform}</a:schemeClr></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const bytes = await sourceReady(await buildPptx({ theme, master, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it('refuses significant inherited defPPr and resolves supplemental EA faces', async () => {
    const defaultParagraphMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:defPPr algn="ctr"/><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const bytes = await sourceReady(await buildPptx({ theme, master: defaultParagraphMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
    finally { session.dispose(); }

    const japaneseTheme = theme.replace('<a:ea typeface="Noto Sans JP"/>', '<a:ea typeface=""/><a:font script="Jpan" typeface="Yu Gothic"/>');
    const japanese = textBox(2, 20, 20, 300, 100, para('こんにちは', { rPr: ' sz="1800"' }).replace('lang="en-US"', 'lang="ja-JP"'), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const fontSession = await openFixture(`<p:sld ${NS}>${tree(japanese)}</p:sld>`, { theme: japaneseTheme });
    try { expect(fontSession.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontFamilyEastAsia).toBe('Yu Gothic'); }
    finally { fontSession.dispose(); }
  });

  it('resolves inherited colours with slide overrides and preserves explicit CS fonts', async () => {
    const mappedMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const box = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>Native</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const slide = `<p:sld ${NS}>${tree(box)}<p:clrMapOvr><a:overrideClrMapping tx1="lt1"/></p:clrMapOvr></p:sld>`;
    const bytes = await sourceReady(await buildPptx({ theme, master: mappedMaster, layout: emptyLayout, slides: [{ xml: slide }] }));
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try { expect(session.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.color).toBe('#FFFFFF'); }
    finally { session.dispose(); }

    const supplemental = theme.replace('<a:latin typeface="Arial"/><a:ea typeface="Noto Sans JP"/><a:cs typeface="Amiri"/>', '<a:latin typeface="Arial"/><a:ea typeface="Noto Sans JP"/><a:cs typeface="Amiri"/><a:font script="Arab" typeface="Noto Naskh Arabic"/>');
    const arabic = textBox(2, 20, 20, 300, 100, para('مرحبا', { rPr: ' sz="1800"', rKids: '<a:cs typeface="Tahoma"/>' }).replace('lang="en-US"', 'lang="ar-SA"'), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const fontSession = await openFixture(`<p:sld ${NS}>${tree(arabic)}</p:sld>`, { theme: supplemental });
    try { expect(fontSession.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontFamilyComplexScript).toBe('Tahoma'); }
    finally { fontSession.dispose(); }
  });

  it('refuses overridden inherited backgrounds and maps default colours once', async () => {
    const backgroundLayout = emptyLayout.replace('<p:cSld>', '<p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></p:bgPr></p:bg>');
    const mappedMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/></p:sldMaster>`;
    const slide = `<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100))}<p:clrMapOvr><a:overrideClrMapping tx1="lt1"/></p:clrMapOvr></p:sld>`;
    const backgroundSession = await openFixture(slide, { master: mappedMaster, layout: backgroundLayout });
    try {
      expect(backgroundSession.document.slides[0].extensions.pptxColorMapOverride).toBe('mapping');
      expect(backgroundSession.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();
    }
    finally { backgroundSession.dispose(); }

    const chainedMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="accent1" tx1="accent1" accent1="accent2"/></p:sldMaster>`;
    const text = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const chained = await openFixture(`<p:sld ${NS}>${tree(text)}</p:sld>`, { master: chainedMaster });
    try {
      expect(chained.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.color).toBe('#4472C4');
      expect(chained.document.slides[0].extensions.stagecraftSlideAppearance.background).toEqual({ kind: 'solid', color: '#4472C4' });
    } finally { chained.dispose(); }
  });

  it('uses the last run only when end-run properties are absent', async () => {
    const box = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>Native</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const session = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`);
    try {
      const object = session.document.slides[0].objects[0];
      expect(proof(object).text.paragraphs[0].endRun).toEqual(object.text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved);
    } finally { session.dispose(); }

    for (const end of ['<a:endParaRPr sz="bad"/>', '<a:endParaRPr sz="3600"><a:solidFill><a:srgbClr val="112233"><a:alpha val="50000"/></a:srgbClr></a:solidFill></a:endParaRPr>']) {
      const invalid = textBox(2, 20, 20, 300, 100, `<a:p><a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>Native</a:t></a:r>${end}</a:p>`, { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
      const refused = await openFixture(`<p:sld ${NS}>${tree(invalid)}</p:sld>`);
      try { expect(proof(refused.document.slides[0].objects[0])).toBeUndefined(); }
      finally { refused.dispose(); }
    }
  });

  it('refuses style references when resolved theme style vectors are unavailable', async () => {
    const objectXml = shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:fillRef idx="1001"/><a:lnRef idx="1001"/></p:style>');
    const bytes = await sourceReady(await buildPptx({ theme, master: emptyMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(objectXml)}</p:sld>` }] }));
    const zip = await JSZip.loadAsync(bytes);
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try {
      delete session.document.themes[0].extensions.pptxFillStyles;
      delete session.document.themes[0].extensions.pptxLineStyles;
      session.document.themes[0].source = null;
      delete session.document.slides[0].objects[0].extensions.stagecraftNativeAppearance;
      await projectNativeAppearance(session.document, zip, xml);
      expect(proof(session.document.slides[0].objects[0])).toBeUndefined();
    } finally { session.dispose(); }
  });

  it.each(['b="maybe"', 'i="maybe"'])('refuses invalid inherited boolean %s', async attribute => {
    const master = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800" ${attribute}/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const bytes = await sourceReady(await buildPptx({ theme, master, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it('covers inherited boolean/language defaults and malformed canonical mappings', async () => {
    const inheritedMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800" b="true" i="false" lang="ar-SA"><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const supplemental = theme.replace('<a:latin typeface="Arial"/><a:ea typeface="Noto Sans JP"/><a:cs typeface="Amiri"/>', '<a:latin typeface="Arial"/><a:ea typeface="Noto Sans JP"/><a:cs typeface="Amiri"/><a:font script="Arab" typeface="Noto Naskh Arabic"/>');
    const box = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>مرحبا</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const bytes = await sourceReady(await buildPptx({ theme: supplemental, master: inheritedMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const zip = await JSZip.loadAsync(bytes);
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try {
      expect(session.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved)
        .toMatchObject({ bold: true, italic: false, fontFamilyComplexScript: 'Arial' });
      const document = session.document;
      document.slides[0].objects[0].text.paragraphs.push(structuredClone(document.slides[0].objects[0].text.paragraphs[0]));
      await projectNativeAppearance(document, zip, xml);
      expect(proof(document.slides[0].objects[0])).toBeDefined();
      document.slides[0].objects[0].text.paragraphs[0].runs.push(structuredClone(document.slides[0].objects[0].text.paragraphs[0].runs[0]));
      await projectNativeAppearance(document, zip, xml);
      expect(proof(document.slides[0].objects[0])).toBeDefined();
    } finally { session.dispose(); }
  });

  it('refuses empty inherited text, unsupported presets and cyclic backgrounds', async () => {
    const noSizeMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const empty = textBox(2, 20, 20, 300, 100, '<a:p/>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const emptyBytes = await sourceReady(await buildPptx({ theme, master: noSizeMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(empty)}</p:sld>` }] }));
    const emptySession = await openPresentation(emptyBytes, { format: 'pptx', xml });
    try { expect(proof(emptySession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { emptySession.dispose(); }

    const triangle = await openFixture(`<p:sld ${NS}>${tree(shape(2, 'triangle', 20, 20, 200, 100))}</p:sld>`);
    try { expect(proof(triangle.document.slides[0].objects[0])).toBeUndefined(); }
    finally { triangle.dispose(); }

    const objectXml = shape(2, 'rect', 20, 20, 200, 100);
    const bytes = await sourceReady(await buildPptx({ theme, master: emptyMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(objectXml)}</p:sld>` }] }));
    const zip = await JSZip.loadAsync(bytes);
    const cyclic = await openPresentation(bytes, { format: 'pptx', xml });
    try {
      cyclic.document.layouts[0].masterId = cyclic.document.layouts[0].id;
      delete cyclic.document.slides[0].extensions.stagecraftSlideAppearance;
      await projectNativeAppearance(cyclic.document, zip, xml);
      expect(cyclic.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();
      cyclic.document.slides[0].layoutId = undefined;
      cyclic.document.slides[0].masterId = cyclic.document.masters[0].id;
      cyclic.document.masters[0].masterId = cyclic.document.masters[0].id;
      await projectNativeAppearance(cyclic.document, zip, xml);
      expect(cyclic.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();
    } finally { cyclic.dispose(); }
  });

  it('covers none and unavailable theme style vectors', async () => {
    const noneTheme = theme.replace(/<a:fillStyleLst>[\s\S]*?<\/a:fillStyleLst>/, '<a:fillStyleLst><a:noFill/></a:fillStyleLst>')
      .replace(/<a:bgFillStyleLst>[\s\S]*?<\/a:bgFillStyleLst>/, '<a:bgFillStyleLst><a:noFill/></a:bgFillStyleLst>');
    const styled = shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:fillRef idx="1001"/></p:style>');
    const noneSession = await openFixture(`<p:sld ${NS}>${tree(styled).replace('<p:cSld>', '<p:cSld><p:bg><p:bgRef idx="1001"/></p:bg>')}</p:sld>`, { theme: noneTheme });
    try {
      expect(proof(noneSession.document.slides[0].objects[0]).fill).toEqual({ kind: 'none' });
      expect(noneSession.document.slides[0].extensions.stagecraftSlideAppearance.background).toEqual({ kind: 'none' });
    } finally { noneSession.dispose(); }

    const bgBytes = await sourceReady(await buildPptx({ theme, master: emptyMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100)).replace('<p:cSld>', '<p:cSld><p:bg><p:bgRef idx="1001"/></p:bg>')}</p:sld>` }] }));
    const bgZip = await JSZip.loadAsync(bgBytes);
    const unavailable = await openPresentation(bgBytes, { format: 'pptx', xml });
    try {
      unavailable.document.themes[0].source = null;
      delete unavailable.document.slides[0].extensions.stagecraftSlideAppearance;
      await projectNativeAppearance(unavailable.document, bgZip, xml);
      expect(unavailable.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();
    } finally { unavailable.dispose(); }
  });

  it('parses each source part once per appearance projection pass', async () => {
    const objects = shape(2, 'rect', 20, 20, 200, 100) + shape(3, 'ellipse', 40, 40, 200, 100);
    const bytes = await sourceReady(await buildPptx({ theme, master: emptyMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(objects)}</p:sld>` }] }));
    const zip = await JSZip.loadAsync(bytes);
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try {
      for (const object of session.document.slides[0].objects) delete object.extensions.stagecraftNativeAppearance;
      let slideParses = 0;
      const countingXml = { ...xml, parse: text => { if (text.includes('<p:sld ')) slideParses++; return xml.parse(text); } };
      await projectNativeAppearance(session.document, zip, countingXml);
      expect(slideParses).toBe(1);
    } finally { session.dispose(); }
  });

  it('keeps appearance projection fail-closed when source parts or relationships are unavailable', async () => {
    await expect(projectNativeAppearance({ extensions: { sourceFormat: 'odp' } }, new JSZip(), xml)).resolves.toBeUndefined();
    const session = await openFixture(`<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100))}</p:sld>`);
    try {
      const document = session.document;
      document.relationships = [];
      document.themes[0].source = null;
      document.masters[0].source = null;
      document.layouts[0].source = null;
      document.slides[0].source = null;
      for (const entity of [...document.masters, ...document.layouts, ...document.slides]) {
        delete entity.extensions?.stagecraftLayoutSummary;
        delete entity.extensions?.stagecraftSlideAppearance;
        delete entity.extensions?.stagecraftNativeAppearance;
      }
      await projectNativeAppearance(document, new JSZip(), xml);
      expect(document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();

      const broken = structuredClone(document);
      broken.themes[0].source = { part: 'missing.xml' };
      broken.masters[0].source = { part: 'missing.xml' };
      broken.layouts[0].source = { part: 'missing.xml' };
      broken.slides[0].source = { part: 'missing.xml' };
      await expect(projectNativeAppearance(broken, new JSZip(), xml)).resolves.toBeUndefined();

      const missingPresentation = structuredClone(broken);
      missingPresentation.relationships = [{ type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', target: 'missing.xml' }];
      await expect(projectNativeAppearance(missingPresentation, new JSZip(), xml)).resolves.toBeUndefined();

      const objectXml = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
      const bytes = await sourceReady(await buildPptx({ theme, master: emptyMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(objectXml)}</p:sld>` }] }));
      const zip = await JSZip.loadAsync(bytes);
      const detached = await openPresentation(bytes, { format: 'pptx', xml });
      try {
        detached.document.slides[0].layoutId = undefined;
        detached.document.slides[0].masterId = undefined;
        delete detached.document.slides[0].extensions.stagecraftSlideAppearance;
        await projectNativeAppearance(detached.document, zip, xml);
        expect(detached.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();
        detached.document.slides[0].themeId = detached.document.themes[0].id;
        await projectNativeAppearance(detached.document, zip, xml);
        expect(detached.document.slides[0].extensions.stagecraftSlideAppearance).toBeDefined();
        expect(proof(detached.document.slides[0].objects[0])).toBeDefined();
        detached.document.slides[0].themeId = 'missing-theme';
        delete detached.document.slides[0].extensions.stagecraftSlideAppearance;
        delete detached.document.slides[0].objects[0].extensions.stagecraftNativeAppearance;
        await projectNativeAppearance(detached.document, zip, xml);
        expect(detached.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();
        expect(proof(detached.document.slides[0].objects[0])).toBeUndefined();
        detached.document.slides[0].themeId = detached.document.themes[0].id;
        detached.document.slides[0].objects[0].text.paragraphs[0].style = undefined;
        delete detached.document.slides[0].objects[0].extensions.stagecraftNativeAppearance;
        await projectNativeAppearance(detached.document, zip, xml);
        expect(proof(detached.document.slides[0].objects[0])).toBeDefined();
        detached.document.layouts[0].masterId = undefined;
        detached.document.layouts[0].themeId = detached.document.themes[0].id;
        delete detached.document.layouts[0].extensions.stagecraftLayoutSummary;
        await projectNativeAppearance(detached.document, zip, xml);
        expect(detached.document.layouts[0].extensions.stagecraftLayoutSummary).toBeDefined();
      } finally { detached.dispose(); }
    } finally { session.dispose(); }
  });

  it('covers direct colour boundaries through the source projection module', () => {
    const node = value => xml.parse(`<x xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${value}</x>`).documentElement.firstElementChild;
    expect(resolvePptxColor(node('<a:srgbClr val="#112233"/>'))).toBe('#112233');
    expect(resolvePptxColor(node('<a:sysClr val="window" lastClr="ABCDEF"/>'))).toBe('#ABCDEF');
    expect(resolvePptxColor(node('<a:schemeClr val="accent1"/>'), { accent1: '#445566' })).toBe('#445566');
    expect(resolvePptxColor(node('<a:sysClr val="window"/>'))).toBeNull();
    expect(resolvePptxColor(node('<a:unknownClr/>'))).toBeNull();
    expect(resolvePptxColor(null)).toBeNull();
    expect(resolvePptxColor(node('<a:srgbClr val="112233"><a:lumMod val="9007199254740992"/></a:srgbClr>'))).toBeNull();
    expect(resolvePptxColor(node('<a:srgbClr val="112233"><a:lumMod/></a:srgbClr>'))).toBeNull();
    expect(resolvePptxColor(node('<a:srgbClr val="bad"/>'))).toBeNull();
    expect(resolvePptxColor(node('<a:sysClr val="window" lastClr="#ABCDEF"/>'))).toBe('#ABCDEF');
    expect(resolvePptxColor(node('<a:schemeClr val="tx1"/>'), { dk1: '#112233' }, { tx1: 'dk1' })).toBe('#112233');
    expect(resolvePptxColor(node('<a:schemeClr val="missing"/>'), {}, {})).toBeNull();
    for (const value of ['FF0000', 'FFFF00', '00FF00', '00FFFF', '0000FF', 'FF00FF', '12FF34', '1234FF', 'FF1234', '8000FF']) {
      expect(resolvePptxColor(node(`<a:srgbClr val="${value}"><a:lumMod val="50000"/></a:srgbClr>`))).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('resolves XML boolean spellings and rejects mirrored transforms', async () => {
    for (const [bold, italic] of [['true', 'false'], ['false', 'true']]) {
      const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ` sz="1800" b="${bold}" i="${italic}"`, rKids: '<a:latin typeface="Arial"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
      const session = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`);
      try {
        expect(session.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved)
          .toMatchObject({ bold: bold === 'true', italic: italic === 'true' });
      } finally { session.dispose(); }
    }
    for (const flip of ['true', '1', 'maybe']) {
      const mirrored = shape(2, 'rect', 20, 20, 200, 100).replace('<a:xfrm>', `<a:xfrm flipH="${flip}">`);
      const session = await openFixture(`<p:sld ${NS}>${tree(mirrored)}</p:sld>`);
      try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
      finally { session.dispose(); }
    }
  });

  it('proves justified paragraphs and binds object context to inherited styles', async () => {
    const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>', pPr: '<a:pPr algn="just"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const session = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`);
    try {
      const document = session.document;
      const object = document.slides[0].objects[0];
      expect(proof(object).text.paragraphs[0].alignment).toBe('justify');
      expect(isNativeObjectAppearanceValid(object, appearanceContext(document, document.slides[0]))).toBe(true);
      document.masters[0].extensions.pptxOtherTextStyle = { color: '#FF0000', fontSizePt: 30, fontFamily: 'Courier New' };
      expect(isNativeObjectAppearanceValid(object, appearanceContext(document, document.slides[0]))).toBe(false);
      document.masters[0].extensions.pptxOtherTextStyle = { fontSizePt: 18 };
      document.themes[0].extensions.pptxObjectDefaults = { spDef: true };
      expect(isNativeObjectAppearanceValid(object, appearanceContext(document, document.slides[0]))).toBe(false);
    } finally { session.dispose(); }
  });

  it('invalidates layout summaries when inherited theme background styles change', async () => {
    const session = await openFixture(`<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100))}</p:sld>`);
    try {
      const document = session.document;
      expect(isNativeLayoutAppearanceValid(document.layouts[0], document)).toBe(true);
      document.themes[0].extensions.pptxBackgroundFillStyles[0].color = '#000000';
      expect(isNativeLayoutAppearanceValid(document.layouts[0], document)).toBe(false);
    } finally { session.dispose(); }
  });

  it('resolves colour-map overrides and refuses inherited attributes and compound strokes', async () => {
    const overrideSlide = `<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100, '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'))}<p:clrMapOvr><a:overrideClrMapping tx1="lt1"/></p:clrMapOvr></p:sld>`;
    const override = await openFixture(overrideSlide);
    try {
      expect(proof(override.document.slides[0].objects[0]).fill).toEqual({ kind: 'solid', color: '#FFFFFF' });
      expect(override.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();
    } finally { override.dispose(); }

    const unsupportedOverride = await openFixture(`<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100))}<p:clrMapOvr><a:unknownMapping/></p:clrMapOvr></p:sld>`);
    try {
      expect(proof(unsupportedOverride.document.slides[0].objects[0])).toBeUndefined();
      expect(unsupportedOverride.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();
    } finally { unsupportedOverride.dispose(); }

    const centeredMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const bytes = await sourceReady(await buildPptx({ theme, master: centeredMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const centered = await openPresentation(bytes, { format: 'pptx', xml });
    try { expect(proof(centered.document.slides[0].objects[0])).toBeUndefined(); }
    finally { centered.dispose(); }

    for (const attributes of ['cmpd="dbl"', 'algn="in"']) {
      const line = `<a:ln w="9525" ${attributes}><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln>`;
      const session = await openFixture(`<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100, line))}</p:sld>`);
      try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
      finally { session.dispose(); }
    }
  });

  it('follows layout backgrounds and refuses unsupported inherited layouts', async () => {
    const solidLayout = emptyLayout.replace('<p:cSld>', '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:bgPr></p:bg>');
    const solid = await openFixture(`<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100))}</p:sld>`, { layout: solidLayout });
    try { expect(solid.document.slides[0].extensions.stagecraftSlideAppearance.background).toEqual({ kind: 'solid', color: '#FF0000' }); }
    finally { solid.dispose(); }

    const gradientLayout = emptyLayout.replace('<p:cSld>', '<p:cSld><p:bg><p:bgPr><a:gradFill/></p:bgPr></p:bg>');
    const gradient = await openFixture(`<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100))}</p:sld>`, { layout: gradientLayout });
    try { expect(gradient.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined(); }
    finally { gradient.dispose(); }
  });

  it('validates referenced fill models and preserves direct stroke colours', async () => {
    const gradientTheme = theme.replace(/<a:fillStyleLst>[\s\S]*?<\/a:fillStyleLst>/, '<a:fillStyleLst><a:gradFill/></a:fillStyleLst>');
    const fillOverride = shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:fillRef idx="1001"><a:schemeClr val="accent2"/></a:fillRef></p:style>');
    const gradient = await openFixture(`<p:sld ${NS}>${tree(fillOverride)}</p:sld>`, { theme: gradientTheme });
    try { expect(proof(gradient.document.slides[0].objects[0])).toBeUndefined(); }
    finally { gradient.dispose(); }

    const directLine = shape(2, 'rect', 20, 20, 200, 100, '<a:ln w="9525"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>', '<p:style><a:lnRef idx="1001"><a:schemeClr val="accent2"/></a:lnRef></p:style>');
    const stroke = await openFixture(`<p:sld ${NS}>${tree(directLine)}</p:sld>`);
    try { expect(proof(stroke.document.slides[0].objects[0]).stroke).toEqual({ kind: 'solid', color: '#FF0000', widthEmu: 9525 }); }
    finally { stroke.dispose(); }
  });

  it('accepts named major and minor font references', async () => {
    for (const [idx, expected] of [['major', 'Georgia'], ['minor', 'Arial']]) {
      const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' })
        .replace('<p:spPr>', `<p:style><a:fontRef idx="${idx}"/></p:style><p:spPr>`);
      const session = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`);
      try { expect(session.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontFamily).toBe(expected); }
      finally { session.dispose(); }
    }
  });

  it('resolves theme style vectors with each use-site colour map', async () => {
    const mappedMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="dk1" tx1="lt1" accent1="accent2"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const directTheme = theme.replace('<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>', '<a:schemeClr val="accent1"/>')
      .replace('<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:ln></a:lnStyleLst>', '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></a:lnStyleLst>')
      .replace('<a:bgFillStyleLst><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:bgFillStyleLst>', '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:bgFillStyleLst>');
    const styled = shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:fillRef idx="1001"/><a:lnRef idx="1001"/></p:style>');
    const session = await openFixture(`<p:sld ${NS}>${tree(styled).replace('<p:cSld>', '<p:cSld><p:bg><p:bgRef idx="1001"/></p:bg>')}</p:sld>`, { master: mappedMaster, theme: directTheme });
    try {
      expect(proof(session.document.slides[0].objects[0])).toMatchObject({
        fill: { color: '#ED7D31' }, stroke: { color: '#FFFFFF' },
      });
      expect(session.document.slides[0].extensions.stagecraftSlideAppearance.background).toEqual({ kind: 'solid', color: '#000000' });
    } finally { session.dispose(); }
  });

  it('honours layout masterClrMapping for slide descendants', async () => {
    const mappedMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="lt1"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const mappedLayout = `${emptyLayout.replace('</p:sldLayout>', '<p:clrMap tx1="dk1"/><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>')}`;
    const objectXml = shape(2, 'rect', 20, 20, 200, 100, '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>');
    const session = await openFixture(`<p:sld ${NS}>${tree(objectXml)}</p:sld>`, { master: mappedMaster, layout: mappedLayout });
    try { expect(proof(session.document.slides[0].objects[0]).fill).toEqual({ kind: 'solid', color: '#FFFFFF' }); }
    finally { session.dispose(); }
  });

  it('refuses non-default kerning and resolves supported supplemental fonts', async () => {
    const kerned = textBox(2, 20, 20, 300, 100, para('Native', { pPr: '<a:pPr><a:defRPr sz="1800" kern="0"/></a:pPr>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const kernSession = await openFixture(`<p:sld ${NS}>${tree(kerned)}</p:sld>`);
    try { expect(proof(kernSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { kernSession.dispose(); }

    const supplemental = theme.replace('<a:latin typeface="Arial"/><a:ea typeface="Noto Sans JP"/><a:cs typeface="Amiri"/>', '<a:latin typeface="Arial"/><a:ea typeface="Noto Sans JP"/><a:cs typeface="Amiri"/><a:font script="Arab" typeface="Noto Naskh Arabic"/><a:font script="Cyrl" typeface="Noto Sans Cyrillic"/>');
    const box = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>Native</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const fontSession = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`, { theme: supplemental });
    try { expect(proof(fontSession.document.slides[0].objects[0])).toBeDefined(); }
    finally { fontSession.dispose(); }

    const noLangArabic = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>مرحبا</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const noLangArabicSession = await openFixture(`<p:sld ${NS}>${tree(noLangArabic)}</p:sld>`, { theme: supplemental });
    try { expect(noLangArabicSession.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontFamilyComplexScript).toBe('Amiri'); }
    finally { noLangArabicSession.dispose(); }

    const arabic = textBox(2, 20, 20, 300, 100, para('مرحبا', { rPr: ' sz="1800"' }).replace('lang="en-US"', 'lang="ar-SA"'), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const arabicSession = await openFixture(`<p:sld ${NS}>${tree(arabic)}</p:sld>`, { theme: supplemental });
    try { expect(arabicSession.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontFamilyComplexScript).toBe('Amiri'); }
    finally { arabicSession.dispose(); }

    const mismatched = textBox(2, 20, 20, 300, 100, para('مرحبا', { rPr: ' sz="1800"' }).replace('lang="en-US"', 'lang="hi-IN"'), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const mismatchedSession = await openFixture(`<p:sld ${NS}>${tree(mismatched)}</p:sld>`, { theme: supplemental });
    try { expect(mismatchedSession.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontFamilyComplexScript).toBe('Amiri'); }
    finally { mismatchedSession.dispose(); }

    const mixed = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>مرحبا नमस्ते</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const mixedSession = await openFixture(`<p:sld ${NS}>${tree(mixed)}</p:sld>`, { theme: supplemental });
    try { expect(proof(mixedSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { mixedSession.dispose(); }

    const cyrillic = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>Привет</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const cyrillicSession = await openFixture(`<p:sld ${NS}>${tree(cyrillic)}</p:sld>`, { theme: supplemental });
    try { expect(cyrillicSession.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontFamily).toBe('Arial'); }
    finally { cyrillicSession.dispose(); }

    const mixedCyrillic = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>مرحبا Привет</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const mixedCyrillicSession = await openFixture(`<p:sld ${NS}>${tree(mixedCyrillic)}</p:sld>`, { theme: supplemental });
    try { expect(proof(mixedCyrillicSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { mixedCyrillicSession.dispose(); }

    const unknownMixed = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>Привет𐍈</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const unknownMixedSession = await openFixture(`<p:sld ${NS}>${tree(unknownMixed)}</p:sld>`, { theme: supplemental });
    try { expect(proof(unknownMixedSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { unknownMixedSession.dispose(); }

    const unknownOnly = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>𐍈</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const unknownOnlySession = await openFixture(`<p:sld ${NS}>${tree(unknownOnly)}</p:sld>`, { theme: supplemental });
    try { expect(proof(unknownOnlySession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { unknownOnlySession.dispose(); }

    const emoji = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>Native😀</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const emojiSession = await openFixture(`<p:sld ${NS}>${tree(emoji)}</p:sld>`);
    try { expect(proof(emojiSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { emojiSession.dispose(); }

    const arabicDigits = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>١٢٣</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const digitsSession = await openFixture(`<p:sld ${NS}>${tree(arabicDigits)}</p:sld>`, { theme: supplemental });
    try { expect(digitsSession.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontFamilyComplexScript).toBe('Amiri'); }
    finally { digitsSession.dispose(); }

    const mixedDigits = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>Native١٢٣</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const mixedDigitsSession = await openFixture(`<p:sld ${NS}>${tree(mixedDigits)}</p:sld>`, { theme: supplemental });
    try { expect(proof(mixedDigitsSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { mixedDigitsSession.dispose(); }

    const keycap = textBox(2, 20, 20, 300, 100, '<a:p><a:r><a:rPr sz="1800"></a:rPr><a:t>1️⃣</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const keycapSession = await openFixture(`<p:sld ${NS}>${tree(keycap)}</p:sld>`);
    try { expect(proof(keycapSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { keycapSession.dispose(); }

    const unknown = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"' }).replace('lang="en-US"', 'lang="xx-XX"'), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const unknownSession = await openFixture(`<p:sld ${NS}>${tree(unknown)}</p:sld>`, { theme: supplemental });
    try { expect(proof(unknownSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { unknownSession.dispose(); }
  });

  it('refuses a slide proof when its own background is an unsupported gradient', async () => {
    const gradientBg = '<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst></a:gradFill></p:bgPr></p:bg>';
    const session = await openFixture(`<p:sld ${NS}>${tree('').replace('<p:cSld>', `<p:cSld>${gradientBg}`)}</p:sld>`);
    try { expect(session.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it('honours colour overrides on fillRef, lnRef and fontRef', async () => {
    const styled = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Styled"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:style><a:fillRef idx="1001"><a:schemeClr val="accent2"/></a:fillRef><a:lnRef idx="1001"><a:schemeClr val="accent2"/></a:lnRef></p:style><p:spPr>${xfrm(20, 20, 200, 100)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
    const placeholderTheme = theme.replace(/<a:fillStyleLst>[\s\S]*?<\/a:fillStyleLst>/, '<a:fillStyleLst><a:solidFill><a:phClr/></a:solidFill></a:fillStyleLst>')
      .replace('<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:ln></a:lnStyleLst>', '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:phClr/></a:solidFill></a:ln></a:lnStyleLst>');
    const session = await openFixture(`<p:sld ${NS}>${tree(styled)}</p:sld>`, { theme: placeholderTheme });
    try {
      expect(proof(session.document.slides[0].objects[0])).toMatchObject({
        fill: { kind: 'solid', color: '#ED7D31' }, stroke: { kind: 'solid', color: '#ED7D31', widthEmu: 9525 },
      });
    } finally { session.dispose(); }

    const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }), {
      bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>',
    }).replace('<p:spPr>', '<p:style><a:fontRef idx="1002"><a:schemeClr val="accent2"/></a:fontRef></p:style><p:spPr>');
    const textSession = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`);
    try {
      expect(textSession.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.color).toBe('#ED7D31');
    } finally { textSession.dispose(); }
  });

  it('resolves inherited text colour and refuses unsupported point line spacing', async () => {
    const inheritedMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const bytes = await sourceReady(await buildPptx({ theme, master: inheritedMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try {
      expect(proof(session.document.slides[0].objects[0])).toBeDefined();
      expect(session.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.color).toBe('#FF0000');
    } finally { session.dispose(); }

    const pointSpacing = textBox(2, 20, 20, 300, 100, `<a:p><a:pPr><a:lnSpc><a:spcPts val="2400"/></a:lnSpc></a:pPr><a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>Native</a:t></a:r></a:p>`, { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const spacingSession = await openFixture(`<p:sld ${NS}>${tree(pointSpacing)}</p:sld>`);
    try { expect(proof(spacingSession.document.slides[0].objects[0])).toBeUndefined(); }
    finally { spacingSession.dispose(); }
  });

  it('invalidates a slide proof when inherited artwork or theme colours change', async () => {
    const objectXml = shape(2, 'rect', 20, 20, 200, 100, '<a:solidFill><a:srgbClr val="112233"/></a:solidFill>');
    const session = await openFixture(`<p:sld ${NS}>${tree(objectXml)}</p:sld>`);
    try {
      const document = structuredClone(session.document);
      expect(isNativeSlideAppearanceValid(document.slides[0], document)).toBe(true);
      document.layouts[0].objects.push({ id: 'new-art', type: 'shape' });
      expect(isNativeSlideAppearanceValid(document.slides[0], document)).toBe(false);
      document.layouts[0].objects = [];
      document.themes[0].extensions.pptxColorScheme.lt1 = '#000000';
      expect(isNativeSlideAppearanceValid(document.slides[0], document)).toBe(false);
    } finally { session.dispose(); }
  });

  it.each([
    ['gradient fill', shape(2, 'rect', 20, 20, 200, 100, '<a:gradFill/>')],
    ['multiple fills', shape(2, 'rect', 20, 20, 200, 100, '<a:noFill/><a:solidFill><a:srgbClr val="112233"/></a:solidFill>')],
    ['unsupported stroke child', shape(2, 'rect', 20, 20, 200, 100, '<a:ln w="9525"><a:headEnd type="triangle"/></a:ln>')],
    ['dashed stroke', shape(2, 'rect', 20, 20, 200, 100, '<a:ln w="9525"><a:prstDash val="dash"/></a:ln>')],
    ['stroke without width', shape(2, 'rect', 20, 20, 200, 100, '<a:ln><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln>')],
    ['zero-width stroke', shape(2, 'rect', 20, 20, 200, 100, '<a:ln w="0"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln>')],
    ['multiple stroke fills', shape(2, 'rect', 20, 20, 200, 100, '<a:ln w="9525"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:noFill/></a:ln>')],
    ['invalid fill reference', shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:fillRef idx="nope"/></p:style>')],
    ['missing fill reference index', shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:fillRef/></p:style>')],
    ['unknown direct colour', shape(2, 'rect', 20, 20, 200, 100, '<a:solidFill><a:unknownClr/></a:solidFill>')],
    ['multiple fill overrides', shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:fillRef idx="1001"><a:srgbClr val="112233"/><a:srgbClr val="445566"/></a:fillRef></p:style>')],
    ['unknown line override', shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:lnRef idx="1001"><a:unknownClr/></a:lnRef></p:style>')],
    ['multiple line overrides', shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:lnRef idx="1001"><a:srgbClr val="112233"/><a:srgbClr val="445566"/></a:lnRef></p:style>')],
    ['invalid line reference', shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:lnRef idx="nope"/></p:style>')],
    ['non-adjustment geometry', shape(2, 'roundRect', 20, 20, 200, 100).replace('<a:avLst/>', '<a:avLst><a:gd name="x" fmla="val 1"/></a:avLst>')],
    ['malformed adjustment', shape(2, 'roundRect', 20, 20, 200, 100).replace('<a:avLst/>', '<a:avLst><a:gd name="adj" fmla="bad"/></a:avLst>')],
    ['missing adjustment formula', shape(2, 'roundRect', 20, 20, 200, 100).replace('<a:avLst/>', '<a:avLst><a:gd name="adj"/></a:avLst>')],
    ['out-of-range adjustment', shape(2, 'roundRect', 20, 20, 200, 100).replace('<a:avLst/>', '<a:avLst><a:gd name="adj" fmla="val 50001"/></a:avLst>')],
    ['rect adjustment', shape(2, 'rect', 20, 20, 200, 100).replace('<a:avLst/>', '<a:avLst><a:gd name="adj" fmla="val 1"/></a:avLst>')],
    ['shape effect', shape(2, 'rect', 20, 20, 200, 100, '<a:effectLst/>')],
    ['flipped shape', shape(2, 'rect', 20, 20, 200, 100).replace('<a:xfrm>', '<a:xfrm flipH="1">')],
    ['custom geometry', shape(2, 'rect', 20, 20, 200, 100).replace('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', '<a:custGeom/>')],
    ['missing geometry properties', shape(2, 'rect', 20, 20, 200, 100).replace(/<p:spPr>[\s\S]*?<\/p:spPr>/, '<p:spPr/>')],
    ['multiple geometries', shape(2, 'rect', 20, 20, 200, 100).replace('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>')],
    ['unsupported shape style', shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:effectRef idx="2"/></p:style>')],
    ['text on non-rectangle', textBox(2, 20, 20, 200, 100, para('Native')).replace('prst="rect"', 'prst="ellipse"')],
    ['text autofit', textBox(2, 20, 20, 200, 100, para('Native'), { bodyPr: '<a:bodyPr><a:spAutoFit/></a:bodyPr>' })],
    ['unsupported body property', textBox(2, 20, 20, 200, 100, para('Native'), { bodyPr: '<a:bodyPr vert="vert270"/>' })],
    ['placeholder text', textBox(2, 20, 20, 200, 100, para('Native')).replace('<p:nvPr/>', '<p:nvPr><p:ph type="body"/></p:nvPr>')],
    ['list text', textBox(2, 20, 20, 200, 100, para('Native', { pPr: '<a:lvl1pPr/>' }))],
    ['unsupported paragraph property', textBox(2, 20, 20, 200, 100, para('Native', { pPr: '<a:pPr rtl="1"/>' }))],
    ['bullet paragraph', textBox(2, 20, 20, 200, 100, para('Native', { pPr: '<a:pPr><a:buChar char="•"/></a:pPr>' }))],
    ['unsupported end property', textBox(2, 20, 20, 200, 100, para('Native')).replace('</a:p>', '<a:endParaRPr kern="1200"/></a:p>')],
    ['unsupported run property', textBox(2, 20, 20, 200, 100, para('Native', { rPr: ' sz="1800" kern="1200"', rKids: '<a:latin typeface="Arial"/>' }))],
    ['invalid run size', textBox(2, 20, 20, 200, 100, para('Native', { rPr: ' sz="bad"', rKids: '<a:latin typeface="Arial"/>' }))],
    ['unsupported paragraph default', textBox(2, 20, 20, 200, 100, para('Native', { pPr: '<a:pPr><a:defRPr><a:highlight/></a:defRPr></a:pPr>' }))],
    ['underlined paragraph default', textBox(2, 20, 20, 200, 100, para('Native', { pPr: '<a:pPr><a:defRPr u="sng"/></a:pPr>' }))],
    ['oversized font', textBox(2, 20, 20, 200, 100, para('Native', { rPr: ' sz="1800"', rKids: `<a:latin typeface="${'A'.repeat(20000)}"/>` }))],
    ['underlined run', textBox(2, 20, 20, 200, 100, para('Native', { rPr: ' sz="1800" u="sng"', rKids: '<a:latin typeface="Arial"/>' }))],
    ['invalid bold boolean', textBox(2, 20, 20, 200, 100, para('Native', { rPr: ' sz="1800" b="maybe"', rKids: '<a:latin typeface="Arial"/>' }))],
    ['invalid italic boolean', textBox(2, 20, 20, 200, 100, para('Native', { rPr: ' sz="1800" i="maybe"', rKids: '<a:latin typeface="Arial"/>' }))],
    ['unsupported run child', textBox(2, 20, 20, 200, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/><a:highlight/>' }))],
    ['non-text run child', textBox(2, 20, 20, 200, 100, para('Native')).replace('<a:t>Native</a:t>', '<a:t>Native</a:t><a:fld id="1"/>')],
    ['invalid font reference', textBox(2, 20, 20, 200, 100, para('Native')).replace('<p:spPr>', '<p:style><a:fontRef idx="9999"/></p:style><p:spPr>')],
    ['multiple font overrides', textBox(2, 20, 20, 200, 100, para('Native')).replace('<p:spPr>', '<p:style><a:fontRef idx="1001"><a:srgbClr val="112233"/><a:srgbClr val="445566"/></a:fontRef></p:style><p:spPr>')],
    ['unknown font alias', textBox(2, 20, 20, 200, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="+unknown"/>' }))],
    ['overlong font', textBox(2, 20, 20, 200, 100, para('Native', { rPr: ' sz="1800"', rKids: `<a:latin typeface="${'A'.repeat(65)}"/>` }))],
    ['missing body properties', textBox(2, 20, 20, 200, 100, para('Native'), { bodyPr: '' })],
  ])('refuses unsupported native appearance input: %s', async (_name, objectXml) => {
    const session = await openFixture(`<p:sld ${NS}>${tree(objectXml)}</p:sld>`);
    try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it('refuses inherited paragraph models that are not projected', async () => {
    const spacingMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:lnSpc><a:spcPts val="2400"/></a:lnSpc><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const bytes = await sourceReady(await buildPptx({ theme, master: spacingMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it.each([
    ['unsupported inherited attribute', '<a:defRPr baseline="1"/>'],
    ['underlined inherited run', '<a:defRPr u="sng"/>'],
    ['invalid inherited size', '<a:defRPr sz="bad"/>'],
    ['undersized inherited run', '<a:defRPr sz="99"/>'],
    ['oversized inherited run', '<a:defRPr sz="400001"/>'],
    ['empty inherited fill', '<a:defRPr><a:solidFill/></a:defRPr>'],
    ['unknown inherited colour', '<a:defRPr><a:solidFill><a:unknownClr/></a:solidFill></a:defRPr>'],
    ['unknown inherited font', '<a:defRPr><a:latin typeface="+unknown"/></a:defRPr>'],
    ['unsupported inherited child', '<a:defRPr><a:highlight/></a:defRPr>'],
  ])('refuses unsupported inherited text style: %s', async (_name, defRPr) => {
    const master = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr>${defRPr}</a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const bytes = await sourceReady(await buildPptx({ theme, master, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it('resolves paragraph defaults and refuses theme object defaults', async () => {
    const defaults = '<a:pPr><a:defRPr sz="1800" b="0" i="0"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr>';
    const box = textBox(2, 20, 20, 300, 100, para('Native', { pPr: defaults }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const session = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`);
    try {
      expect(session.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved)
        .toMatchObject({ color: '#ED7D31', bold: false, italic: false });
    } finally { session.dispose(); }

    const defaultsTheme = theme.replace('</a:themeElements>', '</a:themeElements><a:objectDefaults><a:txDef><a:bodyPr wrap="square"/></a:txDef></a:objectDefaults>');
    const objectDefaults = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`, { theme: defaultsTheme });
    try {
      expect(objectDefaults.document.themes[0].extensions.pptxObjectDefaults).toEqual({ txDef: true, spDef: false });
      expect(proof(objectDefaults.document.slides[0].objects[0])).toBeUndefined();
    } finally { objectDefaults.dispose(); }
  });

  it('refuses malformed backgrounds, geometry and oversized proof inputs', async () => {
    const variants = [
      ['slide', `<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100)).replace('<p:cSld>', '<p:cSld><p:bg/>')}</p:sld>`],
      ['slide', `<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100)).replace('<p:cSld>', '<p:cSld><p:bg><p:bgRef idx="nope"/></p:bg>')}</p:sld>`],
      ['slide', `<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100)).replace('<p:cSld>', '<p:cSld><p:bg><p:bgPr><a:gradFill/></p:bgPr></p:bg>')}</p:sld>`],
      ['object', `<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100).replace('<a:avLst/>', '<a:avLst/><a:unsupported/>'))}</p:sld>`],
      ['object', `<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100, '<a:ln w="9007199254740992"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln>'))}</p:sld>`],
      ['object', `<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100).replace('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', '<a:prstGeom prst="rect"><a:avLst/><a:avLst/></a:prstGeom>'))}</p:sld>`],
      ['object', `<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100).replace('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', ''))}</p:sld>`],
    ];
    for (const [target, slideXml] of variants) {
      const session = await openFixture(slideXml);
      try {
        expect(target === 'slide' ? session.document.slides[0].extensions.stagecraftSlideAppearance : proof(session.document.slides[0].objects[0])).toBeUndefined();
      } finally { session.dispose(); }
    }

    const manyRuns = '<a:p>' + Array.from({ length: 200 }, (_, index) => `<a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>x${index}</a:t></a:r>`).join('') + '</a:p>';
    const huge = textBox(2, 20, 20, 300, 100, manyRuns, { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const oversized = await openFixture(`<p:sld ${NS}>${tree(huge)}</p:sld>`);
    try { expect(proof(oversized.document.slides[0].objects[0])).toBeUndefined(); }
    finally { oversized.dispose(); }
  });

  it('proves supported none styles and empty paragraphs', async () => {
    for (const [style, tag] of [['<a:noFill/>', 'fillRef'], ['<a:ln><a:noFill/></a:ln>', 'lnRef']]) {
      const themed = tag === 'fillRef'
        ? theme.replace(/<a:fillStyleLst>[\s\S]*?<\/a:fillStyleLst>/, `<a:fillStyleLst>${style}</a:fillStyleLst>`)
        : theme.replace(/<a:lnStyleLst>[\s\S]*?<\/a:lnStyleLst>/, `<a:lnStyleLst>${style}</a:lnStyleLst>`);
      const objectXml = shape(2, 'rect', 20, 20, 200, 100, '', `<p:style><a:${tag} idx="1001"/></p:style>`);
      const session = await openFixture(`<p:sld ${NS}>${tree(objectXml)}</p:sld>`, { theme: themed });
      try { expect(proof(session.document.slides[0].objects[0])).toBeDefined(); }
      finally { session.dispose(); }
    }
    for (const paragraphs of ['<a:p/>', '<a:p><a:r><a:t>Native</a:t></a:r></a:p>']) {
      const box = textBox(2, 20, 20, 300, 100, paragraphs, { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
      const session = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`);
      try { expect(proof(session.document.slides[0].objects[0])).toBeDefined(); }
      finally { session.dispose(); }
    }
  });

  it.each([
    ['gradient fill style', '<a:gradFill/>', 'shape'],
    ['empty fill style', '<a:solidFill/>', 'shape'],
    ['invalid line style', '<a:ln w="9525"><a:headEnd/></a:ln>', 'line'],
    ['oversized line style', '<a:ln w="9007199254740992"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln>', 'line'],
  ])('refuses unsupported theme style vectors: %s', async (_name, style, kind) => {
    const themed = kind === 'shape'
      ? theme.replace(/<a:fillStyleLst>[\s\S]*?<\/a:fillStyleLst>/, `<a:fillStyleLst>${style}</a:fillStyleLst>`)
      : theme.replace(/<a:lnStyleLst>[\s\S]*?<\/a:lnStyleLst>/, `<a:lnStyleLst>${style}</a:lnStyleLst>`);
    const objectXml = shape(2, 'rect', 20, 20, 200, 100, '', `<p:style><a:${kind === 'shape' ? 'fillRef' : 'lnRef'} idx="1001"/></p:style>`);
    const session = await openFixture(`<p:sld ${NS}>${tree(objectXml)}</p:sld>`, { theme: themed });
    try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it('falls back to Calibri for incomplete theme fonts and handles empty inherited styles', async () => {
    const incompleteFonts = theme.replace(/<a:minorFont>[\s\S]*?<\/a:minorFont>/, '<a:minorFont/>');
    const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const fontSession = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`, { theme: incompleteFonts });
    try { expect(fontSession.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontFamily).toBe('Calibri'); }
    finally { fontSession.dispose(); }

    for (const otherStyle of ['', '<a:lvl1pPr/>']) {
      const master = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle>${otherStyle}</p:otherStyle></p:txStyles></p:sldMaster>`;
      const bytes = await sourceReady(await buildPptx({ theme, master, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
      const session = await openPresentation(bytes, { format: 'pptx', xml });
      try { expect(proof(session.document.slides[0].objects[0])).toBeDefined(); }
      finally { session.dispose(); }
    }

    for (const tag of ['fillStyleLst', 'lnStyleLst']) {
      const noStyles = theme.replace(new RegExp(`<a:${tag}>[\\s\\S]*?</a:${tag}>`), '');
      const ref = tag === 'fillStyleLst' ? 'fillRef' : 'lnRef';
      const objectXml = shape(2, 'rect', 20, 20, 200, 100, '', `<p:style><a:${ref} idx="1001"/></p:style>`);
      const noStyleSession = await openFixture(`<p:sld ${NS}>${tree(objectXml)}</p:sld>`, { theme: noStyles });
      try { expect(proof(noStyleSession.document.slides[0].objects[0])).toBeUndefined(); }
      finally { noStyleSession.dispose(); }
    }
  });

  it('refuses manual breaks, nonzero levels, visual defaults and inherited shape appearance', async () => {
    const variants = [
      textBox(2, 20, 20, 300, 100, '<a:p><a:br/><a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>Native</a:t></a:r></a:p>', { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' }),
      textBox(2, 20, 20, 300, 100, para('Native', { pPr: '<a:pPr lvl="1"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' }),
      textBox(2, 20, 20, 300, 100, para('Native', { pPr: '<a:pPr><a:defRPr baseline="30000"/></a:pPr>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' }),
      shape(2, 'rect', 20, 20, 300, 100).replace('<p:nvPr/>', '<p:nvPr><p:ph type="title"/></p:nvPr>'),
    ];
    for (const objectXml of variants) {
      const session = await openFixture(`<p:sld ${NS}>${tree(objectXml)}</p:sld>`);
      try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
      finally { session.dispose(); }
    }

    const defaultsTheme = theme.replace('</a:themeElements>', '</a:themeElements><a:objectDefaults><a:spDef><a:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:spPr></a:spDef></a:objectDefaults>');
    const themed = await openFixture(`<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 300, 100))}</p:sld>`, { theme: defaultsTheme });
    try { expect(proof(themed.document.slides[0].objects[0])).toBeUndefined(); }
    finally { themed.dispose(); }
  });

  it('resolves paragraph-default fonts and refuses background effects and stroke joins', async () => {
    const defaults = '<a:pPr><a:defRPr sz="1800"><a:latin typeface="Courier New"/><a:ea typeface="SimSun"/><a:cs typeface="DejaVu Sans"/></a:defRPr></a:pPr>';
    const box = textBox(2, 20, 20, 300, 100, para('Native', { pPr: defaults }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const session = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`);
    try {
      expect(session.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved)
        .toMatchObject({ fontFamily: 'Courier New', fontFamilyEastAsia: 'SimSun', fontFamilyComplexScript: 'DejaVu Sans' });
      expect(new TextEncoder().encode(nativeObjectAppearanceInput(session.document.slides[0].objects[0], appearanceContext(session.document, session.document.slides[0]))).byteLength).toBeLessThanOrEqual(16384);
    } finally { session.dispose(); }

    const effectBg = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
    const background = await openFixture(`<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100)).replace('<p:cSld>', `<p:cSld>${effectBg}`)}</p:sld>`);
    try { expect(background.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined(); }
    finally { background.dispose(); }

    const joined = await openFixture(`<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100, '<a:ln w="9525"><a:round/><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln>'))}</p:sld>`);
    try { expect(proof(joined.document.slides[0].objects[0])).toBeUndefined(); }
    finally { joined.dispose(); }

    const noneLineTheme = theme.replace(/<a:lnStyleLst>[\s\S]*?<\/a:lnStyleLst>/, '<a:lnStyleLst><a:ln><a:noFill/></a:ln></a:lnStyleLst>');
    const overriddenNone = shape(2, 'rect', 20, 20, 200, 100, '', '<p:style><a:lnRef idx="1001"><a:srgbClr val="112233"/></a:lnRef></p:style>');
    const noneLine = await openFixture(`<p:sld ${NS}>${tree(overriddenNone)}</p:sld>`, { theme: noneLineTheme });
    try { expect(proof(noneLine.document.slides[0].objects[0])).toBeUndefined(); }
    finally { noneLine.dispose(); }
  });

  it('refuses unresolved theme font aliases', async () => {
    const badFonts = theme.replace('<a:latin typeface="Arial"/>', '<a:latin typeface="+bogus"/>');
    const box = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const session = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`, { theme: badFonts });
    try { expect(proof(session.document.slides[0].objects[0])).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it('refuses missing inherited sizes and theme overrides', async () => {
    const noSizeMaster = `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const box = textBox(2, 20, 20, 300, 100, para('Native', { rKids: '<a:latin typeface="Arial"/>' }), { bodyPr: '<a:bodyPr><a:noAutofit/></a:bodyPr>' });
    const noSizeBytes = await sourceReady(await buildPptx({ theme, master: noSizeMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(box)}</p:sld>` }] }));
    const noSize = await openPresentation(noSizeBytes, { format: 'pptx', xml });
    try { expect(proof(noSize.document.slides[0].objects[0])).toBeUndefined(); }
    finally { noSize.dispose(); }

    const overrideBytes = await sourceReady(await buildPptx({
      theme, master: emptyMaster, layout: emptyLayout,
      slides: [{ xml: `<p:sld ${NS}>${tree(shape(2, 'rect', 20, 20, 200, 100, '<a:solidFill><a:srgbClr val="112233"/></a:solidFill>'))}</p:sld>`, extraRels: [['rIdO', 'themeOverride', '../theme/theme1.xml']] }],
    }));
    const override = await openPresentation(overrideBytes, { format: 'pptx', xml });
    try { expect(proof(override.document.slides[0].objects[0])).toBeUndefined(); }
    finally { override.dispose(); }
  });

  it('projects theme colours, empty inherited summaries, slide background, fill and stroke proofs', async () => {
    const styledShape = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Styled"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:style><a:fillRef idx="1001"/><a:lnRef idx="1001"/></p:style><p:spPr>${xfrm(20, 20, 200, 100)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
    const session = await openFixture(`<p:sld ${NS}>${tree(styledShape).replace('<p:cSld>', '<p:cSld><p:bg><p:bgRef idx="1001"/></p:bg>')}</p:sld>`);
    try {
      const document = session.document;
      expect(document.themes[0].extensions.pptxColorScheme.accent1).toBe('#4472C4');
      expect(document.layouts[0].extensions.stagecraftLayoutSummary).toMatchObject({
        appearanceResolved: true, background: { kind: 'solid', color: '#FFFFFF' }, artworkCount: 0,
      });
      expect(document.masters[0].extensions.stagecraftLayoutSummary).toMatchObject({ artworkCount: 0 });
      expect(document.slides[0].extensions.stagecraftSlideAppearance).toMatchObject({
        background: { kind: 'solid', color: '#FFFFFF' }, inheritedArtworkCount: 0,
      });
      expect(isNativeSlideAppearanceValid(document.slides[0], document)).toBe(true);
      const object = document.slides[0].objects[0];
      expect(object.shape).toBe('rect');
      expect(proof(object)).toMatchObject({
        fill: { kind: 'solid', color: '#203864' },
        stroke: { kind: 'solid', color: '#000000', widthEmu: 9525 },
      });
      const context = appearanceContext(document, document.slides[0]);
      expect(new TextEncoder().encode(proof(object).input).byteLength).toBeLessThanOrEqual(16384);
      expect(proof(object).input).toBe(nativeObjectAppearanceInput(object, context));
      expect(isNativeObjectAppearanceValid(object, context)).toBe(true);
      const changed = structuredClone(document);
      changed.themes[0].extensions.pptxFillStyles[0].color = '#000000';
      expect(isNativeObjectAppearanceValid(object, appearanceContext(changed, changed.slides[0]))).toBe(false);
    } finally { session.dispose(); }
  });

  it('projects supported roundRect adjustments', async () => {
    const rounded = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Rounded"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(20, 20, 200, 100)}<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:spPr></p:sp>`;
    const session = await openFixture(`<p:sld ${NS}>${tree(rounded)}</p:sld>`);
    try {
      const object = session.document.slides[0].objects[0];
      expect(object).toMatchObject({ type: 'shape', shape: 'roundRect' });
      expect(proof(object).adjust).toEqual({ adj: 25000 });
      expect(isNativeObjectAppearanceValid(object, appearanceContext(session.document, session.document.slides[0]))).toBe(true);
    } finally { session.dispose(); }
  });

  it('projects resolved theme text colour/fonts and paragraph end properties', async () => {
    const box = textBox(2, 20, 20, 300, 100,
      `<a:p><a:pPr algn="ctr"><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="1800"><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>Native</a:t></a:r><a:endParaRPr lang="en-US" sz="1600"><a:latin typeface="+mn-lt"/></a:endParaRPr></a:p>`,
      { bodyPr: '<a:bodyPr wrap="square" anchor="t"><a:noAutofit/></a:bodyPr>' });
    const session = await openFixture(`<p:sld ${NS}>${tree(box)}</p:sld>`);
    try {
      const object = session.document.slides[0].objects[0];
      expect(object.text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved).toEqual({
        color: '#203864', fontFamily: 'Arial', fontFamilyEastAsia: 'Noto Sans JP', fontFamilyComplexScript: 'Amiri',
        fontSizePt: 18, bold: false, italic: false,
      });
      expect(proof(object).text.paragraphs[0]).toMatchObject({
        id: object.text.paragraphs[0].id, runIds: [object.text.paragraphs[0].runs[0].id], alignment: 'center',
        endRun: { fontSizePt: 16, color: '#000000' },
      });
      expect(isNativeObjectAppearanceValid(object, appearanceContext(session.document, session.document.slides[0]))).toBe(true);
    } finally { session.dispose(); }
  });

  it.each([
    ['gradient fill', '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst></a:gradFill>'],
    ['effects', '<a:effectLst><a:outerShdw blurRad="38100" dist="25400" dir="5400000"/></a:effectLst>'],
    ['unsupported roundRect adjustment', '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="other" fmla="val 1"/></a:avLst></a:prstGeom>'],
  ])('omits the object proof for %s', async (_label, extra) => {
    const objectXml = shape(2, 'rect', 20, 20, 200, 100, extra);
    const session = await openFixture(`<p:sld ${NS}>${tree(objectXml)}</p:sld>`);
    try {
      expect(proof(session.document.slides[0].objects[0])).toBeUndefined();
    } finally { session.dispose(); }
  });

  it('omits proofs for native autofit and list-style text', async () => {
    const autofit = textBox(2, 20, 20, 300, 100, para('Native', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }), {
      bodyPr: '<a:bodyPr><a:normAutofit/></a:bodyPr>',
    });
    const listed = textBox(3, 20, 150, 300, 100, `<a:p><a:pPr><a:buChar char="•"/></a:pPr>${para('List', { rPr: ' sz="1800"', rKids: '<a:latin typeface="Arial"/>' }).replace('<a:p>', '').replace('</a:p>', '')}</a:p>`);
    const session = await openFixture(`<p:sld ${NS}>${tree(autofit + listed)}</p:sld>`);
    try {
      expect(session.document.slides[0].objects.every(object => !proof(object))).toBe(true);
    } finally { session.dispose(); }
  });

  it('ignores proof-only tampering during export and preserves native background edits after invalidation', async () => {
    const objectXml = shape(2, 'rect', 20, 20, 200, 100, '<a:solidFill><a:srgbClr val="112233"/></a:solidFill>');
    const bytes = await sourceReady(await buildPptx({ theme, master: emptyMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(objectXml)}</p:sld>` }] }));
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try {
      const tampered = structuredClone(session.document);
      delete tampered.slides[0].objects[0].extensions.stagecraftNativeAppearance;
      tampered.slides[0].extensions.stagecraftSlideAppearance.background.color = '#000000';
      const unchanged = await session.export(tampered);
      expect(unchanged.dirtyParts).toEqual([]);
      expect(Buffer.from(unchanged.bytes).equals(Buffer.from(bytes))).toBe(true);

      const noExtensions = structuredClone(session.document);
      delete noExtensions.slides[0].extensions;
      const proofOnlyDeletion = await session.export(noExtensions);
      expect(proofOnlyDeletion.dirtyParts).toEqual([]);
      expect(Buffer.from(proofOnlyDeletion.bytes).equals(Buffer.from(bytes))).toBe(true);

      const editor = createEditor({ document: session.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
      try {
        expect(editor.dispatch('presentation.setSlideProperties', {
          slideId: session.document.slides[0].id,
          properties: { background: { type: 'solid', color: '#000000' } },
        }).changed).toBe(true);
        expect(editor.getSnapshot().document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();
        const output = await session.export(editor.getSnapshot().document);
        const reopened = await openPresentation(output.bytes, { format: 'pptx', xml });
        try { expect(reopened.document.slides[0].background).toEqual({ type: 'solid', color: '#000000' }); }
        finally { reopened.dispose(); }
      } finally { editor.dispose(); }
    } finally { session.dispose(); }
  });

  it('keeps untouched native export bytes identical after projection', async () => {
    const objectXml = shape(2, 'rect', 20, 20, 200, 100, '<a:solidFill><a:srgbClr val="112233"/></a:solidFill>');
    const bytes = await sourceReady(await buildPptx({ theme, master: emptyMaster, layout: emptyLayout, slides: [{ xml: `<p:sld ${NS}>${tree(objectXml)}</p:sld>` }] }));
    const session = await openPresentation(bytes, { format: 'pptx', xml });
    try {
      expect(proof(session.document.slides[0].objects[0])).toBeTruthy();
      const output = await session.export(session.document);
      expect(output.dirtyParts).toEqual([]);
      expect(Buffer.from(output.bytes).equals(Buffer.from(bytes))).toBe(true);
    } finally { session.dispose(); }
  });
});
