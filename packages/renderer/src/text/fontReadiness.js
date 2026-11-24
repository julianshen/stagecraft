import { canvasFont } from '../canvas/paint.js';
import { graphemes } from '../vendor/officeview/core/text-recording.ts';
import { resolveTextFamily } from '../vendor/officeview/drawing/text-layout.ts';
import { fontShorthand } from '../vendor/officeview/drawing/text-paint.ts';
export function* fontQueries(body, theme) {
  for (const paragraph of body.paragraphs) for (const run of paragraph.runs) {
    for (const text of new Set(graphemes(run.text || ' ').map(g => g.text))) {
      const family = resolveTextFamily({ ...run, text }, theme);
      yield { shorthand: fontShorthand({ ...run, fontFamily: family }, canvasFont), text };
    }
  }
}
export function fontsReady(body, theme, fonts, checked) {
  for (const { shorthand, text } of fontQueries(body, theme)) {
    const key = JSON.stringify([shorthand, text]);
    if (!checked.has(key)) {
      if (!fonts.check(shorthand, text)) return false;
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

export async function waitForBodyFonts(bodies, {fonts,timeoutMs=2000}) {
  if (!fonts?.load || !fonts?.check) return { status: 'skipped', reason: 'fonts-unavailable' };
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        const queries = collectFontQueries(bodies);
        if (!queries.size) return { status: 'ready' };
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
