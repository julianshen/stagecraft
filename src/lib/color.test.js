import { describe, it, expect } from 'vitest';
import { toHex, isHexColor } from './color.js';

describe('isHexColor', () => {
  it('accepts #rgb and #rrggbb (any case)', () => {
    expect(isHexColor('#abc')).toBe(true);
    expect(isHexColor('#AABBCC')).toBe(true);
    expect(isHexColor('#1a1a2e')).toBe(true);
  });
  it('rejects CSS names, malformed hex, and non-strings', () => {
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#12')).toBe(false);
    expect(isHexColor('#12345')).toBe(false);
    expect(isHexColor('1a1a2e')).toBe(false); // missing #
    expect(isHexColor(42)).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });
});

describe('toHex', () => {
  it('passes a #rrggbb value through, lowercased', () => {
    expect(toHex('#AB12CD')).toBe('#ab12cd');
  });
  it('expands #rgb shorthand to #rrggbb', () => {
    expect(toHex('#08f')).toBe('#0088ff');
  });
  it('trims surrounding whitespace', () => {
    expect(toHex('  #ffffff  ')).toBe('#ffffff');
  });
  it('falls back to indigo for a non-hex or non-string value', () => {
    expect(toHex('red')).toBe('#4f46e5');
    expect(toHex(undefined)).toBe('#4f46e5');
    expect(toHex('#12')).toBe('#4f46e5');
  });
});
