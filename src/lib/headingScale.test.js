import { describe, it, expect } from 'vitest';
import { HEADING_SCALES, HEADING_SCALE_RANGE, resolveHeadingScale, headingPx } from './headingScale.js';
import { CANVAS_BASELINE_PX } from './fontBaselines.js';

describe('resolveHeadingScale', () => {
  it('defaults to 1 when the deck has no headingScale', () => {
    expect(resolveHeadingScale({})).toBe(1);
    expect(resolveHeadingScale(undefined)).toBe(1);
  });

  it('returns a valid in-range headingScale unchanged', () => {
    expect(resolveHeadingScale({ headingScale: 1.15 })).toBe(1.15);
    expect(resolveHeadingScale({ headingScale: HEADING_SCALE_RANGE.min })).toBe(HEADING_SCALE_RANGE.min);
    expect(resolveHeadingScale({ headingScale: HEADING_SCALE_RANGE.max })).toBe(HEADING_SCALE_RANGE.max);
  });

  it('clamps an out-of-range scale into the allowed range (defends gate-bypassing writes)', () => {
    expect(resolveHeadingScale({ headingScale: 99 })).toBe(HEADING_SCALE_RANGE.max);
    expect(resolveHeadingScale({ headingScale: 0.01 })).toBe(HEADING_SCALE_RANGE.min);
  });

  it('falls back to the default for a non-finite / non-numeric scale', () => {
    expect(resolveHeadingScale({ headingScale: NaN })).toBe(HEADING_SCALE_RANGE.default);
    expect(resolveHeadingScale({ headingScale: Infinity })).toBe(HEADING_SCALE_RANGE.default);
    expect(resolveHeadingScale({ headingScale: '1.2' })).toBe(HEADING_SCALE_RANGE.default);
  });

  it('exposes presets whose values all sit within the allowed range, including the default 1', () => {
    expect(HEADING_SCALES.some((p) => p.value === 1)).toBe(true);
    for (const p of HEADING_SCALES) {
      expect(typeof p.label).toBe('string');
      expect(p.value).toBeGreaterThanOrEqual(HEADING_SCALE_RANGE.min);
      expect(p.value).toBeLessThanOrEqual(HEADING_SCALE_RANGE.max);
    }
  });
});

describe('HEADING_SCALES / HEADING_SCALE_RANGE immutability', () => {
  it('are frozen (like the other shared constant tables) so no consumer can mutate them', () => {
    expect(Object.isFrozen(HEADING_SCALES)).toBe(true);
    expect(Object.isFrozen(HEADING_SCALE_RANGE)).toBe(true);
    HEADING_SCALES.forEach((s) => expect(Object.isFrozen(s)).toBe(true));
  });
});

describe('headingPx', () => {
  it('returns the layout title baseline scaled by the deck heading scale, rounded', () => {
    expect(headingPx('agenda', { headingScale: 1.5 })).toBe(Math.round(CANVAS_BASELINE_PX.agenda.title * 1.5)); // 144
    expect(headingPx('cover', { headingScale: 0.85 })).toBe(Math.round(CANVAS_BASELINE_PX.cover.title * 0.85)); // 119
  });

  it('returns the bare baseline when the deck has no heading scale', () => {
    expect(headingPx('text', {})).toBe(CANVAS_BASELINE_PX.text.title); // 84
  });

  it('falls back to 72 for an unknown layout', () => {
    expect(headingPx('mystery', {})).toBe(72);
  });

  it('clamps a malformed heading scale via resolveHeadingScale', () => {
    expect(headingPx('cover', { headingScale: 99 })).toBe(Math.round(CANVAS_BASELINE_PX.cover.title * HEADING_SCALE_RANGE.max));
  });
});
