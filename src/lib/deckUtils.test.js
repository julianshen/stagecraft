import { describe, it, expect } from 'vitest';
import { getFlatSlideIds, reconcileCurId } from './deckUtils.js';

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

describe('reconcileCurId', () => {
  it('keeps the current id when it still exists in the deck', () => {
    expect(reconcileCurId(['a', 'b', 'c'], 'b', null)).toBe('b');
  });

  it('falls back to the first slide when the current id was removed (external edit)', () => {
    expect(reconcileCurId(['a', 'b'], 'zzz', null)).toBe('a');
  });

  it('returns null when the current id is gone and the deck is empty', () => {
    expect(reconcileCurId([], 'x', null)).toBe(null);
  });

  it('leaves a null selection untouched', () => {
    expect(reconcileCurId(['a'], null, null)).toBe(null);
  });

  it('on delete, picks the slide that took the deleted index', () => {
    // deleted 'b' at idx 1; flat is now ['a','c'] → flat[1] = 'c'
    expect(reconcileCurId(['a', 'c'], 'b', { id: 'b', idx: 1 })).toBe('c');
  });

  it('on delete of the last slide, picks the previous index', () => {
    // deleted 'c' at idx 2; flat is now ['a','b'] → flat[2] undefined → flat[1] = 'b'
    expect(reconcileCurId(['a', 'b'], 'c', { id: 'c', idx: 2 })).toBe('b');
  });

  it('ignores a delete hint that does not match the current id', () => {
    expect(reconcileCurId(['a', 'b'], 'a', { id: 'b', idx: 1 })).toBe('a');
  });

  it('on delete with an out-of-range index, falls back to the first slide', () => {
    expect(reconcileCurId(['x'], 'a', { id: 'a', idx: 5 })).toBe('x');
  });

  it('on delete of the only slide, returns null', () => {
    expect(reconcileCurId([], 'a', { id: 'a', idx: 0 })).toBe(null);
  });
});
