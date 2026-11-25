// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readPptxColorMap, readPptxColorScheme, resolvePptxColor } from './pptxColor.js';

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

  it('reads only known clrMap slots', () => {
    const map = readPptxColorMap(parse('<p:clrMap xmlns:p="' + P + '" tx1="dk1" bg1="lt1" unknown="dk2"/>').documentElement);
    expect(map).toEqual({ tx1: 'dk1', bg1: 'lt1' });
  });
});
