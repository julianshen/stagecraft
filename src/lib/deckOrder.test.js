import { describe, it, expect } from 'vitest';
import { flattenDeck, moveSlide, duplicateSlide, addSection, renameSection, deleteSection, applySlideOrder, appendSlide } from './deckOrder.js';

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

  it('returns null for a null/undefined slide id (no selection to duplicate)', () => {
    // The Editor's duplicate handler relies on this: when nothing valid is
    // selected the op no-ops, so the caller must not select a phantom id.
    expect(duplicateSlide(deck(), null)).toBeNull();
    expect(duplicateSlide(deck(), undefined)).toBeNull();
  });

  it('does not mutate the input deck', () => {
    const d = deck();
    duplicateSlide(d, 'a');
    expect(d.slides).toHaveLength(3);
    expect(d.sections[0].slides).toEqual(['a', 'b']);
  });
});

describe('addSection', () => {
  const deck = () => ({
    sections: [{ id: 's1', name: 'Intro', slides: ['a'] }],
    slides: [{ id: 'a' }],
  });

  it('appends a new empty section and returns its id', () => {
    const { deck: r, sectionId } = addSection(deck(), 'Appendix');
    expect(r.sections).toHaveLength(2);
    const added = r.sections[1];
    expect(added.id).toBe(sectionId);
    expect(added.name).toBe('Appendix');
    expect(added.slides).toEqual([]);
  });

  it('defaults to a sensible name when none/blank is given', () => {
    expect(addSection(deck()).deck.sections[1].name).toBe('New section');
    expect(addSection(deck(), '   ').deck.sections[1].name).toBe('New section');
  });

  it('gives each new section a unique id', () => {
    const { sectionId: a } = addSection(deck(), 'A');
    const { sectionId: b } = addSection(deck(), 'B');
    expect(a).not.toBe(b);
  });

  it('returns null for a malformed deck', () => {
    expect(addSection(null, 'X')).toBeNull();
    expect(addSection({}, 'X')).toBeNull();
  });

  it('does not mutate the input deck', () => {
    const d = deck();
    addSection(d, 'X');
    expect(d.sections).toHaveLength(1);
  });
});

describe('renameSection', () => {
  const deck = () => ({
    sections: [{ id: 's1', name: 'Intro', slides: ['a'] }, { id: 's2', name: 'End', slides: [] }],
    slides: [{ id: 'a' }],
  });

  it('renames the matching section (trimming whitespace)', () => {
    const r = renameSection(deck(), 's2', '  Outro  ');
    expect(r.sections[1].name).toBe('Outro');
    expect(r.sections[0].name).toBe('Intro'); // others untouched
  });

  it('is a no-op for an unknown section', () => {
    const d = deck();
    expect(renameSection(d, 'nope', 'X')).toBe(d);
  });

  it('is a no-op for a blank name (keeps the old name)', () => {
    const d = deck();
    expect(renameSection(d, 's1', '   ')).toBe(d);
    expect(renameSection(d, 's1', '')).toBe(d);
  });

  it('is a no-op when the (trimmed) name is unchanged — returns the same ref, no wasted update', () => {
    const d = deck();
    expect(renameSection(d, 's1', 'Intro')).toBe(d);   // identical
    expect(renameSection(d, 's1', '  Intro  ')).toBe(d); // trims to the same
  });

  it('is a no-op for a malformed deck', () => {
    expect(renameSection(null, 's1', 'X')).toBeNull();
  });

  it('does not mutate the input deck', () => {
    const d = deck();
    renameSection(d, 's1', 'Changed');
    expect(d.sections[0].name).toBe('Intro');
  });
});

