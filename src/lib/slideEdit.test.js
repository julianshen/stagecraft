import { describe, it, expect } from 'vitest';
import { fieldPatch } from './slideEdit.js';

describe('fieldPatch', () => {
  it('builds a scalar patch for a top-level field', () => {
    expect(fieldPatch({ title: 'A' }, ['title'], 'B')).toEqual({ title: 'B' });
  });

  it('rebuilds the whole array for a nested record field, immutably', () => {
    const slide = { items: [{ n: '01', t: 'One', d: 'a' }, { n: '02', t: 'Two', d: 'b' }] };
    const patch = fieldPatch(slide, ['items', 1, 't'], 'Two!');
    expect(patch).toEqual({ items: [{ n: '01', t: 'One', d: 'a' }, { n: '02', t: 'Two!', d: 'b' }] });
    expect(patch.items).not.toBe(slide.items);       // new array
    expect(patch.items[0]).toBe(slide.items[0]);      // untouched item kept by reference
    expect(slide.items[1].t).toBe('Two');             // original not mutated
  });

  it('edits a plain-string list item', () => {
    const slide = { items: ['first', 'second', 'third'] };
    expect(fieldPatch(slide, ['items', 0], 'FIRST')).toEqual({ items: ['FIRST', 'second', 'third'] });
  });

  it('edits a 2-D table cell without disturbing other rows', () => {
    const slide = { rows: [['a', 'b'], ['c', 'd']] };
    const patch = fieldPatch(slide, ['rows', 1, 0], 'C!');
    expect(patch).toEqual({ rows: [['a', 'b'], ['C!', 'd']] });
    expect(patch.rows[0]).toBe(slide.rows[0]); // first row kept by reference
  });

  it('edits a flat array element (table columns)', () => {
    expect(fieldPatch({ columns: ['X', 'Y'] }, ['columns', 1], 'Y2')).toEqual({ columns: ['X', 'Y2'] });
  });

  it('creates the container when the nested field is absent', () => {
    expect(fieldPatch({}, ['meta', 'x'], 1)).toEqual({ meta: { x: 1 } });
  });
});
