import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { importPptx } from './pptxImport.js';
import { sanitizeSlidePatch } from './deckUtils.js';
import { flattenDeck } from './deckOrder.js';
import {
  buildPptx, slideXml, textBox, para, shape, xfrm, tree, NS, PX, DEFAULT_MASTER, DEFAULT_THEME,
} from '../test/pptxFixture.js';

const one = async (inner, opts = {}, pkg = {}) => {
  const { deck, warnings } = await importPptx(await buildPptx({ slides: [{ xml: slideXml(inner, opts), ...(opts.slide || {}) }], ...pkg }));
  return { slide: deck.slides[0], deck, warnings };
};
// DEFAULT_THEME with its accent1/accent2 slots replaced by `slots`.
const DEFAULT_THEME_WITH = (slots) => DEFAULT_THEME.replace(/<a:accent1>[\s\S]*<\/a:accent2>/, slots);
const els = (slide, type) => slide.elements.filter((e) => e.type === type);
// 1×1 transparent PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

describe('importPptx — package handling', () => {
  it('rejects a non-zip input with a readable error', async () => {
    await expect(importPptx(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a valid \.pptx/i);
  });

  it('rejects a zip that is not a presentation', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document xmlns:w="w"/>');
    await expect(importPptx(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/not a powerpoint/i);
  });

  it('takes the deck title + author from docProps/core.xml', async () => {
    const { deck } = await importPptx(await buildPptx({ slides: [{ xml: slideXml('') }], core: { title: 'Q3 Review', creator: 'Ada' } }));
    expect(deck.title).toBe('Q3 Review');
    expect(deck.author).toBe('Ada');
  });

  it('falls back to the file name for the title', async () => {
    const { deck } = await importPptx(await buildPptx({ slides: [{ xml: slideXml('') }] }), { fileName: 'board-deck.pptx' });
    expect(deck.title).toBe('board-deck');
  });

  it('imports every slide, in presentation order, as a blank slide in one section', async () => {
    const { deck } = await importPptx(await buildPptx({ slides: [
      { xml: slideXml(textBox(2, 0, 0, 100, 50, para('First'))) },
      { xml: slideXml(textBox(2, 0, 0, 100, 50, para('Second'))) },
    ] }));
    expect(deck.slides.map((s) => s.layout)).toEqual(['blank', 'blank']);
    expect(deck.sections).toHaveLength(1);
    expect(flattenDeck(deck).map((s) => s.elements[0].content)).toEqual(['First', 'Second']);
  });

  it('produces elements that all pass the slide-patch gate', async () => {
    const { slide } = await one(textBox(2, 10, 10, 300, 80, para('Hello')) + shape(3, 'ellipse', 0, 0, 50, 50, '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>'));
    expect(sanitizeSlidePatch({ elements: slide.elements, bgColor: slide.bgColor }, 'blank')).toEqual({ elements: slide.elements, bgColor: slide.bgColor });
  });
});

describe('importPptx — geometry', () => {
  it('maps EMU positions onto the 1920×1080 canvas (16:9)', async () => {
    const { slide } = await one(textBox(2, 100, 200, 300, 40, para('Box')));
    expect(slide.elements[0]).toMatchObject({ x: 100, y: 200, w: 300, h: 40 });
  });

  it('letterboxes a 4:3 deck (uniform scale, centred)', async () => {
    // 10in × 7.5in → height-bound: k = 1080 / 6858000; width 1440px, offset 240px.
    const { slide } = await one(textBox(2, 0, 0, 10, 10, para('x')), {}, { size: { cx: 9144000, cy: 6858000 } });
    expect(slide.elements[0].x).toBe(240);
    expect(slide.elements[0].y).toBe(0);
  });

  it('carries rotation', async () => {
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="R"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 100, 100, ' rot="2700000"')}<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></p:spPr></p:sp>`;
    const { slide } = await one(sp);
    expect(slide.elements[0].rot).toBe(45);
  });

  it('maps a group\'s child coordinate space onto its box and tags members with a groupId', async () => {
    const grp = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="${100 * PX}" y="${100 * PX}"/><a:ext cx="${200 * PX}" cy="${200 * PX}"/><a:chOff x="0" y="0"/><a:chExt cx="${100 * PX}" cy="${100 * PX}"/></a:xfrm></p:grpSpPr>
      ${shape(3, 'rect', 10, 10, 50, 50, '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>')}
      ${shape(4, 'rect', 60, 60, 10, 10, '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>')}</p:grpSp>`;
    const { slide } = await one(grp);
    expect(slide.elements[0]).toMatchObject({ x: 120, y: 120, w: 100, h: 100 });
    expect(slide.elements[0].groupId).toBeTruthy();
    expect(slide.elements[1].groupId).toBe(slide.elements[0].groupId);
  });

  it('inherits a placeholder\'s position from the master when the slide omits xfrm', async () => {
    const title = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
      <p:txBody><a:bodyPr/>${para('Inherited')}</p:txBody></p:sp>`;
    const { slide } = await one(title);
    expect(slide.elements[0]).toMatchObject({ x: 100, y: 50, w: 1720, h: 150, content: 'Inherited' });
    expect(slide.title).toBe('Inherited');
  });

  it('prefers the layout placeholder (matched by idx) over the master', async () => {
    const layout = `<p:sldLayout ${NS}>${tree(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(300, 300, 500, 200)}</p:spPr></p:sp>`)}</p:sldLayout>`;
    const body = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
      <p:txBody><a:bodyPr/>${para('Point')}</p:txBody></p:sp>`;
    const { slide } = await one(body, {}, { layout });
    expect(slide.elements[0]).toMatchObject({ x: 300, y: 300, w: 500, h: 200 });
  });
});

describe('importPptx — text', () => {
  it('reads run formatting: size (pt→px), bold/italic/underline, colour, font, alignment, anchor', async () => {
    const { slide } = await one(textBox(2, 0, 0, 400, 100,
      para('Styled', { rPr: ' sz="2400" b="1" i="1" u="sng"', rKids: '<a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:latin typeface="Calibri"/>', pPr: '<a:pPr algn="ctr"/>' }),
      { bodyPr: '<a:bodyPr anchor="b"/>' }));
    expect(slide.elements[0]).toMatchObject({
      type: 'text', content: 'Styled', fontSize: 48, bold: true, italic: true, underline: true,
      fill: '#C00000', fontFamily: 'Calibri', align: 'center', valign: 'bottom',
    });
  });

  it('joins paragraphs and line breaks with newlines', async () => {
    const p = '<a:p><a:r><a:t>One</a:t></a:r><a:br/><a:r><a:t>Two</a:t></a:r></a:p>' + para('Three');
    const { slide } = await one(textBox(2, 0, 0, 400, 100, p));
    expect(slide.elements[0].content).toBe('One\nTwo\nThree');
  });

  it('defaults a plain text box to 18pt, top-anchored, left-aligned, theme tx1 ink', async () => {
    const { slide } = await one(textBox(2, 0, 0, 400, 100, para('Plain')));
    expect(slide.elements[0]).toMatchObject({ fontSize: 36, valign: 'top', align: 'left', fill: '#000000' });
  });

  it('inherits master text styles for placeholders: title font (+mj-lt), body bullets per level', async () => {
    const title = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${para('Heading')}</p:txBody></p:sp>`;
    const body = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>
      ${para('Top')}${para('Nested', { pPr: '<a:pPr lvl="1"/>' })}${para('No bullet', { pPr: '<a:pPr><a:buNone/></a:pPr>' })}</p:txBody></p:sp>`;
    const { slide } = await one(title + body);
    const [t, b] = slide.elements;
    expect(t).toMatchObject({ fontSize: 88, fontFamily: 'Georgia' });
    expect(b.content).toBe('• Top\n  – Nested\nNo bullet');
    expect(b).toMatchObject({ fontSize: 56, fontFamily: 'Arial' });
  });

  it('applies normAutofit fontScale', async () => {
    const { slide } = await one(textBox(2, 0, 0, 400, 100, para('Shrunk', { rPr: ' sz="4000"' }), { bodyPr: '<a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr>' }));
    expect(slide.elements[0].fontSize).toBe(40);
  });

  it('maps line spacing percent onto the canvas multiplier', async () => {
    const { slide } = await one(textBox(2, 0, 0, 400, 100, para('Spaced', { pPr: '<a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr>' })));
    expect(slide.elements[0].lineSpacing).toBe(1.8);
  });

  it('resolves scheme colours through the colour map + lumMod/lumOff', async () => {
    const rKids = '<a:solidFill><a:schemeClr val="tx1"><a:lumMod val="50000"/><a:lumOff val="50000"/></a:schemeClr></a:solidFill>';
    const { slide } = await one(textBox(2, 0, 0, 400, 100, para('Grey', { rKids })));
    expect(slide.elements[0].fill).toBe('#808080');
  });

  it('skips empty text bodies', async () => {
    const { slide } = await one(textBox(2, 0, 0, 400, 100, '<a:p><a:endParaRPr/></a:p>'));
    expect(slide.elements).toEqual([]);
  });

  it('drops slide-number / date / footer placeholders', async () => {
    const ph = (type) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr><p:txBody><a:bodyPr/>${para('7')}</p:txBody></p:sp>`;
    const { slide } = await one(ph('sldNum') + ph('dt') + ph('ftr'));
    expect(slide.elements).toEqual([]);
  });
});

