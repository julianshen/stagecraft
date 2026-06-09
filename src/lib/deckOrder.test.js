import { describe, it, expect } from 'vitest';
import { flattenDeck, moveSlide } from './deckOrder.js';

describe('flattenDeck', () => {
  const deck = {
    sections: [
      { id: 's1', name: 'Intro', slides: ['a', 'b'] },
      { id: 's2', name: 'End', slides: ['c'] },
    ],
    slides: [
      { id: 'c', layout: 'thanks' },
      { id: 'a', layout: 'cover' },
      { id: 'b', layout: 'text' },
    ],
  };

  it('orders slides by section membership, not pool order', () => {
    expect(flattenDeck(deck).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('annotates each slide with its section id and name', () => {
    const [first] = flattenDeck(deck);
    expect(first).toMatchObject({ id: 'a', sectionId: 's1', sectionName: 'Intro' });
  });

  it('omits slide ids that have no matching slide in the pool', () => {
    const d = { sections: [{ id: 's1', name: 'X', slides: ['a', 'ghost'] }], slides: [{ id: 'a' }] };
    expect(flattenDeck(d).map((s) => s.id)).toEqual(['a']);
  });

  it('tolerates a section with no slides array', () => {
    const d = { sections: [{ id: 's1', name: 'X' }], slides: [{ id: 'a' }] };
    expect(flattenDeck(d)).toEqual([]);
  });

  it('returns [] for malformed or empty decks', () => {
    expect(flattenDeck(null)).toEqual([]);
    expect(flattenDeck({})).toEqual([]);
    expect(flattenDeck({ sections: [], slides: [] })).toEqual([]);
  });
});

describe('moveSlide', () => {
  const deck = () => ({
    sections: [
      { id: 's1', name: 'Intro', slides: ['a', 'b', 'c'] },
      { id: 's2', name: 'End', slides: ['d', 'e'] },
    ],
    slides: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
  });
  const order = (d) => flattenDeck(d).map((s) => s.id);

  it('reorders within a section', () => {
    const r = moveSlide(deck(), 'c', 's1', 0); // c to the front of Intro
    expect(r.sections[0].slides).toEqual(['c', 'a', 'b']);
    expect(order(r)).toEqual(['c', 'a', 'b', 'd', 'e']);
  });

  it('moves a slide across sections at a given index', () => {
    const r = moveSlide(deck(), 'a', 's2', 1); // a → End, between d and e
    expect(r.sections[0].slides).toEqual(['b', 'c']);
    expect(r.sections[1].slides).toEqual(['d', 'a', 'e']);
    expect(order(r)).toEqual(['b', 'c', 'd', 'a', 'e']);
  });

  it('clamps an out-of-range target index to the section end', () => {
    const r = moveSlide(deck(), 'a', 's2', 99);
    expect(r.sections[1].slides).toEqual(['d', 'e', 'a']);
  });

  it('is a no-op for an unknown slide or unknown section', () => {
    const d = deck();
    expect(moveSlide(d, 'zzz', 's1', 0)).toBe(d);
    expect(moveSlide(d, 'a', 'nope', 0)).toBe(d);
  });

  it('does not mutate the input deck', () => {
    const d = deck();
    moveSlide(d, 'a', 's2', 0);
    expect(d.sections[0].slides).toEqual(['a', 'b', 'c']);
    expect(d.sections[1].slides).toEqual(['d', 'e']);
  });
});
