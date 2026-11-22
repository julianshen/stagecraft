/**
 * Pure mapping between a <textarea>'s displayed selection and canonical text positions.
 *
 * A textarea normalizes CRLF and lone CR to LF across its whole value, and paragraphs are
 * joined with a synthetic LF. Canonical run offsets are Unicode code points into the
 * original run text, which is never rewritten.
 */

export function utf16ToCodePointOffset(str, utf16Index) {
  let cp = 0;
  let i = 0;
  const limit = Math.min(utf16Index, str.length);
  while (i < limit) {
    const code = str.codePointAt(i);
    i += code > 0xffff ? 2 : 1;
    cp += 1;
  }
  return cp;
}

export function mapDisplaySelectionToCanonicalRange(paragraphs, startUtf16, endUtf16) {
  if (!Array.isArray(paragraphs) || !paragraphs.length || startUtf16 >= endUtf16) return null;

  const items = [];
  for (let pIdx = 0; pIdx < paragraphs.length; pIdx += 1) {
    const p = paragraphs[pIdx];
    const runs = p.runs ?? [];
    for (let rIdx = 0; rIdx < runs.length; rIdx += 1) {
      const r = runs[rIdx];
      const text = r.text ?? '';
      let cpOffset = 0;
      for (let i = 0; i < text.length; ) {
        const code = text.codePointAt(i);
        const utf16Len = code > 0xffff ? 2 : 1;
        items.push({
          kind: 'cp',
          cp: code,
          pIdx,
          rIdx,
          offset: cpOffset,
          nextOffset: cpOffset + 1,
          pos: { paragraphId: p.id, runId: r.id, offset: cpOffset },
          nextPos: { paragraphId: p.id, runId: r.id, offset: cpOffset + 1 },
        });
        i += utf16Len;
        cpOffset += 1;
      }
    }
    if (pIdx < paragraphs.length - 1) {
      items.push({ kind: 'sep', cp: 0x0a, pIdx });
    }
  }

  let displayCursor = 0;
  const validBoundary = { 0: true };
  const directStart = {};
  const directEnd = {};

  for (let idx = 0; idx < items.length; idx += 1) {
    const cur = items[idx];
    const next = items[idx + 1];
    const isCrlf = cur.kind === 'cp' && cur.cp === 0x0d && next?.cp === 0x0a;
    const dStart = displayCursor;
    const dLen = isCrlf ? 1 : (cur.cp > 0xffff ? 2 : 1);
    const dEnd = dStart + dLen;

    validBoundary[dStart] = true;
    validBoundary[dEnd] = true;

    if (cur.kind === 'cp') {
      directStart[dStart] = { pIdx: cur.pIdx, rIdx: cur.rIdx, offset: cur.offset, pos: cur.pos };
      if (isCrlf && next.kind === 'cp') {
        directEnd[dEnd] = { pIdx: next.pIdx, rIdx: next.rIdx, offset: next.nextOffset, pos: next.nextPos };
      } else {
        directEnd[dEnd] = { pIdx: cur.pIdx, rIdx: cur.rIdx, offset: cur.nextOffset, pos: cur.nextPos };
      }
    }

    displayCursor = dEnd;
    if (isCrlf) idx += 1;
  }

  if (!validBoundary[startUtf16] || !validBoundary[endUtf16]) return null;

  let start = directStart[startUtf16];
  if (!start) {
    for (let d = startUtf16 + 1; d <= displayCursor; d += 1) {
      if (directStart[d]) { start = directStart[d]; break; }
    }
  }

  let end = directEnd[endUtf16];
  if (!end) {
    for (let d = endUtf16 - 1; d >= 0; d -= 1) {
      if (directEnd[d]) { end = directEnd[d]; break; }
    }
  }

  if (!start || !end) return null;
  const order = start.pIdx !== end.pIdx
    ? start.pIdx - end.pIdx
    : start.rIdx !== end.rIdx
      ? start.rIdx - end.rIdx
      : start.offset - end.offset;
  if (order >= 0) return null;
  return { start: start.pos, end: end.pos };
}