describe('importPptx — shapes, lines, pictures, tables', () => {
  it('maps preset geometry to element types with fill + outline', async () => {
    const { slide } = await one(shape(2, 'roundRect', 0, 0, 100, 100,
      '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="dash"/></a:ln>'));
    expect(slide.elements[0]).toMatchObject({ type: 'rounded', fill: '#4472C4', stroke: '#000000', strokeWidth: 4, strokeDash: 'dashed' });
  });

  it('imports an unknown preset as a (sharp) rectangle and says so', async () => {
    const { slide, warnings } = await one(shape(2, 'cloud', 0, 0, 100, 100, '<a:solidFill><a:srgbClr val="AAAAAA"/></a:solidFill>'));
    expect(slide.elements[0].type).toBe('rect');
    expect(warnings.join(' ')).toMatch(/cloud/);
  });

  it('uses the shape style fillRef when spPr has no fill', async () => {
    const style = '<p:style><a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>';
    const { slide } = await one(shape(2, 'ellipse', 0, 0, 100, 100, '', style + `<p:txBody><a:bodyPr anchor="ctr"/>${para('In')}</p:txBody>`));
    expect(slide.elements[0]).toMatchObject({ type: 'circle', fill: '#ED7D31' });
    // The text rides on top, coloured by the style fontRef.
    expect(slide.elements[1]).toMatchObject({ type: 'text', content: 'In', fill: '#FFFFFF', valign: 'middle' });
  });

  it('lets a shape style fontRef colour beat the master otherStyle default', async () => {
    const master = DEFAULT_MASTER.replace('<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/>',
      '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr>');
    const style = '<p:style><a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>';
    const { slide } = await one(shape(2, 'rect', 0, 0, 100, 100, '', style + `<p:txBody><a:bodyPr/>${para('White')}</p:txBody>`), {}, { master });
    expect(els(slide, 'text')[0].fill).toBe('#FFFFFF');
  });

  it('turns an outline-only shape into a closed stroked path', async () => {
    const { slide } = await one(shape(2, 'rect', 0, 0, 100, 100, '<a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>'));
    expect(slide.elements[0]).toMatchObject({ type: 'path', stroke: '#FF0000', strokeWidth: 2 });
    expect(slide.elements[0].points[0]).toEqual(slide.elements[0].points.at(-1)); // closed
  });

  it('keeps a gradient fill (first/last stop + CSS angle)', async () => {
    const grad = '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>';
    const { slide } = await one(shape(2, 'rect', 0, 0, 100, 100, grad));
    expect(slide.elements[0]).toMatchObject({ fill: '#000000', gradient: { from: '#000000', to: '#FFFFFF', angle: 90 } });
  });

  it('maps fill alpha onto element opacity', async () => {
    const { slide } = await one(shape(2, 'rect', 0, 0, 100, 100, '<a:solidFill><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:solidFill>'));
    expect(slide.elements[0].opacity).toBe(40);
  });

  it('converts a connector into a rotated line bar', async () => {
    const cxn = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="L"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
      <p:spPr>${xfrm(0, 0, 100, 100, ' flipV="1"')}<a:prstGeom prst="line"/><a:ln w="38100"><a:solidFill><a:srgbClr val="333333"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
    const { slide } = await one(cxn);
    const l = slide.elements[0];
    expect(l).toMatchObject({ type: 'line', fill: '#333333', h: 6, rot: -45 });
    expect(l.w).toBeCloseTo(141.42, 1);
  });

  it('embeds pictures as data URLs', async () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId10"/></p:blipFill><p:spPr>${xfrm(10, 20, 30, 40)}<a:prstGeom prst="rect"/></p:spPr></p:pic>`;
    const { slide } = await one(pic, { slide: { extraRels: [['rId10', 'image', '../media/image1.png']] } }, { media: { 'image1.png': PNG } });
    expect(slide.elements[0]).toMatchObject({ type: 'image', x: 10, y: 20, w: 30, h: 40 });
    expect(slide.elements[0].src).toMatch(/^data:image\/png;base64,/);
  });

  it('skips a picture format the browser cannot show, with a warning', async () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId10"/></p:blipFill><p:spPr>${xfrm(10, 20, 30, 40)}</p:spPr></p:pic>`;
    const { slide, warnings } = await one(pic, { slide: { extraRels: [['rId10', 'image', '../media/image1.emf']] } }, { media: { 'image1.emf': new Uint8Array([0]) } });
    expect(slide.elements).toEqual([]);
    expect(warnings.join(' ')).toMatch(/\.emf/);
  });

  it('draws a native table as a grid of cells', async () => {
    const tbl = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="${200 * PX}" cy="${100 * PX}"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="${100 * PX}"/><a:gridCol w="${100 * PX}"/></a:tblGrid>
        <a:tr h="${50 * PX}"><a:tc><a:txBody><a:bodyPr/>${para('A')}</a:txBody><a:tcPr><a:solidFill><a:srgbClr val="DDDDDD"/></a:solidFill></a:tcPr></a:tc><a:tc><a:txBody><a:bodyPr/>${para('B')}</a:txBody><a:tcPr/></a:tc></a:tr>
        <a:tr h="${50 * PX}"><a:tc gridSpan="2"><a:txBody><a:bodyPr/>${para('Wide')}</a:txBody><a:tcPr/></a:tc><a:tc hMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const { slide } = await one(tbl);
    const cells = els(slide, 'rect');
    expect(cells).toHaveLength(3);
    expect(cells[0]).toMatchObject({ x: 0, y: 0, w: 100, h: 50, fill: '#DDDDDD' });
    expect(cells[2]).toMatchObject({ x: 0, y: 50, w: 200, h: 50 });
    expect(els(slide, 'text').map((t) => t.content)).toEqual(['A', 'B', 'Wide']);
    expect(els(slide, 'text')[0].valign).toBe('top'); // PowerPoint's cell default anchor
    expect(new Set(slide.elements.map((e) => e.groupId)).size).toBe(1);
  });

  it('honours a cell anchor and warns that table styles are not applied', async () => {
    const tbl = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="${100 * PX}" cy="${50 * PX}"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"><a:tableStyleId>{X}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="${100 * PX}"/></a:tblGrid>
        <a:tr h="${50 * PX}"><a:tc><a:txBody><a:bodyPr/>${para('Mid')}</a:txBody><a:tcPr anchor="ctr"/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const { slide, warnings } = await one(tbl);
    expect(els(slide, 'text')[0].valign).toBe('middle');
    expect(warnings.join(' ')).toMatch(/table style/i);
  });

  it('marks a chart with an honest placeholder + warning', async () => {
    const chart = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="C"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="${200 * PX}" cy="${100 * PX}"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="c" r:id="rId9"/></a:graphicData></a:graphic></p:graphicFrame>`;
    const { slide, warnings } = await one(chart);
    expect(els(slide, 'text')[0].content).toMatch(/chart — not imported/);
    expect(warnings.join(' ')).toMatch(/chart/);
  });
});

describe('importPptx — slide-level properties', () => {
  it('reads a solid slide background', async () => {
    const { slide } = await one('', { bg: '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0E0E1A"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' });
    expect(slide.bgColor).toBe('#0E0E1A');
  });

  it('inherits the master background via bgRef, else the theme bg1', async () => {
    const master = DEFAULT_MASTER.replace('<p:cSld>', '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="tx2"/></p:bgRef></p:bg>');
    expect((await one('', {}, { master })).slide.bgColor).toBe('#1F2937');
    expect((await one('')).slide.bgColor).toBe('#FFFFFF');
  });

  it('turns a picture background into a full-bleed image under the content', async () => {
    const bg = '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId10"/></a:blipFill></p:bgPr></p:bg>';
    const { slide } = await one(textBox(2, 0, 0, 10, 10, para('Over')), { bg, slide: { extraRels: [['rId10', 'image', '../media/bg.png']] } }, { media: { 'bg.png': PNG } });
    expect(slide.elements[0]).toMatchObject({ type: 'image', x: 0, y: 0, w: 1920, h: 1080 });
    expect(slide.elements[1].content).toBe('Over');
  });

  it('draws non-placeholder master art beneath the slide, unless showMasterSp="0"', async () => {
    const master = DEFAULT_MASTER.replace('</p:spTree>', `${shape(9, 'rect', 0, 1000, 1920, 80, '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>')}</p:spTree>`);
    const shown = await one(textBox(2, 0, 0, 10, 10, para('Top')), {}, { master });
    expect(shown.slide.elements.map((e) => e.type)).toEqual(['rect', 'text']);
    const hidden = await one(textBox(2, 0, 0, 10, 10, para('Top')), { attrs: ' showMasterSp="0"' }, { master });
    expect(hidden.slide.elements.map((e) => e.type)).toEqual(['text']);
  });

  it('imports speaker notes', async () => {
    const { slide } = await one('', { slide: { notes: 'Say this\nThen that' } });
    expect(slide.notes).toBe('Say this\nThen that');
  });

  it('maps slide transitions onto the presenter vocabulary', async () => {
    const t = async (after) => (await one('', { after })).slide.transition;
    expect(await t('<p:transition spd="fast"><p:fade/></p:transition>')).toEqual({ type: 'fade', duration: 500 });
    expect(await t('<p:transition xmlns:p14="p14" p14:dur="1200"><p:push dir="u"/></p:transition>')).toEqual({ type: 'slide', duration: 1200 });
    expect(await t('')).toBeUndefined();
  });

  it('names a slide by its title placeholder, else its first text, else by position', async () => {
    const { deck } = await importPptx(await buildPptx({ slides: [
      { xml: slideXml(textBox(2, 0, 0, 10, 10, para('Loose heading') + para('more'))) },
      { xml: slideXml('') },
    ] }));
    expect(deck.slides.map((s) => s.title)).toEqual(['Loose heading', 'Slide 2']);
  });

  it('maps PowerPoint sections onto deck sections', async () => {
    const { deck } = await importPptx(await buildPptx({
      slides: [{ xml: slideXml('') }, { xml: slideXml('') }, { xml: slideXml('') }],
      sections: [{ name: 'Intro', slides: [0] }, { name: 'Body', slides: [1] }],
    }));
    expect(deck.sections.map((s) => [s.name, s.slides.length])).toEqual([['Intro', 1], ['Body', 1], ['Other slides', 1]]);
  });
});

describe('importPptx — OOXML edge cases', () => {
  const fillShape = (clr, extra = '') => shape(2, 'rect', 0, 0, 10, 10, `<a:solidFill>${clr}</a:solidFill>${extra}`);
  const fillOfShape = async (clr) => (await one(fillShape(clr))).slide.elements[0]?.fill;

  it('resolves preset, system and modified colours', async () => {
    expect(await fillOfShape('<a:prstClr val="red"/>')).toBe('#FF0000');
    expect(await fillOfShape('<a:sysClr val="window"/>')).toBe('#FFFFFF');
    expect(await fillOfShape('<a:sysClr val="windowText"/>')).toBe('#000000');
    expect(await fillOfShape('<a:srgbClr val="FFFFFF"><a:shade val="50000"/></a:srgbClr>')).toBe('#808080');
    expect(await fillOfShape('<a:srgbClr val="000000"><a:tint val="50000"/></a:srgbClr>')).toBe('#808080');
    // lumMod across hues (the HSL round trip — red/green/blue-dominant + light).
    expect(await fillOfShape('<a:srgbClr val="00FF00"><a:lumMod val="50000"/></a:srgbClr>')).toBe('#008000');
    expect(await fillOfShape('<a:srgbClr val="0000FF"><a:lumMod val="50000"/></a:srgbClr>')).toBe('#000080');
    expect(await fillOfShape('<a:srgbClr val="FF8080"><a:lumMod val="90000"/></a:srgbClr>')).toMatch(/^#FF/);
  });

  it('skips a shape whose fill colour cannot be resolved and that has no outline', async () => {
        expect(await fillOfShape('<a:schemeClr val="phClr"/>')).toBeUndefined();
    expect(await fillOfShape('<a:prstClr val="notAColour"/>')).toBeUndefined();
    const noStops = '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs></a:gsLst></a:gradFill>';
    expect((await one(shape(2, 'rect', 0, 0, 10, 10, noStops))).slide.elements).toEqual([]);
  });

  it('outlines an unfilled ellipse as a closed polygon of the ellipse', async () => {
    const { slide } = await one(shape(2, 'ellipse', 0, 0, 100, 100, '<a:noFill/><a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="sysDot"/></a:ln>'));
    expect(slide.elements[0]).toMatchObject({ type: 'path', strokeDash: 'dotted' });
    expect(slide.elements[0].points).toHaveLength(33);
  });

  it('outlines an unfilled polygon preset along its own shape', async () => {
    const { slide } = await one(shape(2, 'triangle', 0, 0, 100, 100, '<a:noFill/><a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>'));
    expect(slide.elements[0].points).toEqual([[0.5, 0], [1, 1], [0, 1], [0.5, 0]]);
  });

  it('skips a picture over the 10 MB embed cap, with a warning', async () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId10"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic>`;
    const { slide, warnings } = await one(pic, { slide: { extraRels: [['rId10', 'image', '../media/big.png']] } }, { media: { 'big.png': new Uint8Array(10 * 1024 * 1024 + 3) } });
    expect(slide.elements).toEqual([]);
    expect(warnings.join(' ')).toMatch(/larger than 10 MB/);
  });

  it('decodes master art once and shares it across slides', async () => {
    const master = DEFAULT_MASTER.replace('</p:spTree>', `<p:pic><p:nvPicPr><p:cNvPr id="9" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdL"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic></p:spTree>`);
    const bytes = await buildPptx({ slides: [{ xml: slideXml('') }, { xml: slideXml('') }], master, masterRels: [['rIdL', 'image', '../media/logo.png']], media: { 'logo.png': PNG } });
    // Count reads of the logo entry through the zip-entry prototype.
    const entryProto = Object.getPrototypeOf(new JSZip().file('x', '').file('x'));
    const spy = vi.spyOn(entryProto, 'async');
    try {
      const { deck } = await importPptx(bytes);
      expect(deck.slides.map((s) => s.elements[0].type)).toEqual(['image', 'image']);
      expect(deck.slides[0].elements[0].src).toBe(deck.slides[1].elements[0].src);
      expect(spy.mock.contexts.filter((f) => f.name === 'ppt/media/logo.png')).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });

  it('imports a custom geometry as a rectangle', async () => {
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="C"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 10, 10)}<a:custGeom/><a:solidFill><a:srgbClr val="010101"/></a:solidFill></p:spPr></p:sp>`;
    expect((await one(sp)).slide.elements[0].type).toBe('rect');
  });

  it('handles groups without a child space, nested groups and AlternateContent', async () => {
    const inner = shape(3, 'rect', 5, 5, 10, 10, '<a:solidFill><a:srgbClr val="111111"/></a:solidFill>');
    const flat = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
      <p:grpSp><p:nvGrpSpPr><p:cNvPr id="8" name="H"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:grpSp></p:grpSp>`;
    const alt = `<mc:AlternateContent xmlns:mc="mc"><mc:Choice Requires="x"><p:sp/></mc:Choice><mc:Fallback>${inner}</mc:Fallback></mc:AlternateContent>
      <mc:AlternateContent xmlns:mc="mc"/>`;
    const { slide } = await one(flat + alt + '<p:extLst/>');
    expect(slide.elements.map((e) => [e.x, e.y])).toEqual([[5, 5], [5, 5]]);
    expect(slide.elements[0].groupId).toBeTruthy();
    expect(slide.elements[1].groupId).toBeUndefined();
  });

  it('skips shapes it cannot place (no geometry anywhere)', async () => {
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="X"/><p:cNvSpPr/><p:nvPr><p:ph type="pic" idx="42"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${para('lost')}</p:txBody></p:sp>`;
    const pic = '<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdZ"/></p:blipFill><p:spPr/></p:pic>';
    const half = `<p:sp><p:nvSpPr><p:cNvPr id="5" name="H"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/></a:xfrm></p:spPr></p:sp>`;
    expect((await one(sp + pic + half)).slide.elements).toEqual([]);
  });

  it('resolves pictures by absolute target, and skips external / missing ones with a warning', async () => {
    const pic = (rid) => `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic>`;
    const { slide, warnings } = await one(pic('rIdA') + pic('rIdE') + pic('rIdMissing') + pic('rIdGone'), {
      slide: { extraRels: [['rIdA', 'image', '/ppt/media/a.JPG'], ['rIdE', 'image', 'http://x/y.png', 'External'], ['rIdGone', 'image', '../media/gone.png']] },
    }, { media: { 'a.JPG': PNG } });
    expect(slide.elements).toHaveLength(1);
    expect(slide.elements[0].src).toMatch(/^data:image\/jpeg;base64,/);
    expect(warnings.join(' ')).toMatch(/linked/);
    expect(warnings.join(' ')).toMatch(/\.png picture/);
  });

  it('draws nothing for a line without a colour; flips + alpha a coloured one', async () => {
    const cxn = (ln, flip = '') => `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="L"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(0, 0, 100, 0, flip)}<a:prstGeom prst="straightConnector1"/>${ln}</p:spPr></p:cxnSp>`;
    expect((await one(cxn(''))).slide.elements).toEqual([]);
    const { slide } = await one(cxn('<a:ln><a:solidFill><a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:solidFill></a:ln>', ' flipH="1"'));
    expect(slide.elements[0]).toMatchObject({ type: 'line', w: 100, h: 2, rot: 180, opacity: 50 });
  });

  it('reads field runs, auto-numbered and char-less bullets, right alignment, defRPr bold, underline none', async () => {
    const body = `<a:lstStyle><a:lvl1pPr algn="r"><a:defRPr b="1" u="none"/></a:lvl1pPr></a:lstStyle>
      <a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:fld id="{1}" type="slidenum"><a:t>7</a:t></a:fld></a:p>
      <a:p><a:r><a:t> </a:t></a:r></a:p>
      <a:p><a:pPr><a:buChar/></a:pPr><a:r><a:rPr><a:latin typeface="+mn-lt"/></a:rPr><a:t>Item</a:t></a:r><a:r><a:t/></a:r></a:p>`;
    const { slide } = await one(textBox(2, 0, 0, 100, 100, body));
    expect(slide.elements[0]).toMatchObject({ content: '1. 7\n \n• Item', align: 'right', bold: true, valign: 'top' });
    expect(slide.elements[0].underline).toBeUndefined();
    expect(slide.elements[0].fontFamily).toBeUndefined(); // the element takes its first run's (the field's) font — none
  });

  it('maps +mn-lt run fonts to the theme minor font and semi-transparent text to opacity', async () => {
    const { slide } = await one(textBox(2, 0, 0, 100, 100, para('T', { rKids: '<a:solidFill><a:srgbClr val="000000"><a:alpha val="25000"/></a:srgbClr></a:solidFill><a:latin typeface="+mn-lt"/>' })));
    expect(slide.elements[0]).toMatchObject({ fontFamily: 'Arial', opacity: 25 });
  });

  it('maps every transition variant (morph, bare, unknown effect, speed defaults)', async () => {
    const t = async (after) => (await one('', { after })).slide.transition;
    expect(await t('<p:transition><p159:morph xmlns:p159="p159"/></p:transition>')).toEqual({ type: 'morph', duration: 750 });
    expect(await t('<p:transition spd="slow"/>')).toEqual({ type: 'fade', duration: 1000 });
    expect(await t('<p:transition xmlns:p14="p14" p14:dur="0"><p:sndAc/><p:zoom/></p:transition>')).toEqual({ type: 'fade', duration: 750 });
  });

  it('skips slides whose part is missing and works without a layout / master', async () => {
    const zip = await JSZip.loadAsync(await buildPptx({ slides: [{ xml: slideXml(textBox(2, 0, 0, 10, 10, para('Lone'))) }, { xml: slideXml('') }] }));
    zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    zip.remove('ppt/slides/slide2.xml');
    const pres = await zip.file('ppt/presentation.xml').async('string');
    zip.file('ppt/presentation.xml', pres.replace('</p:sldIdLst>', '<p:sldId id="999" r:id="rIdNope"/></p:sldIdLst>').replace(/<p:sldSz[^>]*\/>/, ''));
    const { deck } = await importPptx(await zip.generateAsync({ type: 'uint8array' }));
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0]).toMatchObject({ bgColor: '#FFFFFF', title: 'Lone' });
    expect(deck.slides[0].elements[0].fill).toBe('#000000');
    expect(deck.title).toBe('Imported presentation');
  });

  it('honours a slide colour-map override and warns about hidden slides', async () => {
    const after = '<p:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"/></p:clrMapOvr>';
    const { slide, warnings } = await one(textBox(2, 0, 0, 10, 10, para('Inverse')), { after, attrs: ' show="0"' });
    expect(slide.bgColor).toBe('#000000');
    expect(slide.elements[0].fill).toBe('#FFFFFF');
    expect(warnings.join(' ')).toMatch(/hidden/i);
  });

  it('tolerates a theme without colours/fonts and a master without a colour map or text styles', async () => {
    const theme = `<a:theme ${NS}><a:themeElements/></a:theme>`;
    const master = `<p:sldMaster ${NS}>${tree('')}</p:sldMaster>`;
    const { slide } = await one(textBox(2, 0, 0, 10, 10, para('Bare')), {}, { theme, master });
    expect(slide.elements[0]).toMatchObject({ fill: '#000000', fontSize: 36 });
  });

  it('reads gradient + layout backgrounds, and falls through an unresolvable one', async () => {
    const grad = '<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="0000AA"/></a:gs></a:gsLst></a:gradFill></p:bgPr></p:bg>';
    expect((await one('', { bg: grad })).slide.bgColor).toBe('#0000AA');
    const layout = `<p:sldLayout ${NS}>${tree('').replace('<p:cSld>', '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></p:bgPr></p:bg>')}</p:sldLayout>`;
    const broken = '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdNone"/></a:blipFill></p:bgPr></p:bg>';
    expect((await one('', { bg: broken }, { layout })).slide.bgColor).toBe('#00AA00');
  });

  it('labels SmartArt / other objects, and warns even without a frame position', async () => {
    const gf = (uri, x = `<p:xfrm><a:off x="0" y="0"/><a:ext cx="${PX * 10}" cy="${PX * 10}"/></p:xfrm>`) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="F"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${x}<a:graphic><a:graphicData uri="${uri}"/></a:graphic></p:graphicFrame>`;
    const { slide, warnings } = await one(gf('http://schemas.openxmlformats.org/drawingml/2006/diagram') + gf('urn:ole', '') + '<p:graphicFrame/>');
    expect(els(slide, 'text')[0].content).toMatch(/SmartArt/);
    expect(warnings.join(' ')).toMatch(/embedded object/);
  });

  it('lays out tables with missing row heights / grid widths and vertical merges', async () => {
    const tbl = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="${100 * PX}" cy="${40 * PX}"/></p:xfrm>
      <a:graphic><a:graphicData uri="t"><a:tbl><a:tblGrid/>
        <a:tr><a:tc><a:txBody><a:bodyPr/>${para('A')}</a:txBody><a:tcPr><a:noFill/></a:tcPr></a:tc></a:tr>
        <a:tr><a:tc vMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const { slide } = await one(tbl);
    // One drawn cell (the vMerge continuation is skipped); its noFill keeps it an outline.
    expect(els(slide, 'rect')).toHaveLength(0);
    expect(els(slide, 'path')).toHaveLength(1);
  });

  it('names unnamed sections and ignores references to unknown slides', async () => {
    const zip = await JSZip.loadAsync(await buildPptx({ slides: [{ xml: slideXml('') }], sections: [{ name: 'A', slides: [0] }] }));
    const pres = await zip.file('ppt/presentation.xml').async('string');
    zip.file('ppt/presentation.xml', pres.replace('name="A"', '').replace('</p14:sldIdLst>', '<p14:sldId id="12345"/></p14:sldIdLst>'));
    const { deck } = await importPptx(await zip.generateAsync({ type: 'uint8array' }));
    expect(deck.sections).toEqual([{ id: 'pptx-sec-1', name: 'Section 1', slides: ['pptx-1'] }]);
  });

  it('matches a layout placeholder by type when its idx differs', async () => {
    const layout = `<p:sldLayout ${NS}>${tree(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title" idx="0"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(1, 2, 3, 4)}</p:spPr></p:sp>`)}</p:sldLayout>`;
    const t = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle" idx="7"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${para('X')}</p:txBody></p:sp>`;
    expect((await one(t, {}, { layout })).slide.elements[0]).toMatchObject({ x: 1, y: 2, w: 3, h: 4 });
  });
});

