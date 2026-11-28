import { collectFontQueries, createFontAvailability } from '../text/fontReadiness.js';

export async function waitForCanonicalFonts(scene, { fonts = globalThis.document?.fonts, timeoutMs = 2000, fontAvailability, canvas } = {}) {
  const bodies = (scene?.nodes ?? []).flatMap(node => node.paint?.text ? [{
    body: node.paint.text.body ?? node.paint.text,
    theme: node.paint.text.theme,
    native: node.paint.native === true,
  }] : []);
  const queries = [];
  const seen = new Set();
  for (const native of [true, false]) {
    for (const [shorthand, chars] of collectFontQueries(bodies.filter(body => body.native === native))) {
      const text = [...chars].join('');
      const key = JSON.stringify([native, shorthand]);
      if (!seen.has(key)) {
        seen.add(key);
        queries.push({ shorthand, text, native });
      }
    }
  }
  if (!queries.length) return { status: 'ready' };
  if (typeof fonts?.check !== 'function' || typeof fonts?.load !== 'function') return { status: 'skipped', reason: 'fonts-unavailable' };
  let timer;
  let createdAvailability = null;
  try {
    const nativeQueries = queries.filter(query => query.native);
    const availability = nativeQueries.length
      ? fontAvailability ?? (createdAvailability = createFontAvailability({ fonts, canvas: canvas ?? globalThis.document?.createElement?.('canvas') }))
      : null;
    const missing = queries.filter(query => availability && query.native
      ? !availability.isAvailable(query.shorthand, query.text)
      : !fonts.check(query.shorthand, query.text));
    const loads = missing.map(query => Promise.resolve().then(() => fonts.load(query.shorthand, query.text)));
    const timeout = await Promise.race([
      Promise.allSettled(loads).then(() => false),
      new Promise(resolve => { timer = setTimeout(() => resolve(true), timeoutMs); }),
    ]);
    availability?.invalidate?.();
    const ready = queries.every(query => availability && query.native
      ? availability.isAvailable(query.shorthand, query.text)
      : fonts.check(query.shorthand, query.text));
    return ready ? { status: 'ready' } : { status: 'skipped', reason: timeout ? 'fonts-timeout' : 'fonts-unavailable' };
  } catch {
    return { status: 'failed', reason: 'error', message: 'Canvas font readiness failed.' };
  } finally {
    clearTimeout(timer);
    createdAvailability?.dispose?.();
  }
}
