import { canvasFont } from '../canvas/paint.js';
import { it, expect } from 'vitest';
import { measureShrinkFits, SHRINK_FIT_POLICY, scaledTextBody } from './measureShrinkFits.js';
import { canonicalTextBody } from './canonicalTextBody.js';
import { layoutTextBody } from '../vendor/officeview/drawing/text-layout.ts';
import { createTextBodyMeasurer } from '../vendor/officeview/drawing/text-paint.ts';
const pt = n => n * 12700;
const make = (text = 'This is a long paragraph that should shrink to fit its small frame. '.repeat(4)) => ({ id: 'box', type: 'text', geometry: { width: pt(210), height: pt(75) }, bodyLayout: { autofit: 'shrink', insets: { left: pt(12), right: pt(9), top: pt(6), bottom: pt(3) } }, text: { paragraphs: [{ runs: [{ text, style: { typeface: 'Arial', sz: '1800' } }] }] } });
const doc = o => ({ slides: [{ objects: [o] }] });
it('chooses the first fitting explicit candidate using the same adapter and real canvas layout', async () => {
  await document.fonts.ready;
  const o = make(), input = doc(o), original = structuredClone(input);
  const result = measureShrinkFits(input, { fonts: document.fonts });
  expect(result.size).toBe(1);
  const a = canonicalTextBody(o), measure = createTextBodyMeasurer(document.createElement('canvas').getContext('2d'), canvasFont);
  const candidates = SHRINK_FIT_POLICY.fontScales.flatMap(fontScale => SHRINK_FIT_POLICY.lineReductions.map(lnSpcReduction => ({ fontScale, lnSpcReduction })));
  const chosen = candidates.findIndex(c => JSON.stringify(c) === JSON.stringify(result.get('box')));
  expect(chosen).toBeGreaterThan(0);
  for (const [i, candidate] of candidates.entries()) {
    const body = scaledTextBody(a.body, candidate);
    expect(body.autofit).toBeUndefined();
    const height = layoutTextBody(body, a.width, a.height, measure).height;
    if (i < chosen) expect(height).toBeGreaterThan(a.availableHeight * .97);
    if (i === chosen) { expect(height).toBeLessThanOrEqual(a.availableHeight * .97); break; }
  }
  expect(input).toEqual(original);
});
it('returns no entry for already-fitting and empty text, and no fits while fonts load', () => {
  expect(measureShrinkFits(doc(make('Short')), { fonts: document.fonts }).size).toBe(0);
  expect(measureShrinkFits(doc(make('')), { fonts: document.fonts }).size).toBe(0);
  expect(measureShrinkFits(doc(make()), { fonts: { status: 'loading', check: () => true } }).size).toBe(0);
  expect(measureShrinkFits(doc(make()), { fonts: { status: 'loaded', check: () => false } }).size).toBe(0);
});
it('measures multi-run text, respects insets and treats nowrap as height-only', () => {
  const o = make();
  o.text.paragraphs[0].runs.push({ text: 'More text', style: { typeface: 'Arial', sz: '2400', b: '1', i: '1' } });
  expect(measureShrinkFits(doc(o), { fonts: document.fonts }).has('box')).toBe(true);
  o.bodyLayout.wrap = 'none';
  expect(measureShrinkFits(doc(o), { fonts: document.fonts }).size).toBe(0);
  o.bodyLayout.insets.bottom = pt(57);
  expect(measureShrinkFits(doc(o), { fonts: document.fonts }).has('box')).toBe(true);
});
it('emits the floor when nothing fits and skips resize or unsupported metrics', () => {
  const o = make('A\n'.repeat(500));
  expect(measureShrinkFits(doc(o), { fonts: document.fonts }).get('box')).toEqual({ fontScale: SHRINK_FIT_POLICY.fontScales.at(-1), lnSpcReduction: SHRINK_FIT_POLICY.lineReductions.at(-1) });
  o.bodyLayout.autofit = 'resize'; expect(measureShrinkFits(doc(o), { fonts: document.fonts }).size).toBe(0);
  o.bodyLayout.autofit = 'shrink'; delete o.text.paragraphs[0].runs[0].style.typeface;
  expect(measureShrinkFits(doc(o), { fonts: document.fonts }).size).toBe(0);
});
it('measures inherited theme fonts and tokens without mutating them', () => {
  const o = make(); delete o.text.paragraphs[0].runs[0].style.typeface;
  const d = doc(o); d.slides[0].layoutId = 'l'; d.layouts = [{ id: 'l', masterId: 'm' }]; d.masters = [{ id: 'm', themeId: 't' }]; d.themes = [{ id: 't', extensions: { pptxFontScheme: { minor: { latin: 'Arial', supplemental: {} } } } }];
  expect(measureShrinkFits(d, { fonts: document.fonts }).has('box')).toBe(true);
  o.text.paragraphs[0].runs[0].style.typeface = '+mn-lt';
  expect(measureShrinkFits(d, { fonts: document.fonts }).has('box')).toBe(true);
  expect(o.text.paragraphs[0].runs[0].style.typeface).toBe('+mn-lt');
});
it('measures with the requested font rather than a doubly quoted fallback', () => {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  measureShrinkFits(doc(make()), { fonts: document.fonts, canvas });
  expect(ctx.font).toContain('Arial');
  expect(ctx.font).not.toContain('\\"Arial\\"');
});
it('normalizes readiness and canvas availability failures without changing the document', () => {
  const d = doc(make());
  expect(measureShrinkFits(d, { fonts: {}, canvas: {} }).size).toBe(0);
  expect(measureShrinkFits(d, { fonts: document.fonts, canvas: { getContext: () => null } }).size).toBe(0);
  expect(measureShrinkFits({ ...d, extensions: { sourceFormat: 'odp' } }, { fonts: document.fonts }).size).toBe(0);
});
it('uses the PR4 text, frame and inherited minor font for a non-empty fit', () => {
  const o = make('Long text sample with several words for wrapping. Second sentence with enough text to exceed a short frame.');
  delete o.text.paragraphs[0].runs[0].style.typeface;
  const d = doc(o); d.slides[0].layoutId='l';d.layouts=[{id:'l',masterId:'m'}];d.masters=[{id:'m',themeId:'t'}];d.themes=[{id:'t',extensions:{pptxFontScheme:{minor:{latin:'Calibri',supplemental:{}}}}}];
  const fit=measureShrinkFits(d,{fonts:document.fonts}).get('box');
  expect(SHRINK_FIT_POLICY.fontScales).toContain(fit.fontScale);
  expect(fit.fontScale).toBeLessThan(100000);
});
it('scales point spacing and font sizes while preserving the authored insets and indents', () => {
  const o = make(); o.text.paragraphs[0].style = { spaceBefore: 10, spaceAfter: 20, lineSpacing: 150, indentStart: pt(5) };
  const body = canonicalTextBody(o).body, scaled = scaledTextBody(body, { fontScale: 50000, lnSpcReduction: 20000 });
  expect(scaled.paragraphs[0]).toMatchObject({ runs: [{ fontSizePt: 9 }], spaceBefore: { value: 5 }, spaceAfter: { value: 10 }, marginLeftEmu: pt(5) });
  expect(scaled.paragraphs[0].lineSpacing.value).toBeCloseTo(1.2);
  expect(scaled.insetLeftEmu).toBe(pt(12)); expect(body.paragraphs[0].runs[0].fontSizePt).toBe(18);
});
it('treats a rejected font query as unavailable metrics', () => {
  expect(measureShrinkFits(doc(make()), { fonts: { status: 'loaded', check: () => { throw new DOMException('Invalid font', 'SyntaxError'); } } }).size).toBe(0);
});
