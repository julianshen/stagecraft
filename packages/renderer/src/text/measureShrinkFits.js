import { canvasFont } from '../canvas/paint.js';
import { graphemes } from '../vendor/officeview/core/text-recording.ts';
import { canonicalTextBody, themeForSlide } from './canonicalTextBody.js';
import { layoutTextBody, resolveTextFamily } from '../vendor/officeview/drawing/text-layout.ts';
import { createTextBodyMeasurer, fontShorthand } from '../vendor/officeview/drawing/text-paint.ts';

// PowerPoint Mac 16.115 samples reached a 25000 floor. Policy remains version-specific,
// not a claim that this search duplicates PowerPoint's layout algorithm.
export const SHRINK_FIT_POLICY = Object.freeze({
  fontScales: Object.freeze([100000, 92500, 85000, 77500, 70000, 62500, 55000, 47500, 40000, 32500, 25000]),
  lineReductions: Object.freeze([0, 10000, 20000]),
  heightMargin: 0.97,
});

/** Explicit candidate scaling; never enable officeview's additional automatic shrink pass. */
export function scaledTextBody(body, { fontScale, lnSpcReduction }) {
  const scale = fontScale / 100000, spacing = 1 - lnSpcReduction / 100000;
  const style = run => ({ ...run, fontSizePt: run.fontSizePt * scale });
  return { ...body, paragraphs: body.paragraphs.map(p => ({ ...p, runs: p.runs.map(style), endProperties: style(p.endProperties),
    lineSpacing: { kind: 'percent', value: (p.lineSpacing?.value ?? 1) * spacing },
    ...(p.spaceBefore ? { spaceBefore: { ...p.spaceBefore, value: p.spaceBefore.value * scale } } : {}),
    ...(p.spaceAfter ? { spaceAfter: { ...p.spaceAfter, value: p.spaceAfter.value * scale } } : {}),
  })) };
}
function fontsReady(body, theme, fonts, checked) {
  for (const paragraph of body.paragraphs) for (const run of paragraph.runs) {
    // The layout engine selects script fonts per grapheme, not per whole mixed-script run.
    for (const text of new Set(graphemes(run.text || ' ').map(g => g.text))) {
      const family = resolveTextFamily({ ...run, text }, theme);
      const shorthand = fontShorthand({ ...run, fontFamily: family }, canvasFont);
      const key = JSON.stringify([shorthand, text]);
      if (!checked.has(key)) {
        try { if (!fonts.check(shorthand, text)) return false; }
        catch { return false; }
        checked.add(key);
      }
    }
  }
  return true;
}

/** Synchronous browser measurement. Host must finish font loading before calling. */
export function measureShrinkFits(document, { fonts = globalThis.document?.fonts, canvas } = {}) {
  const fits = new Map();
  if (fonts?.status !== 'loaded' || typeof fonts.check !== 'function' || document.extensions?.sourceFormat === 'odp') return fits;
  const ctx = (canvas ?? globalThis.document?.createElement('canvas'))?.getContext('2d');
  if (!ctx) return fits;
  const measure = createTextBodyMeasurer(ctx, canvasFont), checked = new Set();
  for (const slide of document.slides ?? []) {
    const theme = themeForSlide(document, slide);
    // Group-relative transforms are not represented by this adapter yet.
    for (const object of slide.objects ?? []) {
      if (object.bodyLayout?.autofit !== 'shrink') continue;
      const a = canonicalTextBody(object, theme);
      if (!a || !a.body.paragraphs.some(p => p.runs.some(r => r.text.trim()))) continue;
      if (!fontsReady(a.body, theme, fonts, checked)) return new Map();
      const height = body => layoutTextBody(body, a.width, a.height, measure, theme).height;
      const initialHeight = height(a.body);
      if (initialHeight <= a.availableHeight) continue;
      let selected;
      search: for (const fontScale of SHRINK_FIT_POLICY.fontScales) for (const lnSpcReduction of SHRINK_FIT_POLICY.lineReductions) {
        selected = { fontScale, lnSpcReduction };
        if ((fontScale === 100000 && lnSpcReduction === 0 ? initialHeight : height(scaledTextBody(a.body, selected))) <= a.availableHeight * SHRINK_FIT_POLICY.heightMargin) break search;
      }
      fits.set(object.id, selected);
    }
  }
  return fits;
}
