import { canvasFont } from '../canvas/paint.js';
import { graphemes } from '../vendor/officeview/core/text-recording.ts';
import { resolveTextFamily } from '../vendor/officeview/drawing/text-layout.ts';
import { fontShorthand } from '../vendor/officeview/drawing/text-paint.ts';

export const FONT_AVAILABILITY_PROBE = 'WWWmmm ii ll 0189 OQ@#';
const AVAILABILITY_FALLBACKS = ['monospace', 'serif', 'sans-serif'];
let sharedFontAvailability = null;
export function setSharedFontAvailability(value) { sharedFontAvailability = value; }
export function getSharedFontAvailability() { return sharedFontAvailability; }
const firstFontFamily = stack => {
  const quoted = /^\s*"((?:\\.|[^"\\])*)"/.exec(stack);
  if (quoted) return quoted[1].replace(/\\(["\\])/g, '$1');
  const single = /^\s*'([^']*)'/.exec(stack);
  if (single) return single[1];
  return (stack ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '');
};
const shorthandParts = shorthand => {
  const value = typeof shorthand === 'string' ? shorthand : '';
  const sizes = [...value.matchAll(/(?:^|\s)\d+(?:\.\d+)?(?:px|pt|em|rem|%)(?=\s|$)/gi)];
  const lastSize = sizes.at(-1);
  const stylePart = lastSize ? value.slice(0, lastSize.index) : value;
  const familyPart = lastSize ? value.slice(lastSize.index + lastSize[0].length).trim() : value;
  return {
    family: firstFontFamily(familyPart),
    italic: /(?:^|\s)(?:italic|oblique)(?:\s|$)/i.test(stylePart),
    bold: /(?:^|\s)(?:bold|[1-9]00)(?:\s|$)/i.test(stylePart),
  };
};
const quoteFamily = family => `"${family.replace(/["\\]/g, '\\$&')}"`;

/**
 * One availability signal for native text: a measured face is available only when its advance
 * differs from every generic fallback. document.fonts.check alone reports true for families
 * that resolve to a fallback. Results are cached per family/weight/style and cleared when fonts load.
 */
export function createFontAvailability({ fonts, canvas } = {}) {
  let ctx;
  const context = () => {
    if (ctx === undefined) {
      try { ctx = canvas?.getContext?.('2d') ?? null; }
      catch { ctx = null; }
    }
    return ctx;
  };
  const cache = new Map();
  const measure = (font, text) => {
    const target = context();
    target.font = font;
    return target.measureText(text).width;
  };
  const invalidate = () => cache.clear();
  fonts?.addEventListener?.('loadingdone', invalidate);
  fonts?.addEventListener?.('loadingerror', invalidate);
  return {
    isAvailable(shorthand, text = '') {
      const target = context();
      if (!target || typeof target.measureText !== 'function') return false;
      const { family, italic, bold } = shorthandParts(shorthand);
      if (!family) return false;
      const key = JSON.stringify([family.toLowerCase(), bold, italic]);
      if (cache.has(key)) return cache.get(key);
      const probe = `${String(text).replace(/[\r\n\t]+/g, ' ')} ${FONT_AVAILABILITY_PROBE}`.trim();
      const prefix = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}16px `;
      const targetWidth = measure(`${prefix}${quoteFamily(family)}`, probe);
      const available = AVAILABILITY_FALLBACKS.every(fallback =>
        Math.abs(targetWidth - measure(`${prefix}${fallback}`, probe)) > 0.01);
      cache.set(key, available);
      return available;
    },
    invalidate,
    dispose() {
      fonts?.removeEventListener?.('loadingdone', invalidate);
      fonts?.removeEventListener?.('loadingerror', invalidate);
      cache.clear();
    },
  };
}

export function* fontQueries(body, theme) {
  for (const paragraph of body.paragraphs) for (const run of paragraph.runs) {
    for (const text of new Set(graphemes(run.text || ' ').map(g => g.text))) {
      const family = resolveTextFamily({ ...run, text }, theme);
      yield { shorthand: fontShorthand({ ...run, fontFamily: family }, canvasFont), text };
    }
  }
}
export function fontsReady(body, theme, fonts, checked, fontAvailability) {
  for (const { shorthand, text } of fontQueries(body, theme)) {
    const key = JSON.stringify([shorthand, text]);
    if (!checked.has(key)) {
      const ready = fontAvailability
        ? fontAvailability.isAvailable(shorthand, text)
        : fonts.check(shorthand, text);
      if (!ready) return false;
      checked.add(key);
    }
  }
  return true;
}

export function collectFontQueries(bodies) {
  const queries = new Map();
  for (const { body, theme } of bodies) for (const { shorthand, text } of fontQueries(body, theme)) {
    if (!queries.has(shorthand)) queries.set(shorthand, new Set());
    queries.get(shorthand).add(text);
  }
  return queries;
}

function splitFontStack(stack) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < stack.length; i += 1) {
    const ch = stack[i];
    if (quote) {
      if (ch === '\\' && i + 1 < stack.length) {
        cur += stack[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      const trimmed = cur.trim();
      if (trimmed) out.push(trimmed);
      cur = '';
    } else {
      cur += ch;
    }
  }
  const trimmed = cur.trim();
  if (trimmed) out.push(trimmed);
  return out;
}

/** Resolved CSS font-family names (including script slots, theme aliases, and fallbacks) for text bodies. */
export function fontFamiliesFor(bodies) {
  const families = new Set();
  for (const { body, theme } of bodies) for (const paragraph of body.paragraphs) for (const run of paragraph.runs) {
    for (const text of new Set(graphemes(run.text || ' ').map(g => g.text))) {
      const family = resolveTextFamily({ ...run, text }, theme);
      for (const name of splitFontStack(canvasFont(family))) families.add(name);
    }
  }
  return families;
}

export async function waitForBodyFonts(bodies, {fonts,timeoutMs=2000,fontAvailability,canvas}={}) {
  const availability = fontAvailability ?? (canvas ? createFontAvailability({ fonts, canvas }) : null);
  if (!fonts?.load || !fonts?.check) return { status: 'skipped', reason: 'fonts-unavailable' };
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        const queries = collectFontQueries(bodies);
        if (!queries.size) return { status: 'ready' };
        await Promise.all([...queries].map(([shorthand, chars]) => {
          const text = [...chars].join('');
          const missing = availability ? !availability.isAvailable(shorthand, text) : !fonts.check(shorthand, text);
          return missing ? fonts.load(shorthand, text) : undefined;
        }));
        await fonts.ready;
        return fonts.status === 'loaded' && [...queries].every(([shorthand, chars]) => {
          const text = [...chars].join('');
          return availability ? availability.isAvailable(shorthand, text) : fonts.check(shorthand, text);
        })
          ? { status: 'ready' } : { status: 'skipped', reason: 'fonts-unavailable' };
      }),
      new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'skipped', reason: 'fonts-timeout' }), timeoutMs); }),
    ]);
  } catch { return { status: 'failed', reason: 'error', message: 'Font readiness failed.' }; }
  finally { clearTimeout(timer); }
}
