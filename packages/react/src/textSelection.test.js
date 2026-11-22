import { describe, expect, it } from 'vitest';
import { canonicalRangeCodePointSpan, mapDisplaySelectionToCanonicalRange, utf16ToCodePointOffset } from './textSelection.js';

const para = (id, ...texts) => ({ id, runs: texts.map((text, i) => ({ id: `${id}r${i}`, text })) });

describe('utf16ToCodePointOffset', () => {
  it('counts a surrogate pair as one code point and clamps to the string', () => {
    expect(utf16ToCodePointOffset('a😀b', 3)).toBe(2);
    expect(utf16ToCodePointOffset('ab', 10)).toBe(2);
  });
});

describe('mapDisplaySelectionToCanonicalRange', () => {
  it('maps a selection after CRLF back to the canonical code-point offset', () => {
    // Canonical "A\r\nB" displays as "A\nB"; selecting B is display [2,3).
    expect(mapDisplaySelectionToCanonicalRange([para('p', 'A\r\nB')], 2, 3)).toEqual({
      start: { paragraphId: 'p', runId: 'pr0', offset: 3 },
      end: { paragraphId: 'p', runId: 'pr0', offset: 4 },
    });
  });

  it('treats a CR at a paragraph end plus the synthetic separator as one displayed newline', () => {
    expect(mapDisplaySelectionToCanonicalRange([para('a', 'A\r'), para('b', 'B')], 2, 3)).toEqual({
      start: { paragraphId: 'b', runId: 'br0', offset: 0 },
      end: { paragraphId: 'b', runId: 'br0', offset: 1 },
    });
  });

  it('maps select-all over a trailing empty paragraph to the visible text', () => {
    expect(mapDisplaySelectionToCanonicalRange([para('a', 'A'), para('b', '')], 0, 2)).toEqual({
      start: { paragraphId: 'a', runId: 'ar0', offset: 0 },
      end: { paragraphId: 'a', runId: 'ar0', offset: 1 },
    });
  });

  it('returns null for collapsed, separator-only or mid-surrogate selections', () => {
    const paragraphs = [para('a', 'A😀'), para('b', 'B')];
    expect(mapDisplaySelectionToCanonicalRange(paragraphs, 1, 1)).toBeNull();
    expect(mapDisplaySelectionToCanonicalRange(paragraphs, 3, 4)).toBeNull();
    expect(mapDisplaySelectionToCanonicalRange(paragraphs, 2, 3)).toBeNull();
    expect(mapDisplaySelectionToCanonicalRange([], 0, 1)).toBeNull();
  });
});

describe('canonicalRangeCodePointSpan', () => {
  it('computes canonical code-point offsets including CR and surrogate pairs', () => {
    const paragraphs = [para('a', 'A\r\nB'), para('b', '😀C')];
    expect(canonicalRangeCodePointSpan(paragraphs, {
      start: { paragraphId: 'a', runId: 'ar0', offset: 3 },
      end: { paragraphId: 'b', runId: 'br0', offset: 1 },
    })).toEqual({ startCp: 3, endCp: 6 });
  });
});
