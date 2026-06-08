import { describe, it, expect } from 'vitest';
import { getFlatSlideIds, reconcileCurId, applySlidePatch, sanitizeSlidePatch } from './deckUtils.js';

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

describe('applySlidePatch', () => {
  const deck = () => ({
    theme: 'indigo',
    sections: [{ id: 's1', name: 'S', slides: ['a', 'b'] }],
    slides: [
      { id: 'a', layout: 'text', title: 'A', body: 'old' },
      { id: 'b', layout: 'kpi', title: 'B' },
    ],
  });

  it('merges the patch into the selected slide', () => {
    const next = applySlidePatch(deck(), 'a', { title: 'New', body: 'fresh' });
    expect(next.slides[0]).toEqual({ id: 'a', layout: 'text', title: 'New', body: 'fresh' });
  });

  it('never lets the patch change the slide id', () => {
    const next = applySlidePatch(deck(), 'a', { id: 'hacked', title: 'X' });
    expect(next.slides[0].id).toBe('a');
    expect(next.slides[0].title).toBe('X');
  });

  it('can change the layout (discriminated union) when the patch says so', () => {
    const next = applySlidePatch(deck(), 'a', { layout: 'list', items: ['one', 'two'] });
    expect(next.slides[0].layout).toBe('list');
    expect(next.slides[0].items).toEqual(['one', 'two']);
  });

  it('drops a layout that is not a supported layout name', () => {
    const next = applySlidePatch(deck(), 'a', { layout: 'bulleted', title: 'New' });
    expect(next.slides[0].layout).toBe('text');   // unsupported layout dropped, original kept
    expect(next.slides[0].title).toBe('New');      // other valid fields still applied
  });

  it('drops object items when the target layout is list', () => {
    const d = deck();
    d.slides[0] = { id: 'a', layout: 'list', items: ['old'] };
    const next = applySlidePatch(d, 'a', { items: [{ text: 'A' }] });
    expect(next.slides[0].items).toEqual(['old']); // object items would render blank; dropped
  });

  it('accepts string items for a list layout', () => {
    const d = deck();
    d.slides[0] = { id: 'a', layout: 'list', items: [] };
    const next = applySlidePatch(d, 'a', { items: ['A', 'B'] });
    expect(next.slides[0].items).toEqual(['A', 'B']);
  });

  it('still accepts object items for an agenda layout', () => {
    const d = deck();
    d.slides[0] = { id: 'a', layout: 'agenda', items: [] };
    const next = applySlidePatch(d, 'a', { items: [{ n: '01', t: 'A', d: 'B' }] });
    expect(next.slides[0].items).toEqual([{ n: '01', t: 'A', d: 'B' }]);
  });

  it('uses the patch layout (switching to list) when validating items', () => {
    const next = applySlidePatch(deck(), 'a', { layout: 'list', items: [{ text: 'A' }] });
    expect(next.slides[0].layout).toBe('list');       // layout switch applied
    expect(next.slides[0].items).toBeUndefined();      // object items rejected for list
  });

  it('drops carried-over collections that don\'t fit a changed layout', () => {
    const d = deck();
    d.slides[0] = { id: 'a', layout: 'agenda', items: [{ n: '01', t: 'A', d: 'B' }] };
    const next = applySlidePatch(d, 'a', { layout: 'list' }); // layout-only edit
    expect(next.slides[0].layout).toBe('list');
    expect(next.slides[0].items).toBeUndefined(); // agenda objects don't fit list → cleared
  });

  it('keeps carried-over collections that still fit the changed layout', () => {
    const d = deck();
    d.slides[0] = { id: 'a', layout: 'agenda', items: [{ n: '01', t: 'A', d: 'B' }] };
    const next = applySlidePatch(d, 'a', { layout: 'risks' }); // both object-backed
    expect(next.slides[0].items).toEqual([{ n: '01', t: 'A', d: 'B' }]);
  });

  it('leaves other slides untouched and returns a new deck object', () => {
    const d = deck();
    const next = applySlidePatch(d, 'a', { title: 'X' });
    expect(next).not.toBe(d);
    expect(next.slides[1]).toEqual({ id: 'b', layout: 'kpi', title: 'B' });
  });

  it('is a no-op for a null deck, missing id, or empty patch', () => {
    expect(applySlidePatch(null, 'a', { title: 'X' })).toBe(null);
    const d = deck();
    expect(applySlidePatch(d, 'nope', { title: 'X' }).slides[0].title).toBe('A');
    expect(applySlidePatch(d, 'a', null)).toBe(d);
  });

  it('tolerates a deck with no slides array', () => {
    expect(applySlidePatch({ theme: 'x' }, 'a', { title: 'Y' })).toEqual({ theme: 'x', slides: [] });
  });

  it('drops unsafe keys (id, prototype-pollution vectors) from the patch', () => {
    const next = applySlidePatch(deck(), 'a', JSON.parse('{"id":"hacked","constructor":"x","title":"Safe"}'));
    expect(next.slides[0].id).toBe('a');             // id immutable
    expect(next.slides[0].title).toBe('Safe');       // legit field applied
    expect(next.slides[0].constructor).toBe(Object); // constructor not overwritten
  });

  it('drops unsupported fields that are not part of the slide schema', () => {
    const next = applySlidePatch(deck(), 'a', { speakerNotes: 'x', headline: 'y', title: 'Real' });
    expect(next.slides[0].title).toBe('Real');             // supported field applied
    expect(next.slides[0].speakerNotes).toBeUndefined();   // unsupported alias dropped
    expect(next.slides[0].headline).toBeUndefined();
  });

  it('accepts the supported notes field', () => {
    const next = applySlidePatch(deck(), 'a', { notes: 'Speak to the pain.' });
    expect(next.slides[0].notes).toBe('Speak to the pain.');
  });

  it('drops a collection field (items/kpis/stats/rows/columns) that is not an array', () => {
    const next = applySlidePatch(deck(), 'a', { items: 'one\ntwo', title: 'Keep' });
    expect(next.slides[0].title).toBe('Keep');       // legit field applied
    expect(next.slides[0].items).toBeUndefined();    // malformed collection not persisted
  });

  it('keeps the existing array when a patch sets a non-array collection', () => {
    const d = deck();
    d.slides[1] = { id: 'b', layout: 'kpi', kpis: [{ label: 'X' }] };
    const next = applySlidePatch(d, 'b', { kpis: { bad: 1 }, title: 'T' });
    expect(next.slides[1].kpis).toEqual([{ label: 'X' }]); // original kept, malformed dropped
    expect(next.slides[1].title).toBe('T');
  });

  it('still accepts a well-formed array collection (list items)', () => {
    const next = applySlidePatch(deck(), 'a', { layout: 'list', items: ['a', 'b'] });
    expect(next.slides[0].items).toEqual(['a', 'b']);
  });

  it('drops a rows value that is not an array of arrays', () => {
    const next = applySlidePatch(deck(), 'a', { rows: ['North', 'South'] });
    expect(next.slides[0].rows).toBeUndefined(); // flat array would crash r.map(...)
  });

  it('accepts a well-formed rows array of row arrays', () => {
    const next = applySlidePatch(deck(), 'a', { rows: [['a', 'b'], ['c', 'd']] });
    expect(next.slides[0].rows).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('drops rows whose cells are not primitives', () => {
    const next = applySlidePatch(deck(), 'a', { rows: [[{ text: 'North' }]] });
    expect(next.slides[0].rows).toBeUndefined(); // object cell would crash React render
  });

  it('accepts rows of primitive cells', () => {
    const next = applySlidePatch(deck(), 'a', { rows: [['North', 42]] });
    expect(next.slides[0].rows).toEqual([['North', 42]]);
  });

  it('drops columns that are not all primitives', () => {
    const next = applySlidePatch(deck(), 'a', { columns: [{ x: 1 }] });
    expect(next.slides[0].columns).toBeUndefined();
  });

  it('accepts object-array leaves that are flat records of primitives', () => {
    const next = applySlidePatch(deck(), 'a', { items: [{ n: '01', t: 'A', d: 'B' }] });
    expect(next.slides[0].items).toEqual([{ n: '01', t: 'A', d: 'B' }]);
  });

  it('drops primitive items for an object-backed layout (agenda)', () => {
    const d = deck();
    d.slides[0] = { id: 'a', layout: 'agenda', items: [{ n: '01', t: 'x', d: 'y' }] };
    const next = applySlidePatch(d, 'a', { items: ['Intro', 'Plan'] });
    expect(next.slides[0].items).toEqual([{ n: '01', t: 'x', d: 'y' }]); // primitives dropped (would render blank cards)
  });

  it('drops primitive kpis/stats (object-backed collections)', () => {
    const d = deck();
    d.slides[1] = { id: 'b', layout: 'kpi', kpis: [{ label: 'X', val: '1' }] };
    const next = applySlidePatch(d, 'b', { kpis: ['ARR'] });
    expect(next.slides[1].kpis).toEqual([{ label: 'X', val: '1' }]);
  });

  it('accepts object kpis for a kpi layout', () => {
    const d = deck();
    d.slides[1] = { id: 'b', layout: 'kpi', kpis: [] };
    const next = applySlidePatch(d, 'b', { kpis: [{ label: 'ARR', val: '$1M' }] });
    expect(next.slides[1].kpis).toEqual([{ label: 'ARR', val: '$1M' }]);
  });

  it('drops an object-array field whose leaves nest objects', () => {
    const next = applySlidePatch(deck(), 'a', { kpis: [{ label: { text: 'ARR' }, val: '5' }] });
    expect(next.slides[0].kpis).toBeUndefined(); // k.label would render an object child
  });

  it('drops a scalar field whose value is an object (would crash React render)', () => {
    const next = applySlidePatch(deck(), 'a', { title: { text: 'Q' }, body: 'Keep' });
    expect(next.slides[0].title).toBe('A');     // object dropped, original kept
    expect(next.slides[0].body).toBe('Keep');   // primitive applied
  });

  it('keeps primitive scalar fields', () => {
    const next = applySlidePatch(deck(), 'a', { title: 'New', notes: 'n' });
    expect(next.slides[0].title).toBe('New');
    expect(next.slides[0].notes).toBe('n');
  });
});

describe('sanitizeSlidePatch', () => {
  it('keeps valid fields and drops id, unsafe, and malformed ones', () => {
    const patch = JSON.parse('{"id":"x","title":"T","items":"bad","constructor":"y"}');
    expect(sanitizeSlidePatch(patch)).toEqual({ title: 'T' });
  });

  it('returns {} for null, a non-object, or a fully-rejected patch', () => {
    expect(sanitizeSlidePatch(null)).toEqual({});
    expect(sanitizeSlidePatch('nope')).toEqual({});
    expect(sanitizeSlidePatch({ title: { text: 'Q' } })).toEqual({});
  });
});

