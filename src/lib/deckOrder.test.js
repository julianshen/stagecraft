import { describe, it, expect } from 'vitest';
import { flattenDeck } from './deckOrder.js';

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
