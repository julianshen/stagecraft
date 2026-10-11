import { describe, it, expect } from 'vitest';
import { parseXml, kids, kid, path, desc, attr, relAttr, blipRel, boolAttr, numAttr, xfrmBox } from './ooxml.js';

const NS = 'xmlns:a="urn:a" xmlns:p="urn:p" xmlns:r="urn:r"';
const root = (inner) => parseXml(`<p:root ${NS}>${inner}</p:root>`).documentElement;

describe('child lookups (namespace-agnostic, direct children only)', () => {
  const r = root('<p:sp><p:spPr><a:xfrm/></p:spPr></p:sp><p:sp/><a:sp/>');
  it('kid / kids match a direct child by localName, whatever its prefix', () => {
    expect(kids(r, 'sp')).toHaveLength(3);
    expect(kid(r, 'sp')).toBe(r.firstElementChild);
    expect(kid(r, 'xfrm')).toBeNull(); // not a direct child
    expect(kid(null, 'sp')).toBeNull();
    expect(kids(null, 'sp')).toEqual([]);
  });
  it('path walks a chain of children; desc searches depth-first', () => {
    expect(path(r, 'sp', 'spPr', 'xfrm')?.localName).toBe('xfrm');
    expect(path(r, 'sp', 'missing', 'xfrm')).toBeNull();
    expect(desc(r, 'xfrm')?.localName).toBe('xfrm');
    expect(desc(r, 'nope')).toBeNull();
    expect(desc(null, 'xfrm')).toBeNull();
  });
});

describe('attributes', () => {
  const el = root('<p:sldId id="256" r:id="rId2" flipH="true" flipV="0" n="1.5" bad="x"/>').firstElementChild;
  it('attr reads by localName, ignoring the prefix; relAttr only the prefixed one', () => {
    expect(attr(el, 'id')).toBe('256'); // the first by localName (the unprefixed id)
    expect(relAttr(el, 'id')).toBe('rId2');
    expect(attr(el, 'missing')).toBeNull();
    expect(attr(null, 'id')).toBeNull();
    expect(relAttr(null, 'id')).toBeNull();
  });
  it('blipRel prefers r:embed, else r:link', () => {
    const blips = root('<a:blip r:embed="rE" r:link="rL"/><a:blip r:link="rL"/>');
    expect(blipRel(blips.children[0])).toBe('rE');
    expect(blipRel(blips.children[1])).toBe('rL');
  });
  it('boolAttr reads xsd:boolean ("1"/"true"), defaulting when absent', () => {
    expect(boolAttr(el, 'flipH')).toBe(true);
    expect(boolAttr(el, 'flipV')).toBe(false);
    expect(boolAttr(el, 'missing')).toBe(false);
    expect(boolAttr(el, 'missing', true)).toBe(true);
  });
  it('numAttr parses a finite number, else the default', () => {
    expect(numAttr(el, 'n')).toBe(1.5);
    expect(numAttr(el, 'bad', 7)).toBe(7);
    expect(numAttr(el, 'missing')).toBeNull();
  });
});

describe('xfrmBox', () => {
  const xfrm = (attrs = '') => root(`<a:xfrm${attrs}><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm>`).firstElementChild;
  it('reads an EMU box with its rotation (degrees) and flips', () => {
    expect(xfrmBox(xfrm(' rot="5400000" flipH="1"'))).toEqual({ x: 10, y: 20, w: 30, h: 40, rot: 90, flipH: true, flipV: false });
  });
  it('maps the box through a group transform when given one', () => {
    expect(xfrmBox(xfrm(), (b) => ({ ...b, x: b.x + 100 })).x).toBe(110);
  });
  it('is null without an xfrm or its off/ext', () => {
    expect(xfrmBox(null)).toBeNull();
    expect(xfrmBox(root('<a:xfrm><a:off x="1" y="2"/></a:xfrm>').firstElementChild)).toBeNull();
  });
});