describe('importPptx — review fixes', () => {
  it('imports a plain rectangle as the sharp-cornered rect type', async () => {
    const { slide } = await one(shape(2, 'rect', 0, 0, 10, 10, '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>'));
    expect(slide.elements[0].type).toBe('rect');
  });

  it('rotates a rotated group\'s children about the group centre', async () => {
    // A 200×100 group at (100,100) rotated 90°; its child fills the left half.
    const grp = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm rot="5400000"><a:off x="${100 * PX}" y="${100 * PX}"/><a:ext cx="${200 * PX}" cy="${100 * PX}"/><a:chOff x="0" y="0"/><a:chExt cx="${200 * PX}" cy="${100 * PX}"/></a:xfrm></p:grpSpPr>
      ${shape(3, 'rect', 0, 0, 100, 100, '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>')}</p:grpSp>`;
    const el = (await one(grp)).slide.elements[0];
    // Child centre (150,150) turns 90° clockwise about the group centre (200,150) → (200,100).
    expect(el.x + el.w / 2).toBeCloseTo(200);
    expect(el.y + el.h / 2).toBeCloseTo(100);
    expect(el.rot).toBe(90);
  });

  it('warns that mirrored (flipped) shapes and pictures import unmirrored', async () => {
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="A"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 10, 10, ' flipH="1"')}<a:prstGeom prst="rightArrow"/><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr></p:sp>`;
    expect((await one(sp)).warnings.join(' ')).toMatch(/mirrored/i);
  });

  it('keeps an explicit fill on a placeholder whose geometry is inherited', async () => {
    const layout = `<p:sldLayout ${NS}>${tree(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(0, 0, 100, 50)}<a:prstGeom prst="rect"/></p:spPr></p:sp>`)}</p:sldLayout>`;
    const t = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/>${para('Banner')}</p:txBody></p:sp>`;
    const { slide } = await one(t, {}, { layout });
    expect(slide.elements.map((e) => e.type)).toEqual(['rect', 'text']);
    expect(slide.elements[0].fill).toBe('#1F3864');
  });

  it('draws a vertically merged cell across its whole row span', async () => {
    const tbl = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="${200 * PX}" cy="${100 * PX}"/></p:xfrm>
      <a:graphic><a:graphicData uri="t"><a:tbl><a:tblGrid><a:gridCol w="${100 * PX}"/><a:gridCol w="${100 * PX}"/></a:tblGrid>
        <a:tr h="${50 * PX}"><a:tc rowSpan="2"><a:txBody><a:bodyPr/>${para('Tall')}</a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/>${para('B1')}</a:txBody><a:tcPr/></a:tc></a:tr>
        <a:tr h="${50 * PX}"><a:tc vMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/>${para('B2')}</a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const cells = els((await one(tbl)).slide, 'rect');
    expect(cells.map((c) => [c.x, c.y, c.w, c.h])).toEqual([[0, 0, 100, 100], [100, 0, 100, 50], [100, 50, 100, 50]]);
  });

  it('letterboxes a picture background with the slide content', async () => {
    const bg = '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId10"/></a:blipFill></p:bgPr></p:bg>';
    const { slide } = await one('', { bg, slide: { extraRels: [['rId10', 'image', '../media/bg.png']] } }, { media: { 'bg.png': PNG }, size: { cx: 9144000, cy: 6858000 } });
    expect(slide.elements[0]).toMatchObject({ x: 240, y: 0, w: 1440, h: 1080 });
  });

  it('warns that master/layout pictures are copied onto every slide', async () => {
    const master = DEFAULT_MASTER.replace('</p:spTree>', `<p:pic><p:nvPicPr><p:cNvPr id="9" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdL"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic></p:spTree>`);
    const { warnings } = await importPptx(await buildPptx({ slides: [{ xml: slideXml('') }, { xml: slideXml('') }], master, masterRels: [['rIdL', 'image', '../media/logo.png']], media: { 'logo.png': PNG } }));
    expect(warnings.join(' ')).toMatch(/copied onto every slide/);
  });

  it('warns about picture/pattern-filled shapes and cropped pictures', async () => {
    const blipShape = shape(2, 'roundRect', 0, 0, 10, 10, '<a:blipFill><a:blip r:embed="rIdX"/></a:blipFill>');
    const cropped = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId10"/><a:srcRect l="10000"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic>`;
    const { warnings } = await one(blipShape + cropped, { slide: { extraRels: [['rId10', 'image', '../media/p.png']] } }, { media: { 'p.png': PNG } });
    expect(warnings.join(' ')).toMatch(/picture or pattern fill/i);
    expect(warnings.join(' ')).toMatch(/crop/i);
  });

  it('titles an untitled slide from its own text, not master decoration', async () => {
    const master = DEFAULT_MASTER.replace('</p:spTree>', `${textBox(9, 0, 1000, 300, 40, para('Company Confidential'))}</p:spTree>`);
    const { slide } = await one(textBox(2, 0, 0, 10, 10, para('Own heading')), {}, { master });
    expect(slide.title).toBe('Own heading');
  });
});

