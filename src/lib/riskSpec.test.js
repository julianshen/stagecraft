import { describe, it, expect } from 'vitest';
import { SEVERITY_OKLCH, SEVERITY_HEX, SEVERITIES } from './riskSpec.js';
import { oklchToHex } from '../test/oklchToHex.js';

describe('risk severity palette', () => {
  it('is one keyed palette in two render targets (oklch canvas + hex export), aligned by key', () => {
    expect(SEVERITIES).toEqual(['high', 'med', 'low']);
    SEVERITIES.forEach((s) => {
      expect(SEVERITY_OKLCH[s]).toMatch(/^oklch\(/);
      expect(SEVERITY_HEX[s]).toMatch(/^[0-9A-F]{6}$/i);
    });
    // Both carry a matching fallback for an unknown severity.
    expect(SEVERITY_OKLCH.fallback).toBe('#aaa');
    expect(SEVERITY_HEX.fallback).toBe('AAAAAA');
    expect(Object.isFrozen(SEVERITY_OKLCH)).toBe(true);
    expect(Object.isFrozen(SEVERITY_HEX)).toBe(true);
    expect(Object.isFrozen(SEVERITIES)).toBe(true);
  });

  it('keeps each hex the exact sRGB of its oklch sibling, so the two cannot drift', () => {
    // Iterate the map's own keys (not the hand-maintained SEVERITIES) so adding a
    // severity to the maps is parity-checked automatically. `fallback` is grey,
    // not an oklch/hex sibling pair, so it's excluded.
    Object.keys(SEVERITY_OKLCH)
      .filter((k) => k !== 'fallback')
      .forEach((s) => expect(SEVERITY_HEX[s]).toBe(oklchToHex(SEVERITY_OKLCH[s])));
  });
});
