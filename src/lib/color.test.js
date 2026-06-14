import { describe, it, expect } from 'vitest';
import { toHex } from './color.js';

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