describe('importPptx — Codex review fixes', () => {
  it('applies paragraph default run properties (pPr/defRPr) when the run has none', async () => {
    const p = '<a:p><a:pPr algn="ctr"><a:defRPr sz="3200" b="1"><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill><a:latin typeface="Verdana"/></a:defRPr></a:pPr><a:r><a:rPr lang="en-US"/><a:t>Para styled</a:t></a:r></a:p>';
    const { slide } = await one(textBox(2, 0, 0, 400, 100, p));
    expect(slide.elements[0]).toMatchObject({ fontSize: 64, bold: true, fill: '#00AA00', fontFamily: 'Verdana', align: 'center' });
  });

  it('rejects an oversized picture from its declared size, before decoding it', async () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId10"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic>`;
    const bytes = await buildPptx({ slides: [{ xml: slideXml(pic), extraRels: [['rId10', 'image', '../media/big.png']] }], media: { 'big.png': new Uint8Array(10 * 1024 * 1024 + 3) } });
    const entryProto = Object.getPrototypeOf(new JSZip().file('x', '').file('x'));
    const spy = vi.spyOn(entryProto, 'async');
    try {
      const { deck, warnings } = await importPptx(bytes);
      expect(deck.slides[0].elements).toEqual([]);
      expect(warnings.join(' ')).toMatch(/larger than 10 MB/);
      expect(spy.mock.contexts.filter((f) => f.name === 'ppt/media/big.png')).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });

  it('mirrors a flipped group\'s children about the group centre and warns', async () => {
    // A 200×100 group flipped horizontally; its child fills the left half.
    const grp = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm flipH="1"><a:off x="${100 * PX}" y="${100 * PX}"/><a:ext cx="${200 * PX}" cy="${100 * PX}"/><a:chOff x="0" y="0"/><a:chExt cx="${200 * PX}" cy="${100 * PX}"/></a:xfrm></p:grpSpPr>
      ${shape(3, 'triangle', 0, 0, 100, 100, '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>')}</p:grpSp>`;
    const { slide, warnings } = await one(grp);
    expect(slide.elements[0]).toMatchObject({ x: 200, y: 100 }); // moved to the right half
    expect(warnings.join(' ')).toMatch(/mirrored/i);
  });
});

describe('importPptx — Codex review fixes (round 2)', () => {
  const cxn = (ln, x = 0, y = 0, w = 100, h = 0, extra = '') => `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="L"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(x, y, w, h, extra)}<a:prstGeom prst="line"/>${ln}</p:spPr></p:cxnSp>`;

  it('keeps a dashed / dotted connector as a stroked two-point path', async () => {
    const { slide } = await one(cxn('<a:ln w="25400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="dash"/></a:ln>', 10, 20, 100, 50));
    expect(slide.elements[0]).toMatchObject({ type: 'path', stroke: '#FF0000', strokeWidth: 4, strokeDash: 'dashed', x: 10, y: 20, w: 100, h: 50 });
    expect(slide.elements[0].points).toEqual([[0, 0], [1, 1]]);
  });

  it('gives a dashed horizontal connector a drawable box (centred on the line)', async () => {
    const { slide } = await one(cxn('<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="sysDot"/></a:ln>', 0, 100, 200, 0));
    const p = slide.elements[0];
    expect(p).toMatchObject({ type: 'path', strokeDash: 'dotted', x: 0, w: 200 });
    expect(p.h).toBeGreaterThan(0);
    expect(p.y + p.h / 2).toBeCloseTo(100);
    expect(p.points).toEqual([[0, 0.5], [1, 0.5]]);
  });

  it('mirrors a child\'s rotation inside a group flipped on one axis', async () => {
    const grp = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm flipH="1"><a:off x="0" y="0"/><a:ext cx="${200 * PX}" cy="${200 * PX}"/><a:chOff x="0" y="0"/><a:chExt cx="${200 * PX}" cy="${200 * PX}"/></a:xfrm></p:grpSpPr>
      <p:sp><p:nvSpPr><p:cNvPr id="3" name="R"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(50, 50, 100, 100, ' rot="1800000"')}<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr></p:sp></p:grpSp>`;
    expect((await one(grp)).slide.elements[0].rot).toBe(-30);
  });

  it('rotates a rotated table\'s cells about the table centre', async () => {
    const tbl = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="${200 * PX}" cy="${100 * PX}"/></p:xfrm>
      <a:graphic><a:graphicData uri="t"><a:tbl><a:tblGrid><a:gridCol w="${100 * PX}"/><a:gridCol w="${100 * PX}"/></a:tblGrid>
        <a:tr h="${100 * PX}"><a:tc><a:txBody><a:bodyPr/>${para('L')}</a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/>${para('R')}</a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const [left] = els((await one(tbl)).slide, 'rect');
    // Left cell centre (50,50) turns 90° about the table centre (100,50) → (100,0).
    expect(left.rot).toBe(90);
    expect(left.x + left.w / 2).toBeCloseTo(100);
    expect(left.y + left.h / 2).toBeCloseTo(0);
  });
});

