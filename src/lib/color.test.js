import { describe, it, expect } from 'vitest';
import { toHex, isHexColor, mixHex } from './color.js';

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

describe('mixHex', () => {
  it('averages the two colours channel-by-channel', () => {
    expect(mixHex('#000000', '#ffffff')).toBe('#808080'); // round(255/2)=128
    expect(mixHex('#4f46e5', '#06b6d4')).toBe('#2b7edd');  // (79,70,229)+(6,182,212) → (43,126,221)
  });
  it('is symmetric', () => {
    expect(mixHex('#112233', '#445566')).toBe(mixHex('#445566', '#112233'));
  });
  it('expands shorthand first, returns the same colour for equal inputs', () => {
    expect(mixHex('#000', '#fff')).toBe('#808080');
    expect(mixHex('#123456', '#123456')).toBe('#123456');
  });
  it('falls back via toHex for a non-hex input (no NaN channels)', () => {
    expect(mixHex('red', '#000000')).toBe('#282373'); // toHex('red')=#4f46e5 → (40,35,115)
  });
});
