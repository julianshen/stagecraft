import { describe, it, expect } from 'vitest';
import { flattenDeck, moveSlide, duplicateSlide } from './deckOrder.js';

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

  it('handles a target section that has no slides array', () => {
    const d = { sections: [{ id: 's1', name: 'A', slides: ['a'] }, { id: 's2', name: 'B' }], slides: [{ id: 'a' }] };
    const r = moveSlide(d, 'a', 's2', 0);
    expect(r.sections[0].slides).toEqual([]);
    expect(r.sections[1].slides).toEqual(['a']);
  });

  it('does not mutate the input deck', () => {
    const d = deck();
    moveSlide(d, 'a', 's2', 0);
    expect(d.sections[0].slides).toEqual(['a', 'b', 'c']);
    expect(d.sections[1].slides).toEqual(['d', 'e']);
  });
});

describe('duplicateSlide', () => {
  const deck = () => ({
    sections: [
      { id: 's1', name: 'Intro', slides: ['a', 'b'] },
      { id: 's2', name: 'End', slides: ['c'] },
    ],
    slides: [
      { id: 'a', layout: 'cover', title: 'A' },
      { id: 'b', layout: 'text', title: 'B', elements: [{ id: 'e1', type: 'text', content: 'hi' }] },
      { id: 'c', layout: 'thanks' },
    ],
  });
  const order = (d) => flattenDeck(d).map((s) => s.id);

  it('inserts a clone right after the original in its section', () => {
    const { deck: r, newId } = duplicateSlide(deck(), 'a');
    expect(r.sections[0].slides).toEqual(['a', newId, 'b']);
    expect(order(r)).toEqual(['a', newId, 'b', 'c']);
    expect(r.slides.find((s) => s.id === newId).title).toBe('A'); // same content
  });

  it('gives the clone (and its elements) fresh ids', () => {
    const { deck: r, newId } = duplicateSlide(deck(), 'b');
    expect(newId).not.toBe('b');
    const clone = r.slides.find((s) => s.id === newId);
    expect(clone.elements[0].id).not.toBe('e1'); // element ids re-issued
    expect(clone.elements[0].content).toBe('hi'); // content preserved
  });

  it('deep-clones so editing the copy does not touch the original', () => {
    const { deck: r, newId } = duplicateSlide(deck(), 'b');
    const clone = r.slides.find((s) => s.id === newId);
    clone.elements[0].content = 'changed';
    const orig = r.slides.find((s) => s.id === 'b');
    expect(orig.elements[0].content).toBe('hi');
  });

  it('uses a caller-supplied newId (so the caller can select the copy)', () => {
    const { deck: r, newId } = duplicateSlide(deck(), 'a', 'my-copy');
    expect(newId).toBe('my-copy');
    expect(r.sections[0].slides).toEqual(['a', 'my-copy', 'b']);
    expect(r.slides.find((s) => s.id === 'my-copy').title).toBe('A');
  });

  it('returns null for an unknown slide or a malformed deck', () => {
    expect(duplicateSlide(deck(), 'zzz')).toBeNull();
    expect(duplicateSlide(null, 'a')).toBeNull();
  });

  it('does not mutate the input deck', () => {
    const d = deck();
    duplicateSlide(d, 'a');
    expect(d.slides).toHaveLength(3);
    expect(d.sections[0].slides).toEqual(['a', 'b']);
  });
});