describe('importPptx — Codex review fixes (round 3)', () => {
  it('mirrors a flipped table\'s cells within the table and warns', async () => {
    const tbl = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm flipH="1"><a:off x="0" y="0"/><a:ext cx="${200 * PX}" cy="${100 * PX}"/></p:xfrm>
      <a:graphic><a:graphicData uri="t"><a:tbl><a:tblGrid><a:gridCol w="${100 * PX}"/><a:gridCol w="${100 * PX}"/></a:tblGrid>
        <a:tr h="${100 * PX}"><a:tc><a:txBody><a:bodyPr/>${para('First')}</a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/>${para('Second')}</a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const { slide, warnings } = await one(tbl);
    const first = els(slide, 'text').find((t) => t.content === 'First');
    expect(first.x).toBe(100); // the first column now sits on the right
    expect(warnings.join(' ')).toMatch(/mirrored/i);
  });

  it('reports a linked (r:link) picture instead of dropping it silently', async () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:link="rIdL"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic>`;
    const { warnings } = await one(pic, { slide: { extraRels: [['rIdL', 'image', 'file:///C:/pics/a.png', 'External']] } });
    expect(warnings.join(' ')).toMatch(/linked/i);
  });

  it('warns that connector arrowheads are not imported', async () => {
    const cxn = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="L"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(0, 0, 100, 0)}<a:prstGeom prst="straightConnector1"/><a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:headEnd type="none"/><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`;
    const plain = cxn.replace('<a:tailEnd type="triangle"/>', '<a:tailEnd type="none"/>');
    expect((await one(cxn)).warnings.join(' ')).toMatch(/arrowheads/i);
    expect((await one(plain)).warnings.join(' ')).not.toMatch(/arrowheads/i);
  });

  it('refuses a package whose XML part declares an oversized inflated size, before inflating it', async () => {
    const zip = await JSZip.loadAsync(await buildPptx({ slides: [{ xml: slideXml('') }] }));
    zip.file('ppt/slides/slide1.xml', slideXml(textBox(2, 0, 0, 10, 10, para('x'.repeat(30 * 1024 * 1024)))));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    await expect(importPptx(bytes)).rejects.toThrow(/too large/i);
  });
});

describe('importPptx — Codex review fixes (round 4)', () => {
  it('stops embedding pictures once the package-wide media budget is spent', async () => {
    const pic = (n) => `<p:pic><p:nvPicPr><p:cNvPr id="${n + 10}" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId${n}"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic>`;
    const N = 8; // 8 × 9 MB > the 64 MB budget, each under the 10 MB per-picture cap
    const media = {}, extraRels = [];
    for (let i = 0; i < N; i++) { media[`p${i}.png`] = new Uint8Array(9 * 1024 * 1024); extraRels.push([`rId${i}`, 'image', `../media/p${i}.png`]); }
    const { slide, warnings } = await one(Array.from({ length: N }, (_, i) => pic(i)).join(''), { slide: { extraRels } }, { media });
    expect(slide.elements.length).toBeLessThan(N);
    expect(slide.elements.length).toBeGreaterThan(0);
    expect(warnings.join(' ')).toMatch(/total/i);
  }, 60000);

  it('inherits a placeholder outline from its layout, respecting an explicit no-line override', async () => {
    const layout = `<p:sldLayout ${NS}>${tree(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(0, 0, 100, 50)}<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></p:spPr></p:sp>`)}</p:sldLayout>`;
    const ph = (spPr) => `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${spPr}</p:spPr><p:txBody><a:bodyPr/>${para('x')}</p:txBody></p:sp>`;
    expect((await one(ph(''), {}, { layout })).slide.elements[0]).toMatchObject({ type: 'rect', stroke: '#FF0000' });
    expect((await one(ph('<a:ln><a:noFill/></a:ln>'), {}, { layout })).slide.elements[0].stroke).toBeUndefined();
  });

  it('resolves scheme colours through a layout colour-map override', async () => {
    const layout = `<p:sldLayout ${NS}>${tree('')}<p:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"/></p:clrMapOvr></p:sldLayout>`;
    const { slide } = await one(textBox(2, 0, 0, 10, 10, para('Light on dark')), {}, { layout });
    expect(slide.bgColor).toBe('#000000');
    expect(slide.elements[0].fill).toBe('#FFFFFF');
  });
});

