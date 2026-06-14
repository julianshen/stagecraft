import { describe, it, expect } from 'vitest';
import { fmtKey, fmtStyle } from './slideFmt.js';

describe('fmtKey', () => {
  it('joins a single-segment path', () => {
    expect(fmtKey(['title'])).toBe('title');
  });
  it('joins a nested path with dots', () => {
    expect(fmtKey(['items', 2, 't'])).toBe('items.2.t');
  });
});

describe('fmtStyle', () => {
  it('returns an empty object for no formatting', () => {
    expect(fmtStyle(undefined)).toEqual({});
    expect(fmtStyle({})).toEqual({});
  });
  it('maps bold to fontWeight 700, and omits it when false', () => {
    expect(fmtStyle({ bold: true })).toEqual({ fontWeight: 700 });
    expect(fmtStyle({ bold: false })).toEqual({}); // false ⇒ no override, keep template baseline
  });
  it('maps italic and underline only when set', () => {
    expect(fmtStyle({ italic: true })).toEqual({ fontStyle: 'italic' });
    expect(fmtStyle({ underline: true })).toEqual({ textDecoration: 'underline' });
  });
  it('passes fontSize and color through', () => {
    expect(fmtStyle({ fontSize: 64 })).toEqual({ fontSize: 64 });
    expect(fmtStyle({ color: '#ff0000' })).toEqual({ color: '#ff0000' });
  });
  it('merges every set property', () => {
    expect(fmtStyle({ bold: true, italic: true, underline: true, fontSize: 32, color: '#08f' }))
      .toEqual({ fontWeight: 700, fontStyle: 'italic', textDecoration: 'underline', fontSize: 32, color: '#08f' });
  });
});
