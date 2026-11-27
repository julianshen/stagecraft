import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readPptxColorMap, readPptxColorScheme, resolvePptxColor, resolvePptxSchemeColor } from './pptxColor.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const parse = xml => new JSDOM(xml, { contentType: 'text/xml' }).window.document;
const color = xml => parse(xml).documentElement.firstElementChild;

describe('PPTX appearance colour resolution', () => {
  it('resolves direct sRGB and system lastClr colours', () => {
    const palette = {};
    expect(resolvePptxColor(color('<x xmlns:a="' + A + '"><a:srgbClr val="1a2b3c"/></x>'), palette, {})).toBe('#1A2B3C');
    expect(resolvePptxColor(color('<x xmlns:a="' + A + '"><a:sysClr val="windowText" lastClr="ABCDEF"/></x>'), palette, {})).toBe('#ABCDEF');
  });

  it('applies clrMap before resolving scheme colours', () => {
    const palette = { dk1: '#112233', lt1: '#FFFFFF' };
    expect(resolvePptxColor(color('<x xmlns:a="' + A + '"><a:schemeClr val="tx1"/></x>'), palette, { tx1: 'dk1' })).toBe('#112233');
    expect(resolvePptxColor(color('<x xmlns:a="' + A + '"><a:schemeClr val="bg1"/></x>'), palette, { bg1: 'lt1' })).toBe('#FFFFFF');
  });

  it('applies lumMod and lumOff in source order with clamping', () => {
    const palette = {};
    expect(resolvePptxColor(color('<x xmlns:a="' + A + '"><a:srgbClr val="FFFFFF"><a:lumMod val="50000"/></a:srgbClr></x>'), palette, {})).toBe('#808080');
    expect(resolvePptxColor(color('<x xmlns:a="' + A + '"><a:srgbClr val="000000"><a:lumOff val="20000"/></a:srgbClr></x>'), palette, {})).toBe('#333333');
    expect(resolvePptxColor(color('<x xmlns:a="' + A + '"><a:srgbClr val="808080"><a:lumMod val="50000"/><a:lumOff val="50000"/></a:srgbClr></x>'), palette, {})).toBe('#C0C0C0');
    expect(resolvePptxColor(color('<x xmlns:a="' + A + '"><a:srgbClr val="000000"><a:lumOff val="200000"/></a:srgbClr></x>'), palette, {})).toBe('#FFFFFF');
  });

  it('refuses unsupported transforms, alpha, and invalid values', () => {
    const palette = {};
    for (const xml of [
      '<a:srgbClr val="112233"><a:tint val="50000"/></a:srgbClr>',
      '<a:srgbClr val="112233"><a:alpha val="50000"/></a:srgbClr>',
      '<a:srgbClr val="112233"><a:lumMod val="bad"/></a:srgbClr>',
      '<a:schemeClr val="missing"/>',
    ]) {
      expect(resolvePptxColor(color('<x xmlns:a="' + A + '">' + xml + '</x>'), palette, {})).toBeNull();
    }
  });

  it('builds a resolved theme palette and rejects cyclic scheme references', () => {
    const theme = parse('<a:theme xmlns:a="' + A + '"><a:themeElements><a:clrScheme name="Office">'
      + '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'
      + '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
      + '<a:accent1><a:srgbClr val="4472C4"><a:lumMod val="50000"/></a:srgbClr></a:accent1>'
      + '</a:clrScheme></a:themeElements></a:theme>');
    expect(readPptxColorScheme(theme.documentElement)).toEqual({
      dk1: '#000000', lt1: '#FFFFFF', accent1: '#203864',
    });

    const cyclic = parse('<a:theme xmlns:a="' + A + '"><a:themeElements><a:clrScheme name="Office">'
      + '<a:dk1><a:schemeClr val="lt1"/></a:dk1><a:lt1><a:schemeClr val="dk1"/></a:lt1>'
      + '</a:clrScheme></a:themeElements></a:theme>');
    expect(readPptxColorScheme(cyclic.documentElement)).toEqual({});
  });

  it('covers direct, mapped, invalid and transformed colour boundaries', () => {
    const xml = value => color('<x xmlns:a="' + A + '">' + value + '</x>');
    expect(resolvePptxColor(xml('<a:srgbClr val="#112233"/>'), {}, {})).toBe('#112233');
    expect(resolvePptxColor(xml('<a:schemeClr val="accent1"/>'), { accent1: '#445566' }, {})).toBe('#445566');
    expect(resolvePptxColor(xml('<a:sysClr val="window"/>'), {}, {})).toBeNull();
    expect(resolvePptxColor(xml('<a:unknownClr/>'), {}, {})).toBeNull();
    expect(resolvePptxColor(null, {}, {})).toBeNull();
    expect(resolvePptxColor(xml('<a:srgbClr val="112233"><a:lumMod val="9007199254740992"/></a:srgbClr>'), {}, {})).toBeNull();
  });

  it('ignores malformed palette entries and missing scheme containers', () => {
    expect(readPptxColorMap(null)).toEqual({});
    expect(readPptxColorMap(parse('<p:clrMap xmlns:p="' + P + '" tx1="unknown"/>').documentElement)).toEqual({});
    expect(readPptxColorScheme(null)).toEqual({});
    const empty = parse('<a:theme xmlns:a="' + A + '"><a:themeElements><a:clrScheme/></a:themeElements></a:theme>');
    expect(readPptxColorScheme(empty.documentElement)).toEqual({});
    const unsupported = parse('<a:theme xmlns:a="' + A + '"><a:themeElements><a:clrScheme><a:accent1><a:scrgbClr/></a:accent1>'
      + '<a:accent2/><a:accent3><a:schemeClr val="missing"/></a:accent3><a:accent4><a:srgbClr val="112233"><a:tint val="1"/></a:srgbClr></a:accent4>'
      + '</a:clrScheme></a:themeElements></a:theme>');
    expect(readPptxColorScheme(unsupported.documentElement)).toEqual({});
  });

  it('resolves recursive scheme colours and clamps each luminance transform', () => {
    const recursive = parse('<a:theme xmlns:a="' + A + '"><a:themeElements><a:clrScheme>'
      + '<a:dk1><a:srgbClr val="112233"/></a:dk1><a:accent1><a:schemeClr val="dk1"><a:lumMod val="50000"/></a:schemeClr></a:accent1>'
      + '<a:bg1><a:schemeClr val="lt1"/></a:bg1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>'
      + '</a:clrScheme></a:themeElements></a:theme>');
    expect(readPptxColorScheme(recursive.documentElement)).toEqual({ dk1: '#112233', accent1: '#09111A', bg1: '#FFFFFF', lt1: '#FFFFFF' });
    expect(resolvePptxColor(color('<x xmlns:a="' + A + '"><a:srgbClr val="FFFFFF"><a:lumOff val="20000"/><a:lumMod val="50000"/></a:srgbClr></x>'), {}, {})).toBe('#808080');
  });

  it('applies transforms at every recursive theme-colour level', () => {
    const theme = parse('<a:theme xmlns:a="' + A + '"><a:themeElements><a:clrScheme>'
      + '<a:dk1><a:srgbClr val="FFFFFF"><a:lumMod val="50000"/></a:srgbClr></a:dk1>'
      + '<a:accent1><a:schemeClr val="dk1"/></a:accent1>'
      + '<a:dk2><a:srgbClr val="FFFFFF"><a:alpha val="50000"/></a:srgbClr></a:dk2>'
      + '<a:accent2><a:schemeClr val="dk2"/></a:accent2>'
      + '</a:clrScheme></a:themeElements></a:theme>');
    expect(readPptxColorScheme(theme.documentElement)).toEqual({ dk1: '#808080', accent1: '#808080' });
  });

  it('resolves deferred scheme colours with ordered transforms and fails closed', () => {
    const palette = { dk1: '#112233', lt1: '#FFFFFF' };
    expect(resolvePptxSchemeColor('tx1', [], palette, { tx1: 'dk1' })).toBe('#112233');
    expect(resolvePptxSchemeColor('tx1', [{ name: 'lumMod', raw: '50000' }], palette, { tx1: 'dk1' })).toBe('#09111A');
    expect(resolvePptxSchemeColor('bg1', [{ name: 'lumOff', raw: '20000' }], palette, { bg1: 'lt1' })).toBe('#FFFFFF');
    expect(resolvePptxSchemeColor('missing', [], palette, {})).toBeNull();
    expect(resolvePptxSchemeColor('tx1', [{ name: 'alpha', raw: '50000' }], palette, { tx1: 'dk1' })).toBeNull();
  });

  it('reads only known clrMap slots', () => {
    const map = readPptxColorMap(parse('<p:clrMap xmlns:p="' + P + '" tx1="dk1" bg1="lt1" unknown="dk2"/>').documentElement);
    expect(map).toEqual({ tx1: 'dk1', bg1: 'lt1' });
  });
});
