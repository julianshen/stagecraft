import { autofitHintEligibility } from '@stagecraft/core/lib/resizeGeometry.js';
import { canvasFont } from '../canvas/paint.js';
import { fontsReady, waitForBodyFonts } from './fontReadiness.js';
import { canonicalTextBody, themeForSlide } from './canonicalTextBody.js';
import { layoutTextBody } from '../vendor/officeview/drawing/text-layout.ts';
import { createTextBodyMeasurer } from '../vendor/officeview/drawing/text-paint.ts';

// PowerPoint Mac 16.115 samples reached a 25000 floor. Policy remains version-specific,
// not a claim that this search duplicates PowerPoint's layout algorithm.
export const SHRINK_FIT_POLICY = Object.freeze({
  fontScales: Object.freeze([100000, 92500, 85000, 77500, 70000, 62500, 55000, 47500, 40000, 32500, 25000]),
  lineReductions: Object.freeze([0, 10000, 20000]),
  heightMargin: 0.97,
});

/** Explicit candidate scaling; native display can opt into PowerPoint's nearest-whole-point face size. Never enable officeview's additional automatic shrink pass. */
export function scaledTextBody(body, { fontScale, lnSpcReduction }, { snapFontSize = false } = {}) {
  const scale = fontScale / 100000, spacing = 1 - lnSpcReduction / 100000;
  const scaledSize = size => {
    const value = size * scale;
    return snapFontSize ? Math.round(value) : value;
  };
  const style = run => ({ ...run, fontSizePt: scaledSize(run.fontSizePt) });
  return { ...body, paragraphs: body.paragraphs.map(p => ({ ...p, runs: p.runs.map(style), endProperties: style(p.endProperties),
    lineSpacing: { kind: 'percent', value: (p.lineSpacing?.value ?? 1) * spacing },
    ...(p.spaceBefore ? { spaceBefore: { ...p.spaceBefore, value: p.spaceBefore.value * scale } } : {}),
    ...(p.spaceAfter ? { spaceAfter: { ...p.spaceAfter, value: p.spaceAfter.value * scale } } : {}),
  })) };
}
function hasNestedShrink(object) {
  const pending = [...(object.children ?? [])];
  while (pending.length) {
    const child = pending.pop();
    if (child.bodyLayout?.autofit === 'shrink') return true;
    for (const descendant of child.children ?? []) pending.push(descendant);
  }
  return false;
}
export function shrinkBodies(document, { baseline } = {}) {
  const bodies = [], reasons = {};
  const originals = new Map();
  const visit = objects => { for (const object of objects ?? []) { originals.set(object.id, object); visit(object.children); } };
  for (const owner of [...(baseline?.slides ?? []), ...(baseline?.layouts ?? []), ...(baseline?.masters ?? [])]) visit(owner.objects);
  const skip = reason => { reasons[reason] = (reasons[reason] ?? 0) + 1; };
  let reason = 'no-shrink', candidates = 0;
  for (const slide of document.slides ?? []) {
    const theme = themeForSlide(document, slide);
    for (const object of slide.objects ?? []) {
      if (hasNestedShrink(object)) reason = 'unsupported-metrics';
      if (object.bodyLayout?.autofit !== 'shrink') continue;
      candidates++;
      const eligibility = autofitHintEligibility(object, originals.get(object.id));
      if (eligibility) { reason = eligibility; skip(eligibility); continue; }
      const a = canonicalTextBody(object, theme);
      if (!a) { reason = 'unsupported-metrics'; skip(reason); }
      else if (a.body.paragraphs.some(p => p.runs.some(r => r.text.trim()))) bodies.push({ object, ...a });
      else { if (reason !== 'unsupported-metrics') reason = 'empty-text'; skip('empty-text'); }
    }
  }
  return { bodies, reason, candidates, reasons };
}

/** Load only the captured snapshot's measurable shrink fonts; failure is an optional-fit fallback. */
export async function waitForShrinkFonts(document, { fonts = globalThis.document?.fonts, timeoutMs = 2000, baseline } = {}) {
  if (!fonts?.load || !fonts?.check) return {status:'skipped',reason:'fonts-unavailable'};
  try {
    const {bodies,reason,reasons}=shrinkBodies(document,{baseline});
    if(!bodies.length)return {status:'skipped',reason,count:0,reasons};
    return await waitForBodyFonts(bodies,{fonts,timeoutMs});
  } catch { return {status:'failed',reason:'error',message:'Font readiness failed.'}; }
}

/** Synchronous browser measurement. Host must finish font loading before calling. */
export function measureShrinkFits(document, { fonts = globalThis.document?.fonts, canvas, baseline } = {}) {
  const skipped = (reason, candidates = 0, reasons = {}) => ({
    fit: new Map(), status: 'skipped', reason, count: 0,
    stats: { candidates, measured: 0, skipped: candidates, failed: 0 },
    reasons: Object.keys(reasons).length ? reasons : { [reason]: candidates },
  });
  try {
    const fits = new Map();
    if (document.extensions?.sourceFormat === 'odp') return skipped('not-pptx');
    if (typeof fonts?.check !== 'function') return skipped('fonts-unavailable');
    const { bodies, reason, candidates, reasons } = shrinkBodies(document, { baseline });
    if (!bodies.length) return skipped(reason, candidates, reasons);
    const ctx = (canvas ?? globalThis.document?.createElement('canvas'))?.getContext('2d');
    if (!ctx) {
      reasons['canvas-unavailable'] = (reasons['canvas-unavailable'] ?? 0) + bodies.length;
      return skipped('canvas-unavailable', candidates, reasons);
    }
    const measure = createTextBodyMeasurer(ctx, canvasFont), checked = new Set();
    for (const a of bodies) {
      const { object, theme } = a;
      if (!fontsReady(a.body, theme, fonts, checked)) {
        reasons['fonts-unavailable'] = (reasons['fonts-unavailable'] ?? 0) + bodies.length;
        return skipped('fonts-unavailable', candidates, reasons);
      }
      const height = body => layoutTextBody(body, a.width, a.height, measure, theme).height;
      const initialHeight = height(a.body);
      if (initialHeight <= a.availableHeight) { reasons['already-fits'] = (reasons['already-fits'] ?? 0) + 1; continue; }
      let selected;
      search: for (const fontScale of SHRINK_FIT_POLICY.fontScales) for (const lnSpcReduction of SHRINK_FIT_POLICY.lineReductions) {
        selected = { fontScale, lnSpcReduction };
        if ((fontScale === 100000 && lnSpcReduction === 0 ? initialHeight : height(scaledTextBody(a.body, selected))) <= a.availableHeight * SHRINK_FIT_POLICY.heightMargin) break search;
      }
      fits.set(object.id, selected);
    }
    const stats = { candidates, measured: fits.size, skipped: candidates - fits.size, failed: 0 };
    return fits.size
      ? { fit: fits, status: 'measured', count: fits.size, stats, reasons }
      : skipped(reason === 'unsupported-metrics' ? reason : 'already-fits', candidates, reasons);
  } catch {
    return { fit: new Map(), status: 'failed', reason: 'error', message: 'Shrink measurement failed.', count: 0,
      stats: { candidates: 0, measured: 0, skipped: 0, failed: 0 }, reasons: {} };
  }
}