describe('importPptx — Codex review fixes (round 5)', () => {
  it('accepts the textual true form of XML booleans (flipH="true", showMasterSp="false")', async () => {
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="A"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 10, 10, ' flipH="true"')}<a:prstGeom prst="rightArrow"/><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr></p:sp>`;
    expect((await one(sp)).warnings.join(' ')).toMatch(/mirrored/i);
    const master = DEFAULT_MASTER.replace('</p:spTree>', `${shape(9, 'rect', 0, 0, 10, 10, '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>')}</p:spTree>`);
    expect((await one('', { attrs: ' showMasterSp="false"' }, { master })).slide.elements).toEqual([]);
  });

  it('imports an elbow connector as a three-segment path (not a diagonal), honouring flips', async () => {
    const cxn = (prst, extra = '') => `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="L"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(0, 0, 100, 50, extra)}<a:prstGeom prst="${prst}"/><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
    const bent = (await one(cxn('bentConnector3'))).slide.elements[0];
    expect(bent).toMatchObject({ type: 'path', stroke: '#000000', x: 0, y: 0, w: 100, h: 50 });
    expect(bent.points).toEqual([[0, 0], [0.5, 0], [0.5, 1], [1, 1]]);
    expect((await one(cxn('bentConnector3', ' flipH="1"'))).slide.elements[0].points).toEqual([[1, 0], [0.5, 0], [0.5, 1], [0, 1]]);
    const curved = await one(cxn('curvedConnector3'));
    expect(curved.slide.elements[0].type).toBe('path');
    expect(curved.warnings.join(' ')).toMatch(/curved connectors/i);
  });

  it('honours a slide\'s explicit masterClrMapping over its layout override', async () => {
    const layout = `<p:sldLayout ${NS}>${tree('')}<p:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"/></p:clrMapOvr></p:sldLayout>`;
    const { slide } = await one(textBox(2, 0, 0, 10, 10, para('Master colours')), { after: '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>' }, { layout });
    expect(slide.bgColor).toBe('#FFFFFF');
    expect(slide.elements[0].fill).toBe('#000000');
  });
});

describe('importPptx — Codex review fixes (round 6)', () => {
  it('bounds the total size of picture copies the deck carries (a reused master picture counts per slide)', async () => {
    const master = DEFAULT_MASTER.replace('</p:spTree>', `<p:pic><p:nvPicPr><p:cNvPr id="9" name="Bg"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdL"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic></p:spTree>`);
    const N = 12; // 12 copies × ~12 MB of base64 > the 96 MB output budget
    const { deck, warnings } = await importPptx(await buildPptx({
      slides: Array.from({ length: N }, () => ({ xml: slideXml('') })),
      master, masterRels: [['rIdL', 'image', '../media/bg.png']], media: { 'bg.png': new Uint8Array(9 * 1024 * 1024) },
    }));
    const withPic = deck.slides.filter((s) => s.elements.some((e) => e.type === 'image')).length;
    expect(withPic).toBeGreaterThan(0);
    expect(withPic).toBeLessThan(N);
    expect(warnings.join(' ')).toMatch(/budget/i);
  }, 60000);
});

describe('importPptx — Codex review fixes (round 7)', () => {
  const tbl = (xfrmXml, cellPr = '<a:tcPr/>', rowH = 50) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    ${xfrmXml}<a:graphic><a:graphicData uri="t"><a:tbl><a:tblGrid><a:gridCol w="${100 * PX}"/></a:tblGrid>
      <a:tr h="${rowH * PX}"><a:tc><a:txBody><a:bodyPr/>${para('C')}</a:txBody>${cellPr}</a:tc></a:tr>
    </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const frame = (h) => `<p:xfrm><a:off x="0" y="0"/><a:ext cx="${100 * PX}" cy="${h * PX}"/></p:xfrm>`;

  it('keeps an explicitly transparent (noFill) cell transparent — an outline, not a white box', async () => {
    const { slide } = await one(tbl(frame(50), '<a:tcPr><a:noFill/></a:tcPr>'));
    expect(els(slide, 'rect')).toEqual([]);
    expect(els(slide, 'path')[0]).toMatchObject({ stroke: '#BFBFBF', x: 0, y: 0, w: 100, h: 50 });
  });

  it('scales rows down when the table frame is shorter than its rows', async () => {
    const { slide } = await one(tbl(frame(25), '<a:tcPr/>', 50));
    expect(els(slide, 'rect')[0].h).toBe(25);
  });

  it('groups a standalone shape with its text, keeping an enclosing group id', async () => {
    const sp = shape(2, 'rect', 0, 0, 50, 50, '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>', `<p:txBody><a:bodyPr/>${para('Label')}</p:txBody>`);
    const { slide } = await one(sp);
    expect(slide.elements).toHaveLength(2);
    expect(slide.elements[0].groupId).toBeTruthy();
    expect(slide.elements[1].groupId).toBe(slide.elements[0].groupId);
    // A text-only box stays ungrouped.
    expect((await one(textBox(2, 0, 0, 10, 10, para('Solo')))).slide.elements[0].groupId).toBeUndefined();
  });
});

describe('importPptx — Codex review fixes (round 8)', () => {
  it('warns that hyperlinks in text are imported as plain text', async () => {
    const run = '<a:p><a:r><a:rPr lang="en-US"><a:hlinkClick r:id="rIdH"/></a:rPr><a:t>Docs</a:t></a:r></a:p>';
    const { slide, warnings } = await one(textBox(2, 0, 0, 100, 20, run));
    expect(slide.elements[0].content).toBe('Docs');
    expect(warnings.join(' ')).toMatch(/hyperlink/i);
  });

  it('warns that freeform (custom-geometry) shapes become rectangles', async () => {
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="F"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 10, 10)}<a:custGeom/><a:solidFill><a:srgbClr val="010101"/></a:solidFill></p:spPr></p:sp>`;
    expect((await one(sp)).warnings.join(' ')).toMatch(/freeform/i);
    // A real rect preset raises no such warning.
    expect((await one(shape(3, 'rect', 0, 0, 10, 10, '<a:solidFill><a:srgbClr val="010101"/></a:solidFill>'))).warnings.join(' ')).not.toMatch(/freeform/i);
  });

  it('warns that footer / date / slide-number placeholders were not imported', async () => {
    const ph = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr><p:txBody><a:bodyPr/>${para('7')}</p:txBody></p:sp>`;
    expect((await one(ph)).warnings.join(' ')).toMatch(/slide numbers/i);
  });
});

describe('importPptx — Codex review fixes (round 9)', () => {
  it('maps a PowerPoint cut transition to no transition', async () => {
    expect((await one('', { after: '<p:transition><p:cut/></p:transition>' })).slide.transition).toEqual({ type: 'none', duration: 750 });
  });

  it('warns that slide animations (p:timing) are not imported', async () => {
    const { warnings } = await one('', { after: '<p:timing><p:tnLst><p:par/></p:tnLst></p:timing>' });
    expect(warnings.join(' ')).toMatch(/animations/i);
    expect((await one('')).warnings.join(' ')).not.toMatch(/animations/i);
  });
});

describe('importPptx — Codex review fixes (round 10)', () => {
  it('imports pictures with stretch fit (PowerPoint\'s default a:stretch), not cover', async () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId10"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(0, 0, 30, 10)}</p:spPr></p:pic>`;
    const { slide } = await one(pic, { slide: { extraRels: [['rId10', 'image', '../media/p.png']] } }, { media: { 'p.png': PNG } });
    expect(slide.elements[0].fit).toBe('stretch');
    expect(sanitizeSlidePatch({ elements: slide.elements }, 'blank').elements).toHaveLength(1);
  });

  it('inherits shape style references (fillRef/lnRef/fontRef) from the layout placeholder', async () => {
    const style = '<p:style><a:lnRef idx="1"><a:srgbClr val="FF0000"/></a:lnRef><a:fillRef idx="1"><a:srgbClr val="0000FF"/></a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="FFFFFF"/></a:fontRef></p:style>';
    const layout = `<p:sldLayout ${NS}>${tree(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(0, 0, 100, 50)}<a:prstGeom prst="rect"/></p:spPr>${style}</p:sp>`)}</p:sldLayout>`;
    const ph = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${para('Styled')}</p:txBody></p:sp>`;
    const [box, text] = (await one(ph, {}, { layout })).slide.elements;
    expect(box).toMatchObject({ type: 'rect', fill: '#0000FF', stroke: '#FF0000' });
    expect(text.fill).toBe('#FFFFFF');
  });
});

