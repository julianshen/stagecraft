// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { openPresentation } from './index.js';
import { isNativeObjectAppearanceValid, isNativeSlideAppearanceValid } from '@stagecraft/core/lib/nativeAppearance.js';
import { NS, buildPptx, para, shape, textBox, tree, xfrm } from '../../../tests/helpers/pptxFixture.js';

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

async function openFixture(slideXml, options = {}) {
  const bytes = await sourceReady(await buildPptx({
    theme, master: emptyMaster, layout: emptyLayout,
    slides: [{ xml: slideXml }], ...options,
  }));
  return openPresentation(bytes, { format: 'pptx', xml });
}

const proof = object => object.extensions.stagecraftNativeAppearance;

describe('native PPTX appearance projection', () => {
  it('refuses a slide proof when its own background is an unsupported gradient', async () => {
    const gradientBg = '<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst></a:gradFill></p:bgPr></p:bg>';
    const session = await openFixture(`<p:sld ${NS}>${tree('').replace('<p:cSld>', `<p:cSld>${gradientBg}`)}</p:sld>`);
    try { expect(session.document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined(); }
    finally { session.dispose(); }
  });

  it('honours colour overrides on fillRef, lnRef and fontRef', async () => {
    const styled = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Styled"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:style><a:fillRef idx="1001"><a:schemeClr val="accent2"/></a:fillRef><a:lnRef idx="1001"><a:schemeClr val="accent2"/></a:lnRef></p:style><p:spPr>${xfrm(20, 20, 200, 100)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
    const session = await openFixture(`<p:sld ${NS}>${tree(styled)}</p:sld>`);
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
      expect(isNativeObjectAppearanceValid(object)).toBe(true);
    } finally { session.dispose(); }
  });

  it('projects supported roundRect adjustments', async () => {
    const rounded = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Rounded"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(20, 20, 200, 100)}<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:spPr></p:sp>`;
    const session = await openFixture(`<p:sld ${NS}>${tree(rounded)}</p:sld>`);
    try {
      const object = session.document.slides[0].objects[0];
      expect(object).toMatchObject({ type: 'shape', shape: 'roundRect' });
      expect(proof(object).adjust).toEqual({ adj: 25000 });
      expect(isNativeObjectAppearanceValid(object)).toBe(true);
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
      expect(isNativeObjectAppearanceValid(object)).toBe(true);
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
