import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { applyPptxBodyLayout, applyPptxParagraphFormat, readPptxBodyLayout, readPptxParagraphStyle } from './authoring.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const parse = xml => new JSDOM(xml, { contentType: 'text/xml' }).window.document;
const paragraph = inner => parse(`<a:p xmlns:a="${A}">${inner}</a:p>`).documentElement;
const body = (attributes = '', child = '') => parse(`<a:bodyPr xmlns:a="${A}" ${attributes}>${child}</a:bodyPr>`).documentElement;

describe('PPTX semantic formatting helpers', () => {
  it('reads empty and fully populated paragraph styles', () => {
    expect(readPptxParagraphStyle(paragraph(''))).toEqual({});
    const style = readPptxParagraphStyle(paragraph('<a:pPr algn="ctr" lvl="2" marL="914400" marR="457200" indent="-228600"><a:spcBef><a:spcPts val="1200"/></a:spcBef><a:spcAft><a:spcPts val="400"/></a:spcAft><a:lnSpc><a:spcPct val="120000"/></a:lnSpc><a:buChar char="•"/></a:pPr>'));
    expect(style).toMatchObject({ alignment: 'center', level: 2, indentStart: 914400, indentEnd: 457200, firstLineIndent: -228600, spaceBefore: 12, spaceAfter: 4, lineSpacing: 120, bullet: { type: 'char', char: '•' } });
    expect(readPptxParagraphStyle(paragraph('<a:pPr><a:buNone/></a:pPr>')).bullet).toEqual({ type: 'none' });
    expect(readPptxParagraphStyle(paragraph('<a:pPr><a:buAutoNum type="alphaLcPeriod"/></a:pPr>')).bullet).toEqual({ type: 'number', format: 'lowerAlphaPeriod' });
  });

  it('reads absent and fully populated body layouts', () => {
    expect(readPptxBodyLayout(null)).toBeUndefined();
    expect(readPptxBodyLayout(body(''))).toEqual({});
    expect(readPptxBodyLayout(body('wrap="none" anchor="t" lIns="12700" tIns="25400" rIns="38100" bIns="50800"', '<a:spAutoFit/>'))).toEqual({ wrap: 'none', anchor: 'top', insets: { left: 12700, top: 25400, right: 38100, bottom: 50800 }, autofit: 'resize' });
    expect(readPptxBodyLayout(body('wrap="square" anchor="ctr"', '<a:normAutofit/>'))).toEqual({ wrap: 'square', anchor: 'middle', autofit: 'shrink', fit: {} });
    expect(readPptxBodyLayout(body('anchor="b"', '<a:noAutofit/>'))).toMatchObject({ anchor: 'bottom', autofit: 'none' });
  });

  it.each([
    ['empty', '', {}],
    ['fontScale only', 'fontScale="85000"', { fontScale: 85000 }],
    ['lnSpcReduction only', 'lnSpcReduction="10000"', { lnSpcReduction: 10000 }],
    ['both values', 'fontScale="85000" lnSpcReduction="10000"', { fontScale: 85000, lnSpcReduction: 10000 }],
    ['unknown attribute', 'fontScale="85000" unknown="1"', { fontScale: 85000 }],
  ])('reads only recognized present normAutofit values: %s', (_label, attributes, fit) => {
    expect(readPptxBodyLayout(body('', `<a:normAutofit ${attributes}/>`))).toEqual({ autofit: 'shrink', fit });
  });

  it.each([
    ['percent string', 'fontScale="90000%"', {}],
    ['fractional scale', 'fontScale="90000.5"', {}],
    ['negative scale', 'fontScale="-1"', {}],
    ['zero scale', 'fontScale="0"', {}],
    ['scale above range', 'fontScale="100001"', {}],
    ['unsafe scale', 'fontScale="9007199254740992"', {}],
    ['exponent scale', 'fontScale="1e5"', {}],
    ['fractional reduction', 'lnSpcReduction="10000.5"', {}],
    ['negative reduction', 'lnSpcReduction="-1"', {}],
    ['reduction above range', 'lnSpcReduction="100001"', {}],
    ['unsafe reduction', 'lnSpcReduction="9007199254740992"', {}],
    ['valid scale with malformed reduction', 'fontScale="85000" lnSpcReduction="10%"', { fontScale: 85000 }],
    ['malformed scale with valid reduction', 'fontScale="0" lnSpcReduction="10000"', { lnSpcReduction: 10000 }],
  ])('excludes malformed present normAutofit values: %s', (_label, attributes, fit) => {
    expect(readPptxBodyLayout(body('', `<a:normAutofit ${attributes}/>`))).toEqual({ autofit: 'shrink', fit });
  });

  it('sets and removes every paragraph formatting property', () => {
    const node = paragraph('<a:r><a:t>Text</a:t></a:r>');
    const style = { alignment: 'right', level: 2, indentStart: 100, indentEnd: 200, firstLineIndent: -50, spaceBefore: 3, spaceAfter: 4, lineSpacing: 110, bullet: { type: 'number', format: 'lowerRomanPeriod' } };
    applyPptxParagraphFormat(node, {}, style);
    expect(readPptxParagraphStyle(node)).toMatchObject(style);
    applyPptxParagraphFormat(node, style, Object.fromEntries(Object.keys(style).map(key => [key, null])));
    expect(readPptxParagraphStyle(node)).toEqual({});
    applyPptxParagraphFormat(node, {}, { bullet: { type: 'none' } });
    expect(readPptxParagraphStyle(node).bullet).toEqual({ type: 'none' });
    applyPptxParagraphFormat(node, { bullet: { type: 'none' } }, { bullet: { type: 'char', char: '•' } });
    expect(readPptxParagraphStyle(node).bullet).toEqual({ type: 'char', char: '•' });
  });

  it.each([
    ['empty fit', {}, {}],
    ['fontScale only', { fontScale: 90000 }, { fontScale: '90000' }],
    ['lnSpcReduction only', { lnSpcReduction: 1000 }, { lnSpcReduction: '1000' }],
    ['both values', { fontScale: 90000, lnSpcReduction: 1000 }, { fontScale: '90000', lnSpcReduction: '1000' }],
  ])('writes only supplied normAutofit attributes: %s', (_label, fit, attributes) => {
    const node = body('');
    applyPptxBodyLayout(node, { autofit: 'shrink', fit });
    const norm = node.querySelector('a\\:normAutofit');
    expect(norm?.getAttribute('fontScale') ?? null).toBe(attributes.fontScale ?? null);
    expect(norm?.getAttribute('lnSpcReduction') ?? null).toBe(attributes.lnSpcReduction ?? null);
    expect(readPptxBodyLayout(node)).toEqual({ autofit: 'shrink', fit });
  });

  it('sets and removes body layout, autofit and shrink measurements', () => {
    expect(() => applyPptxBodyLayout(null, {})).not.toThrow();
    const node = body('');
    const layout = { wrap: 'none', anchor: 'middle', insets: { left: 12700 }, autofit: 'shrink', fit: { fontScale: 90000, lnSpcReduction: 1000 } };
    applyPptxBodyLayout(node, layout);
    expect(readPptxBodyLayout(node)).toMatchObject({ wrap: 'none', anchor: 'middle', insets: { left: 12700 }, autofit: 'shrink' });
    expect(node.querySelector('a\\:normAutofit')?.getAttribute('fontScale')).toBe('90000');
    expect(node.querySelector('a\\:normAutofit')?.getAttribute('lnSpcReduction')).toBe('1000');
    applyPptxBodyLayout(node, { wrap: null, anchor: null, insets: { left: null }, autofit: null, fit: { fontScale: 0, lnSpcReduction: -1 } });
    expect(readPptxBodyLayout(node)).toEqual({});
    applyPptxBodyLayout(node, { autofit: 'resize' });
    expect(readPptxBodyLayout(node).autofit).toBe('resize');
    applyPptxBodyLayout(node, { autofit: 'none' });
    expect(readPptxBodyLayout(node).autofit).toBe('none');
  });
});