describe('importPptx — Codex review fixes (round 11)', () => {
  it('uses the theme typeface a shape style fontRef selects', async () => {
    const style = '<p:style><a:lnRef idx="0"><a:srgbClr val="000000"/></a:lnRef><a:fillRef idx="0"><a:srgbClr val="000000"/></a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="major"><a:srgbClr val="000000"/></a:fontRef></p:style>';
    const { slide } = await one(shape(2, 'rect', 0, 0, 50, 50, '<a:noFill/>', style + `<p:txBody><a:bodyPr/>${para('Heading font')}</p:txBody>`));
    expect(slide.elements.find((e) => e.type === 'text').fontFamily).toBe('Georgia');
  });

  it('materializes auto-numbered lists (type + startAt), restarting after an interruption', async () => {
    const num = (t, type = 'arabicPeriod', extra = '') => para(t, { pPr: `<a:pPr><a:buAutoNum type="${type}"${extra}/></a:pPr>` });
    const body = num('One') + num('Two') + para('Break', { pPr: '<a:pPr><a:buNone/></a:pPr>' })
      + num('Alpha', 'alphaLcParenR') + num('Beta', 'alphaLcParenR')
      + num('Ten', 'arabicPeriod', ' startAt="10"') + num('Roman', 'romanUcPeriod', ' startAt="4"');
    const { slide } = await one(textBox(2, 0, 0, 100, 100, body));
    expect(slide.elements[0].content).toBe('1. One\n2. Two\nBreak\na) Alpha\nb) Beta\n10. Ten\nIV. Roman');
  });
});

describe('importPptx — Codex review fixes (round 12)', () => {
  it('takes an idx-only placeholder\'s type (and so its title text style) from the matched layout placeholder', async () => {
    const layout = `<p:sldLayout ${NS}>${tree(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title" idx="5"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(0, 0, 100, 50)}</p:spPr></p:sp>`)}</p:sldLayout>`;
    const ph = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="T"/><p:cNvSpPr/><p:nvPr><p:ph idx="5"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${para('Heading')}</p:txBody></p:sp>`;
    const { slide } = await one(ph, {}, { layout });
    // titleStyle: 44pt Georgia (+mj-lt) and no bullet — not bodyStyle's 28pt Arial "•".
    expect(slide.elements[0]).toMatchObject({ content: 'Heading', fontSize: 88, fontFamily: 'Georgia' });
  });

  it('continues numbering across items that repeat the list\'s startAt, and restarts when startAt changes', async () => {
    const num = (t, start) => para(t, { pPr: `<a:pPr><a:buAutoNum type="arabicPeriod"${start ? ` startAt="${start}"` : ''}/></a:pPr>` });
    const { slide } = await one(textBox(2, 0, 0, 100, 100, num('A', 5) + num('B', 5) + num('C', 1) + num('D', 1)));
    expect(slide.elements[0].content).toBe('5. A\n6. B\n1. C\n2. D');
  });
});

describe('importPptx — Codex review fixes (round 13)', () => {
  it('restarts numbering after an empty buNone separator paragraph', async () => {
    const num = (t) => para(t, { pPr: '<a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>' });
    const body = num('A') + num('B') + '<a:p><a:pPr><a:buNone/></a:pPr></a:p>' + num('C');
    expect((await one(textBox(2, 0, 0, 100, 100, body))).slide.elements[0].content).toBe('1. A\n2. B\n\n1. C');
  });

  it('warns when a video/audio picture is reduced to its poster image', async () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="V"/><p:cNvPicPr/><p:nvPr><a:videoFile r:link="rIdV"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId10"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic>`;
    const { slide, warnings } = await one(pic, { slide: { extraRels: [['rId10', 'image', '../media/p.png']] } }, { media: { 'p.png': PNG } });
    expect(slide.elements[0].type).toBe('image');
    expect(warnings.join(' ')).toMatch(/video and audio/i);
  });

  it('warns that slide comments are not imported', async () => {
    const { warnings } = await one('', { slide: { extraRels: [['rIdC', 'comments', '../comments/comment1.xml']] } });
    expect(warnings.join(' ')).toMatch(/comments/i);
  });

  it('warns about click/hover links on shapes', async () => {
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Btn"><a:hlinkClick r:id="rIdH"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 10, 10)}<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr></p:sp>`;
    expect((await one(sp)).warnings.join(' ')).toMatch(/links on shapes/i);
  });
});

describe('importPptx — Codex review fixes (round 14)', () => {
  const fillOfShape = async (clr) => (await one(shape(2, 'rect', 0, 0, 10, 10, `<a:solidFill>${clr}</a:solidFill>`))).slide.elements[0]?.fill;

  it('resolves the full DrawingML preset-colour vocabulary (incl. dk/lt/med abbreviations)', async () => {
    expect(await fillOfShape('<a:prstClr val="orange"/>')).toBe('#FFA500');
    expect(await fillOfShape('<a:prstClr val="papayaWhip"/>')).toBe('#FFEFD5');
    expect(await fillOfShape('<a:prstClr val="dkGoldenrod"/>')).toBe('#B8860B');
    expect(await fillOfShape('<a:prstClr val="ltSlateGray"/>')).toBe('#778899');
    expect(await fillOfShape('<a:prstClr val="medSeaGreen"/>')).toBe('#3CB371');
  });

  it('lets an explicit noAutofit / spAutoFit stop an inherited normAutofit scale', async () => {
    const layout = `<p:sldLayout ${NS}>${tree(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(0, 0, 100, 50)}</p:spPr><p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr><a:lstStyle/><a:p/></p:txBody></p:sp>`)}</p:sldLayout>`;
    const ph = (bodyPr) => `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody>${bodyPr}${para('T', { rPr: ' sz="2000"' })}</p:txBody></p:sp>`;
    expect((await one(ph('<a:bodyPr/>'), {}, { layout })).slide.elements[0].fontSize).toBe(20); // inherited 50%
    expect((await one(ph('<a:bodyPr><a:noAutofit/></a:bodyPr>'), {}, { layout })).slide.elements[0].fontSize).toBe(40);
    expect((await one(ph('<a:bodyPr><a:spAutoFit/></a:bodyPr>'), {}, { layout })).slide.elements[0].fontSize).toBe(40);
  });

  describe('table cell borders', () => {
    const cellTbl = (tcPr) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="${100 * PX}" cy="${50 * PX}"/></p:xfrm>
      <a:graphic><a:graphicData uri="t"><a:tbl><a:tblGrid><a:gridCol w="${100 * PX}"/></a:tblGrid>
        <a:tr h="${50 * PX}"><a:tc><a:txBody><a:bodyPr/>${para('C')}</a:txBody><a:tcPr>${tcPr}</a:tcPr></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const side = (n, inner) => `<a:${n}>${inner}</a:${n}>`;
    const all = (inner) => ['lnL', 'lnR', 'lnT', 'lnB'].map((n) => side(n, inner)).join('');
    const fill = '<a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill>';

    it('uses uniform explicit borders (colour / width / dash)', async () => {
      const { slide } = await one(cellTbl(all('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="dash"/>').replace(/<a:ln(.)>/g, '<a:ln$1 w="25400">') + fill));
      expect(els(slide, 'rect')[0]).toMatchObject({ stroke: '#FF0000', strokeWidth: 4, strokeDash: 'dashed' });
    });

    it('drops the grid for explicitly borderless cells (filled and transparent)', async () => {
      const filled = (await one(cellTbl(all('<a:noFill/>') + fill))).slide;
      expect(els(filled, 'rect')[0].stroke).toBeUndefined();
      const clear = (await one(cellTbl(all('<a:noFill/>') + '<a:noFill/>'))).slide;
      expect(els(clear, 'rect')).toEqual([]);
      expect(els(clear, 'path')).toEqual([]);
    });

    it('approximates mixed borders with a warning', async () => {
      const mixed = side('lnL', '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>') + side('lnR', '<a:noFill/>');
      const { slide, warnings } = await one(cellTbl(mixed + fill));
      expect(els(slide, 'rect')[0].stroke).toBe('#FF0000');
      expect(warnings.join(' ')).toMatch(/cell borders/i);
    });
  });
});

describe('importPptx — Codex review fixes (round 15)', () => {
  const fillOfShape = async (clr) => (await one(shape(2, 'rect', 0, 0, 10, 10, `<a:solidFill>${clr}</a:solidFill>`))).slide.elements[0]?.fill;

  it('converts scRGB (linear, percent) and HSL colours to sRGB hex', async () => {
    expect(await fillOfShape('<a:scrgbClr r="100000" g="0" b="0"/>')).toBe('#FF0000');
    expect(await fillOfShape('<a:scrgbClr r="21586" g="21586" b="21586"/>')).toBe('#808080'); // linear 0.2159 = sRGB 128/255
    expect(await fillOfShape('<a:hslClr hue="7200000" sat="100000" lum="50000"/>')).toBe('#00FF00'); // 120°
    expect(await fillOfShape('<a:hslClr hue="0" sat="0" lum="0"/>')).toBe('#000000');
  });

  it('warns that path (radial / rectangular) gradients are imported as linear', async () => {
    const grad = (shade) => `<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst>${shade}</a:gradFill>`;
    const radial = await one(shape(2, 'rect', 0, 0, 10, 10, grad('<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>')));
    expect(radial.slide.elements[0].gradient).toBeTruthy();
    expect(radial.warnings.join(' ')).toMatch(/radial/i);
    expect((await one(shape(2, 'rect', 0, 0, 10, 10, grad('<a:lin ang="0"/>')))).warnings.join(' ')).not.toMatch(/radial/i);
  });
});

describe('importPptx — Codex review fixes (round 16)', () => {
  const rels = { slide: { extraRels: [['rId10', 'image', '../media/p.png']] } };
  const media = { media: { 'p.png': PNG } };

  it('warns that tiled pictures are imported stretched to their frame', async () => {
    const pic = (mode) => `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId10"/>${mode}</p:blipFill><p:spPr>${xfrm(0, 0, 30, 10)}</p:spPr></p:pic>`;
    const tiled = await one(pic('<a:tile tx="0" ty="0" sx="100000" sy="100000" algn="tl"/>'), rels, media);
    expect(tiled.slide.elements[0].fit).toBe('stretch');
    expect(tiled.warnings.join(' ')).toMatch(/tiled/i);
    expect((await one(pic('<a:stretch><a:fillRect/></a:stretch>'), rels, media)).warnings.join(' ')).not.toMatch(/tiled/i);
  });

  it('warns that a tiled background picture is imported stretched', async () => {
    const bg = '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId10"/><a:tile/></a:blipFill><a:effectLst/></p:bgPr></p:bg>';
    const { warnings } = await one('', { ...rels, bg }, media);
    expect(warnings.join(' ')).toMatch(/tiled/i);
  });
});

