import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import pptxgen from 'pptxgenjs';
import { patchSlideXml, postProcess, linAngle } from './pptxPost.js';
import { importPptx } from './pptxImport.js';
import { NS, tree } from '../test/pptxFixture.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

// A pptxgenjs-shaped shape: named, with an xfrm and a solid fill (optionally translucent).
const sp = (id, name, { x = 0, y = 0, w = 100, h = 100, fill = 'FF0000', alpha } = {}) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>`
  + `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`
  + `<a:solidFill><a:srgbClr val="${fill}">${alpha != null ? `<a:alpha val="${alpha}"/>` : ''}</a:srgbClr></a:solidFill>`
  + `<a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr></p:sp>`;
const pic = (id, name, { x = 0, y = 0, w = 100, h = 100 } = {}) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}" descr=""/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/>`
  + `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr></p:pic>`;
const slide = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}>${tree(inner)}</p:sld>`;
const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const byName = (doc, name) => [...doc.getElementsByTagNameNS(P, 'cNvPr')].find((n) => n.getAttribute('name') === name);
const spTree = (doc) => doc.getElementsByTagNameNS(P, 'spTree')[0];
const childNames = (node) => [...node.children].filter((c) => c.localName !== 'nvGrpSpPr' && c.localName !== 'grpSpPr')
  .map((c) => c.getElementsByTagNameNS(P, 'cNvPr')[0].getAttribute('name'));

describe('linAngle (CSS linear-gradient angle → DrawingML a:lin ang)', () => {
  it('maps CSS (0° = up, clockwise) to DrawingML (0° = rightward, clockwise) in 60000ths', () => {
    expect(linAngle(90)).toBe(0);              // to right
    expect(linAngle(180)).toBe(90 * 60000);    // to bottom
    expect(linAngle(0)).toBe(270 * 60000);     // to top
    expect(linAngle(-45)).toBe(225 * 60000);   // normalised into [0, 360)
    expect(linAngle(450)).toBe(0);
  });
});

describe('patchSlideXml — gradients', () => {
  it('replaces a named shape\'s solid fill with a two-stop linear gradFill', () => {
    const out = parse(patchSlideXml(slide(sp(2, 'el-a') + sp(3, 'el-b')), { gradients: { 'el-a': { from: '112233', to: 'AABBCC', angle: 180 } } }));
    const spPr = byName(out, 'el-a').closest('sp').getElementsByTagNameNS(P, 'spPr')[0];
    const grad = [...spPr.children].find((c) => c.localName === 'gradFill');
    expect(grad).toBeTruthy();
    expect([...spPr.children].some((c) => c.localName === 'solidFill')).toBe(false); // the outline's solidFill (inside a:ln) is untouched
    expect(spPr.getElementsByTagNameNS(A, 'ln')[0].getElementsByTagNameNS(A, 'solidFill')).toHaveLength(1);
    const stops = [...grad.getElementsByTagNameNS(A, 'gs')];
    expect(stops.map((g) => g.getAttribute('pos'))).toEqual(['0', '100000']);
    expect(stops.map((g) => g.getElementsByTagNameNS(A, 'srgbClr')[0].getAttribute('val'))).toEqual(['112233', 'AABBCC']);
    expect(grad.getElementsByTagNameNS(A, 'lin')[0].getAttribute('ang')).toBe(String(90 * 60000));
    // the other shape keeps its solid fill
    const other = byName(out, 'el-b').closest('sp').getElementsByTagNameNS(P, 'spPr')[0];
    expect([...other.children].some((c) => c.localName === 'solidFill')).toBe(true);
  });

  it('keeps the shape\'s transparency on both stops', () => {
    const out = parse(patchSlideXml(slide(sp(2, 'el-a', { alpha: 40000 })), { gradients: { 'el-a': { from: '112233', to: 'AABBCC', angle: 90 } } }));
    const alphas = [...out.getElementsByTagNameNS(A, 'gs')].map((g) => g.getElementsByTagNameNS(A, 'alpha')[0]?.getAttribute('val'));
    expect(alphas).toEqual(['40000', '40000']);
  });

  it('leaves a shape without a solid fill (e.g. noFill) alone, and works without an XML declaration', () => {
    const noFill = `<p:sld ${NS}>${tree(sp(2, 'el-a').replace('<a:solidFill><a:srgbClr val="FF0000"></a:srgbClr></a:solidFill><a:ln>', '<a:noFill/><a:ln>'))}</p:sld>`;
    const out = patchSlideXml(noFill, { gradients: { 'el-a': { from: '000000', to: 'FFFFFF', angle: 0 } } });
    expect(out.startsWith('<p:sld')).toBe(true);
    expect(out).not.toContain('gradFill');
    expect(out).toContain('<a:noFill/>');
  });

  it('keeps the XML declaration and ignores names it cannot find', () => {
    const src = slide(sp(2, 'el-a'));
    const out = patchSlideXml(src, { gradients: { missing: { from: '000000', to: 'FFFFFF', angle: 0 } } });
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    expect(out).toContain('<a:solidFill><a:srgbClr val="FF0000"/>');
  });
});

describe('patchSlideXml — groups', () => {
  it('wraps a group\'s members in a p:grpSp with an identity child frame spanning them', () => {
    const xml = slide(sp(2, 'a', { x: 100, y: 200, w: 300, h: 50 }) + pic(3, 'b', { x: 250, y: 100, w: 100, h: 400 }) + sp(4, 'c'));
    const out = parse(patchSlideXml(xml, { groups: [['a', 'b']] }));
    const grp = spTree(out).getElementsByTagNameNS(P, 'grpSp')[0];
    expect(childNames(grp)).toEqual(['a', 'b']);
    const top = [...spTree(out).children].filter((c) => c.localName === 'sp' || c.localName === 'grpSp');
    expect(top.map((c) => c.localName)).toEqual(['grpSp', 'sp']); // c stays above the group
    const xf = grp.getElementsByTagNameNS(P, 'grpSpPr')[0].getElementsByTagNameNS(A, 'xfrm')[0];
    const val = (tag, a) => xf.getElementsByTagNameNS(A, tag)[0].getAttribute(a);
    // bounding box: x 100..400, y 100..500
    expect([val('off', 'x'), val('off', 'y'), val('ext', 'cx'), val('ext', 'cy')]).toEqual(['100', '100', '300', '400']);
    expect([val('chOff', 'x'), val('chOff', 'y'), val('chExt', 'cx'), val('chExt', 'cy')]).toEqual(['100', '100', '300', '400']);
  });

  it('gives the group a fresh, unique shape id', () => {
    const out = parse(patchSlideXml(slide(sp(2, 'a') + sp(7, 'b') + sp(3, 'c') + sp(4, 'd')), { groups: [['a', 'b'], ['c', 'd']] }));
    const ids = [...out.getElementsByTagNameNS(P, 'cNvPr')].map((n) => n.getAttribute('id'));
    expect(new Set(ids).size).toBe(ids.length);
    const groupIds = [...out.getElementsByTagNameNS(P, 'grpSp')].map((g) => Number(g.getElementsByTagNameNS(P, 'cNvPr')[0].getAttribute('id')));
    expect(groupIds.every((id) => id > 7)).toBe(true);
  });

  it('gathers non-adjacent members at the topmost member\'s z-position, keeping their order', () => {
    // a (group) · x · b (group) → x · [a, b]: PowerPoint groups are contiguous.
    const out = parse(patchSlideXml(slide(sp(2, 'a') + sp(3, 'x') + sp(4, 'b')), { groups: [['a', 'b']] }));
    const top = [...spTree(out).children].filter((c) => c.localName === 'sp' || c.localName === 'grpSp').map((c) => c.localName);
    expect(top).toEqual(['sp', 'grpSp']);
    expect(childNames(spTree(out).getElementsByTagNameNS(P, 'grpSp')[0])).toEqual(['a', 'b']);
  });

  it('leaves a group alone unless at least two members are found', () => {
    const src = slide(sp(2, 'a') + sp(3, 'b'));
    expect(parse(patchSlideXml(src, { groups: [['a', 'missing']] })).getElementsByTagNameNS(P, 'grpSp')).toHaveLength(0);
  });
});

describe('postProcess', () => {
  it('returns the input untouched when no slide has work', async () => {
    const buf = new ArrayBuffer(4);
    expect(await postProcess(buf, [{}, { gradients: {}, groups: [] }])).toBe(buf);
  });

  it('patches only the slides with work, by slide order', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', slide(sp(2, 'a')));
    zip.file('ppt/slides/slide2.xml', slide(sp(2, 'a')));
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const out = await JSZip.loadAsync(await postProcess(buf, [{}, { gradients: { a: { from: '000000', to: 'FFFFFF', angle: 90 } } }]));
    expect(await out.file('ppt/slides/slide1.xml').async('string')).not.toContain('gradFill');
    expect(await out.file('ppt/slides/slide2.xml').async('string')).toContain('<a:gradFill');
  });

  it('round-trips through PowerPoint XML: real pptxgenjs output → patched → re-imported with its gradient, group and flip', async () => {
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_16x9';
    const s = pptx.addSlide();
    s.addShape(pptx.ShapeType.rect, { x: 1, y: 1, w: 2, h: 1, fill: { color: '808080' }, objectName: 'grad' });
    s.addShape(pptx.ShapeType.rect, { x: 4, y: 1, w: 1, h: 1, fill: { color: '00FF00' }, objectName: 'g1', flipH: true });
    s.addShape(pptx.ShapeType.ellipse, { x: 5, y: 2, w: 1, h: 1, fill: { color: '0000FF' }, objectName: 'g2' });
    const raw = await pptx.write({ outputType: 'arraybuffer' });
    const patched = await postProcess(raw, [{ gradients: { grad: { from: '112233', to: 'AABBCC', angle: 180 } }, groups: [['g1', 'g2']] }]);
    const { deck } = await importPptx(patched);
    const els = deck.slides[0].elements;
    const g = els.find((e) => e.gradient);
    expect(g.gradient).toMatchObject({ from: '#112233', to: '#AABBCC', angle: 180 });
    const grouped = els.filter((e) => e.groupId);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].groupId).toBe(grouped[1].groupId);
    expect(grouped.map((e) => !!e.flipH)).toEqual([true, false]); // a flip survives inside the group
  });
});
