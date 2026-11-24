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
function* fontQueries(body, theme) {
  for (const paragraph of body.paragraphs) for (const run of paragraph.runs) {
    for (const text of new Set(graphemes(run.text || ' ').map(g => g.text))) {
      const family = resolveTextFamily({ ...run, text }, theme);
      yield { shorthand: fontShorthand({ ...run, fontFamily: family }, canvasFont), text };
    }
  }
}
function fontsReady(body, theme, fonts, checked) {
  for (const { shorthand, text } of fontQueries(body, theme)) {
    const key = JSON.stringify([shorthand, text]);
    if (!checked.has(key)) {
      if (!fonts.check(shorthand, text)) return false;
      checked.add(key);
    }
  }
  return true;
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
function shrinkBodies(document) {
  const bodies = [];
  let reason = 'no-shrink';
  for (const slide of document.slides ?? []) {
    const theme = themeForSlide(document, slide);
    for (const object of slide.objects ?? []) {
      if (hasNestedShrink(object)) reason = 'unsupported-metrics';
      if (object.bodyLayout?.autofit !== 'shrink') continue;
      const a = canonicalTextBody(object, theme);
      if (!a) reason = 'unsupported-metrics';
      else if (a.body.paragraphs.some(p => p.runs.some(r => r.text.trim()))) bodies.push({ object, ...a });
      else if (reason !== 'unsupported-metrics') reason = 'empty-text';
    }
  }
  return { bodies, reason };
}

/** Load only the captured snapshot's measurable shrink fonts; failure is an optional-fit fallback. */
export async function waitForShrinkFonts(document, { fonts = globalThis.document?.fonts, timeoutMs = 2000 } = {}) {
  if (!fonts?.load || !fonts?.check) return { status: 'skipped', reason: 'fonts-unavailable' };
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        const queries = new Map();
        const { bodies, reason } = shrinkBodies(document);
        for (const { body, theme } of bodies) for (const { shorthand, text } of fontQueries(body, theme)) {
          if (!queries.has(shorthand)) queries.set(shorthand, new Set());
          queries.get(shorthand).add(text);
        }
        if (!queries.size) return { status: 'skipped', reason };
        await Promise.all([...queries].map(([shorthand, chars]) => {
          const text = [...chars].join('');
          return fonts.check(shorthand, text) ? undefined : fonts.load(shorthand, text);
        }));
        await fonts.ready;
        return fonts.status === 'loaded' && [...queries].every(([shorthand, chars]) => fonts.check(shorthand, [...chars].join('')))
          ? { status: 'ready' } : { status: 'skipped', reason: 'fonts-unavailable' };
      }),
      new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'skipped', reason: 'fonts-timeout' }), timeoutMs); }),
    ]);
  } catch { return { status: 'failed', reason: 'error', message: 'Font readiness failed.' }; }
  finally { clearTimeout(timer); }
}

/** Synchronous browser measurement. Host must finish font loading before calling. */
export function measureShrinkFits(document, { fonts = globalThis.document?.fonts, canvas } = {}) {
  const skipped = reason => ({ fit: new Map(), status: 'skipped', reason, count: 0 });
  try {
    const fits = new Map();
    if (document.extensions?.sourceFormat === 'odp') return skipped('not-pptx');
    if (fonts?.status !== 'loaded' || typeof fonts.check !== 'function') return skipped('fonts-unavailable');
    const { bodies, reason } = shrinkBodies(document);
    if (!bodies.length) return skipped(reason);
    const ctx = (canvas ?? globalThis.document?.createElement('canvas'))?.getContext('2d');
    if (!ctx) return skipped('canvas-unavailable');
    const measure = createTextBodyMeasurer(ctx, canvasFont), checked = new Set();
    for (const a of bodies) {
      const { object, theme } = a;
      if (!fontsReady(a.body, theme, fonts, checked)) return skipped('fonts-unavailable');
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
    return fits.size ? { fit: fits, status: 'measured', count: fits.size } : skipped(reason === 'unsupported-metrics' ? reason : 'already-fits');
  } catch {
    return { fit: new Map(), status: 'failed', reason: 'error', message: 'Shrink measurement failed.', count: 0 };
  }
}
