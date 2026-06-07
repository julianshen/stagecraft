import { describe, it, expect } from 'vitest';
import { getFlatSlideIds } from './deckUtils.js';

describe('getFlatSlideIds', () => {
  it('returns [] for a null or undefined deck instead of throwing', () => {
    expect(getFlatSlideIds(null)).toEqual([]);
    expect(getFlatSlideIds(undefined)).toEqual([]);
  });

  it('flattens section slide ids in section order', () => {
    const deck = { sections: [{ slides: ['a', 'b'] }, { slides: ['c'] }] };
    expect(getFlatSlideIds(deck)).toEqual(['a', 'b', 'c']);
  });

  it('tolerates a deck with no sections', () => {
    expect(getFlatSlideIds({})).toEqual([]);
  });

  it('skips null section entries and sections without a slides array', () => {
    const deck = { sections: [null, { name: 'x' }, { slides: ['z'] }] };
    expect(getFlatSlideIds(deck)).toEqual(['z']);
  });
});