describe('importPptx — Codex review fixes (round 17)', () => {
  const frame = (cNvPrKids, uri, data) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="F">${cNvPrKids}</p:cNvPr><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="0" y="0"/><a:ext cx="${200 * PX}" cy="${100 * PX}"/></p:xfrm>
    <a:graphic><a:graphicData uri="${uri}">${data}</a:graphicData></a:graphic></p:graphicFrame>`;
  const CHART = ['http://schemas.openxmlformats.org/drawingml/2006/chart', '<c:chart xmlns:c="c" r:id="rId9"/>'];

  it('warns about click/hover links on graphic frames (tables, charts)', async () => {
    const tbl = '<a:tbl><a:tblGrid><a:gridCol w="1270000"/></a:tblGrid><a:tr h="635000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl>';
    const linked = await one(frame('<a:hlinkClick r:id="rIdH"/>', 'http://schemas.openxmlformats.org/drawingml/2006/table', tbl));
    expect(linked.warnings.join(' ')).toMatch(/links on shapes/i);
    expect((await one(frame('', ...CHART))).warnings.join(' ')).not.toMatch(/links on shapes/i);
  });

  it('groups an unsupported-object placeholder with its label', async () => {
    const { slide } = await one(frame('', ...CHART));
    const [box, label] = slide.elements;
    expect(box.groupId).toBeTruthy();
    expect(label.groupId).toBe(box.groupId);
  });

  it('keeps picture transparency (a:alphaModFix) as opacity', async () => {
    const pic = (blipKids) => `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId10">${blipKids}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(0, 0, 30, 10)}</p:spPr></p:pic>`;
    const opts = { slide: { extraRels: [['rId10', 'image', '../media/p.png']] } };
    const pkg = { media: { 'p.png': PNG } };
    const { slide } = await one(pic('<a:alphaModFix amt="50000"/>'), opts, pkg);
    expect(slide.elements[0].opacity).toBe(50);
    expect(sanitizeSlidePatch({ elements: slide.elements }, 'blank').elements[0].opacity).toBe(50);
    expect((await one(pic(''), opts, pkg)).slide.elements[0].opacity).toBeUndefined();
  });
});

describe('importPptx — Codex review fixes (round 18)', () => {
  const fill = (a) => `<a:solidFill><a:srgbClr val="FF0000">${a ? `<a:alpha val="${a}"/>` : ''}</a:srgbClr></a:solidFill>`;
  const ln = (a) => `<a:ln w="${4 * PX}"><a:solidFill><a:srgbClr val="0000FF">${a ? `<a:alpha val="${a}"/>` : ''}</a:srgbClr></a:solidFill></a:ln>`;

  it('keeps an opaque outline opaque around a translucent fill (fill + outline split, grouped)', async () => {
    const { slide } = await one(shape(2, 'rect', 0, 0, 100, 50, fill(50000) + ln()));
    const [body, outline] = slide.elements;
    expect(body).toMatchObject({ type: 'rect', fill: '#FF0000', opacity: 50 });
    expect(body.stroke).toBeUndefined();
    expect(outline).toMatchObject({ type: 'path', stroke: '#0000FF' });
    expect(outline.opacity).toBeUndefined();
    expect(outline.groupId).toBeTruthy();
    expect(outline.groupId).toBe(body.groupId);
    expect(sanitizeSlidePatch({ elements: slide.elements }, 'blank').elements).toHaveLength(2);
  });

  it('keeps one element when fill and outline share an opacity', async () => {
    const same = (await one(shape(2, 'rect', 0, 0, 100, 50, fill(50000) + ln(50000)))).slide.elements;
    expect(same).toHaveLength(1);
    expect(same[0]).toMatchObject({ fill: '#FF0000', stroke: '#0000FF', opacity: 50 });
    const opaque = (await one(shape(2, 'rect', 0, 0, 100, 50, fill() + ln()))).slide.elements;
    expect(opaque).toHaveLength(1);
    expect(opaque[0].opacity).toBeUndefined();
  });

  it('carries table-cell fill transparency, keeping the cell border opaque', async () => {
    const tbl = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="${100 * PX}" cy="${50 * PX}"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="${100 * PX}"/></a:tblGrid>
        <a:tr h="${50 * PX}"><a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr>${fill(40000)}</a:tcPr></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const { slide } = await one(tbl);
    const cell = els(slide, 'rect')[0];
    expect(cell).toMatchObject({ fill: '#FF0000', opacity: 40 });
    expect(cell.stroke).toBeUndefined();
    const border = els(slide, 'path')[0];
    expect(border).toMatchObject({ stroke: '#BFBFBF' });
    expect(border.opacity).toBeUndefined();
    expect(border.groupId).toBe(cell.groupId);
  });
});

describe('importPptx — Codex review fixes (round 19)', () => {
  it('keeps outline alpha on outline-only (noFill) shapes', async () => {
    const ln = `<a:ln w="${4 * PX}"><a:solidFill><a:srgbClr val="0000FF"><a:alpha val="30000"/></a:srgbClr></a:solidFill></a:ln>`;
    const { slide } = await one(shape(2, 'ellipse', 0, 0, 100, 50, `<a:noFill/>${ln}`));
    expect(slide.elements[0]).toMatchObject({ type: 'path', stroke: '#0000FF', opacity: 30 });
  });

  it('warns when gradient stops differ in transparency', async () => {
    const grad = (a0, a1) => `<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"><a:alpha val="${a0}"/></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"><a:alpha val="${a1}"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>`;
    expect((await one(shape(2, 'rect', 0, 0, 10, 10, grad(0, 100000)))).warnings.join(' ')).toMatch(/gradient transparency/i);
    expect((await one(shape(2, 'rect', 0, 0, 10, 10, grad(50000, 50000)))).warnings.join(' ')).not.toMatch(/gradient transparency/i);
  });
});

describe('importPptx — Codex review fixes (round 20)', () => {
  it('keeps rounded corners on outline-only rounded rectangles', async () => {
    const ln = `<a:ln w="${4 * PX}"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln>`;
    const { slide } = await one(shape(2, 'roundRect', 0, 0, 280, 140, `<a:noFill/>${ln}`));
    const { points } = slide.elements[0];
    expect(slide.elements[0].type).toBe('path');
    expect(points).not.toContainEqual([0, 0]); // the corner is cut by an arc
    expect(points.length).toBeGreaterThan(8);
    expect(points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)).toBe(true);
    // The arc starts radius-px in from the corner (28px on a 280px-wide box = 0.1).
    expect(points).toContainEqual([0.1, 0]);
  });

  it('carries table-cell border alpha into the outline', async () => {
    const lnX = (n) => `<a:${n} w="${2 * PX}"><a:solidFill><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:solidFill></a:${n}>`;
    const borders = ['lnL', 'lnR', 'lnT', 'lnB'].map(lnX).join('');
    const tbl = (fill) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="${100 * PX}" cy="${50 * PX}"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="${100 * PX}"/></a:tblGrid>
        <a:tr h="${50 * PX}"><a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr>${borders}${fill}</a:tcPr></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const filled = (await one(tbl('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>'))).slide;
    expect(els(filled, 'rect')[0].opacity).toBeUndefined();
    expect(els(filled, 'path')[0]).toMatchObject({ stroke: '#000000', opacity: 40 });
    const clear = (await one(tbl('<a:noFill/>'))).slide;
    expect(els(clear, 'path')[0]).toMatchObject({ stroke: '#000000', opacity: 40 });
  });

  it('keeps picture-background transparency (alphaModFix) as image opacity', async () => {
    const bg = '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId10"><a:alphaModFix amt="60000"/></a:blip><a:stretch/></a:blipFill><a:effectLst/></p:bgPr></p:bg>';
    const { slide } = await one('', { bg, slide: { extraRels: [['rId10', 'image', '../media/p.png']] } }, { media: { 'p.png': PNG } });
    expect(els(slide, 'image')[0].opacity).toBe(60);
  });
});

describe('importPptx — Codex review fixes (round 21)', () => {
  it('resolves theme slots written as scRGB, HSL or preset colours', async () => {
    const theme = DEFAULT_THEME_WITH(`<a:accent1><a:prstClr val="red"/></a:accent1><a:accent2><a:hslClr hue="7200000" sat="100000" lum="50000"/></a:accent2>
      <a:accent3><a:scrgbClr r="0" g="0" b="100000"/></a:accent3>`);
    const fills = ['accent1', 'accent2', 'accent3'].map((k, i) => shape(2 + i, 'rect', 0, 0, 10, 10, `<a:solidFill><a:schemeClr val="${k}"/></a:solidFill>`));
    const { slide } = await one(fills.join(''), {}, { theme });
    expect(slide.elements.map((e) => e.fill)).toEqual(['#FF0000', '#00FF00', '#0000FF']);
  });

  it('blends a translucent background colour over white (the slide base)', async () => {
    const bg = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
    expect((await one('', { bg })).slide.bgColor).toBe('#808080');
    const opaque = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
    expect((await one('', { bg: opaque })).slide.bgColor).toBe('#123456');
  });
});
