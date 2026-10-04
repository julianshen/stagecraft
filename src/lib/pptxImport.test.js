import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { importPptx } from './pptxImport.js';
import { sanitizeSlidePatch } from './deckUtils.js';
import { flattenDeck } from './deckOrder.js';
import {
  buildPptx, slideXml, textBox, para, shape, xfrm, tree, NS, PX, DEFAULT_MASTER,
} from '../test/pptxFixture.js';

const one = async (inner, opts = {}, pkg = {}) => {
  const { deck, warnings } = await importPptx(await buildPptx({ slides: [{ xml: slideXml(inner, opts), ...(opts.slide || {}) }], ...pkg }));
  return { slide: deck.slides[0], deck, warnings };
};
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
    expect(await fillOfShape('<a:hslClr hue="0" sat="0" lum="0"/>')).toBeUndefined();
    expect(await fillOfShape('<a:schemeClr val="phClr"/>')).toBeUndefined();
    expect(await fillOfShape('<a:prstClr val="papayaWhip"/>')).toBeUndefined();
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
    expect(slide.elements[0]).toMatchObject({ content: '• 7\n \n• Item', align: 'right', bold: true, valign: 'top' });
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
    expect(els(slide, 'rect')).toHaveLength(1);
    expect(els(slide, 'rect')[0].fill).toBe('#FFFFFF');
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