describe('deleteSection', () => {
  const deck = () => ({
    sections: [
      { id: 's1', name: 'A', slides: ['a', 'b'] },
      { id: 's2', name: 'B', slides: ['c', 'd'] },
      { id: 's3', name: 'C', slides: ['e'] },
    ],
    slides: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
  });
  const order = (d) => flattenDeck(d).map((s) => s.id);

  it('merges a middle section into the previous one, preserving slide order', () => {
    const r = deleteSection(deck(), 's2'); // B's slides → end of A
    expect(r.sections.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(r.sections[0].slides).toEqual(['a', 'b', 'c', 'd']);
    expect(order(r)).toEqual(['a', 'b', 'c', 'd', 'e']); // unchanged
  });

  it('merges the first section into the next one, preserving slide order', () => {
    const r = deleteSection(deck(), 's1'); // A's slides → front of B
    expect(r.sections.map((s) => s.id)).toEqual(['s2', 's3']);
    expect(r.sections[0].slides).toEqual(['a', 'b', 'c', 'd']);
    expect(order(r)).toEqual(['a', 'b', 'c', 'd', 'e']); // unchanged
  });

  it('keeps the slide pool intact (non-destructive)', () => {
    const r = deleteSection(deck(), 's2');
    expect(r.slides.map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('refuses to delete the only remaining section', () => {
    const d = { sections: [{ id: 's1', name: 'A', slides: ['a'] }], slides: [{ id: 'a' }] };
    expect(deleteSection(d, 's1')).toBe(d);
  });

  it('is a no-op for an unknown section or malformed deck', () => {
    const d = deck();
    expect(deleteSection(d, 'nope')).toBe(d);
    expect(deleteSection(null, 's1')).toBeNull();
  });

  it('does not mutate the input deck', () => {
    const d = deck();
    deleteSection(d, 's2');
    expect(d.sections).toHaveLength(3);
    expect(d.sections[0].slides).toEqual(['a', 'b']);
  });
});

describe('applySlideOrder', () => {
  const deck = () => ({
    sections: [
      { id: 's1', name: 'Intro', slides: ['a', 'b'] },
      { id: 's2', name: 'Body', slides: ['c', 'd', 'e'] },
    ],
    slides: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
  });
  const order = (d) => flattenDeck(d).map((s) => s.id);

  it('applies a full permutation, preserving each section\'s slide count', () => {
    const r = applySlideOrder(deck(), ['e', 'c', 'a', 'd', 'b']);
    expect(r.sections[0].slides).toEqual(['e', 'c']);          // Intro keeps 2
    expect(r.sections[1].slides).toEqual(['a', 'd', 'b']);     // Body keeps 3
    expect(order(r)).toEqual(['e', 'c', 'a', 'd', 'b']);
  });

  it('drops unknown ids and appends missing ones in their current order (no slide lost)', () => {
    const r = applySlideOrder(deck(), ['d', 'ghost', 'a']); // partial + hallucinated id
    expect(order(r)).toEqual(['d', 'a', 'b', 'c', 'e']);    // d,a first; b,c,e keep relative order
    expect(order(r)).toHaveLength(5);
  });

  it('ignores duplicate ids in the proposed order', () => {
    const r = applySlideOrder(deck(), ['b', 'b', 'a', 'a', 'c', 'd', 'e']);
    expect(order(r)).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('is a no-op (same ref) for a malformed deck or a non-array order', () => {
    const d = deck();
    expect(applySlideOrder(d, null)).toBe(d);
    expect(applySlideOrder(d, 'abc')).toBe(d);
    expect(applySlideOrder(null, ['a'])).toBeNull();
  });

  it('is a no-op (same ref) when the proposed order equals the current order', () => {
    const d = deck();
    expect(applySlideOrder(d, ['a', 'b', 'c', 'd', 'e'])).toBe(d);
  });

  it('normalizes a malformed deck whose slide id is referenced by two sections', () => {
    // 'a' is double-referenced — flat has a duplicate, so the current order must
    // NOT prefix-match into a false no-op; it should rebuild + drop the stray.
    const d = {
      sections: [{ id: 's1', name: 'A', slides: ['a', 'b'] }, { id: 's2', name: 'B', slides: ['c', 'a'] }],
      slides: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    };
    const r = applySlideOrder(d, ['a', 'b', 'c']);
    expect(r).not.toBe(d);                          // not a false no-op
    expect(order(r)).toEqual(['a', 'b', 'c']);       // each slide once, no duplicate
  });

  it('does not mutate the input deck', () => {
    const d = deck();
    applySlideOrder(d, ['e', 'd', 'c', 'b', 'a']);
    expect(d.sections[0].slides).toEqual(['a', 'b']);
    expect(d.sections[1].slides).toEqual(['c', 'd', 'e']);
  });
});

describe('appendSlide', () => {
  const deckWith = (lastSectionSlides, slides) => ({
    title: 'D',
    sections: [
      { id: 's1', name: 'A', slides: ['a'] },
      { id: 's2', name: 'B', slides: lastSectionSlides },
    ],
    slides,
  });

  it('appends to the pool and the last section', () => {
    const d = deckWith(['b'], [{ id: 'a', layout: 'cover' }, { id: 'b', layout: 'text' }]);
    const r = appendSlide(d, { id: 'n', layout: 'table' });
    expect(r.slides.map((s) => s.id)).toEqual(['a', 'b', 'n']);
    expect(r.sections[1].slides).toEqual(['b', 'n']);
  });

  it('keeps a closing thanks slide last — new slides insert just before it', () => {
    const d = deckWith(['b', 'z'], [{ id: 'a', layout: 'cover' }, { id: 'b', layout: 'text' }, { id: 'z', layout: 'thanks' }]);
    const r = appendSlide(d, { id: 'n', layout: 'table' });
    expect(r.sections[1].slides).toEqual(['b', 'n', 'z']);
    expect(r.slides.map((s) => s.id)).toEqual(['a', 'b', 'z', 'n']); // pool order is irrelevant to render order
  });

  it('appends normally when the last slide is not a thanks, and into an empty last section', () => {
    const d = deckWith([], [{ id: 'a', layout: 'cover' }]);
    const r = appendSlide(d, { id: 'n', layout: 'text' });
    expect(r.sections[1].slides).toEqual(['n']);
  });

  it('does not mutate the input deck', () => {
    const d = deckWith(['b', 'z'], [{ id: 'a', layout: 'cover' }, { id: 'b', layout: 'text' }, { id: 'z', layout: 'thanks' }]);
    appendSlide(d, { id: 'n', layout: 'table' });
    expect(d.sections[1].slides).toEqual(['b', 'z']);
    expect(d.slides).toHaveLength(3);
  });
});

describe('appendSlide guards', () => {
  it('returns malformed decks unchanged (nullish or missing sections), like its siblings', () => {
    expect(appendSlide(null, { id: 'n' })).toBeNull();
    expect(appendSlide(undefined, { id: 'n' })).toBeUndefined();
    const noSections = { slides: [] };
    expect(appendSlide(noSections, { id: 'n' })).toBe(noSections);
    const empty = { sections: [], slides: [] };
    expect(appendSlide(empty, { id: 'n' })).toBe(empty); // nowhere to register it — a slide outside sections never renders
  });
});

describe('appendSlide with trailing empty sections', () => {
  it('keys the closer rule off the last RENDERED slide, inserting beside it in its own section', () => {
    const d = {
      sections: [
        { id: 's1', name: 'Main', slides: ['a', 'z'] },
        { id: 's2', name: 'New section', slides: [] }, // added in Sorter after the closer
      ],
      slides: [{ id: 'a', layout: 'text' }, { id: 'z', layout: 'thanks' }],
    };
    const r = appendSlide(d, { id: 'n', layout: 'table' });
    expect(r.sections[0].slides).toEqual(['a', 'n', 'z']); // before the closer, in the closer's section
    expect(r.sections[1].slides).toEqual([]);
  });

  it('still appends to the last section when the last rendered slide is not a thanks', () => {
    const d = {
      sections: [
        { id: 's1', name: 'A', slides: ['z'] },
        { id: 's2', name: 'B', slides: ['b'] }, // a thanks exists but is not the deck's last rendered slide
      ],
      slides: [{ id: 'z', layout: 'thanks' }, { id: 'b', layout: 'text' }],
    };
    const r = appendSlide(d, { id: 'n', layout: 'table' });
    expect(r.sections[1].slides).toEqual(['b', 'n']);
  });
});
