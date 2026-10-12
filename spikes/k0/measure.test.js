// How many measurer calls one text box costs, and what a memoised measurer saves.
import { it } from 'vitest';
import { deck } from './deck.js';
import { resolveFont, ms } from './paint.js';
import { layoutTextBody } from '../../src/vendor/officeview/drawing/text-layout';
import { createTextBodyMeasurer } from '../../src/vendor/officeview/drawing/text-paint';

it('counts measurer calls per text box', () => {
  const ctx = document.createElement('canvas').getContext('2d');
  const raw = createTextBodyMeasurer(ctx, resolveFont);
  let calls = 0;
  const counted = (t, s) => { calls++; return raw(t, s); };
  const memo = new Map();
  const memoised = (t, s) => {
    const k = `${s.fontSizePt}|${s.bold}|${s.italic}|${t}`;
    if (!memo.has(k)) memo.set(k, raw(t, s));
    return memo.get(k);
  };
  const boxes = deck.flatMap((s) => s.filter((n) => n.kind === 'text'));
  const time = (m) => ms(() => boxes.forEach((n) => layoutTextBody(n.body, n.w, n.h, m)));
  const rawMs = time(counted);
  const memoMs = time(memoised); // cold memo, shared across all 320 boxes
  const chars = boxes.reduce((a, n) => a + n.body.paragraphs.reduce((b, p) => b + p.runs.reduce((c, r) => c + r.text.length, 0), 0), 0);
  console.log(`K0_MEASURE ${JSON.stringify({ boxes: boxes.length, charsPerBox: Math.round(chars / boxes.length), callsPerBox: Math.round(calls / boxes.length), msPerBoxRaw: +(rawMs / boxes.length).toFixed(2), msPerBoxMemo: +(memoMs / boxes.length).toFixed(2), memoEntries: memo.size })}`);
});
