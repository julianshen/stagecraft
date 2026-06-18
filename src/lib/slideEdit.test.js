import { describe, it, expect } from 'vitest';
import { fieldPatch, prepareAIPatch, applyPreparedPatch } from './slideEdit.js';

// A deterministic id source so tests can assert exact element ids.
const seqGen = () => { let n = 0; return () => `gen-${++n}`; };

describe('prepareAIPatch (the AI element-patch pipeline: seed ids → validate → clamp)', () => {
  it('mints ids on raw id-less elements, then validates + clamps the survivors', () => {
    const raw = { elements: [{ type: 'text', x: 5000, y: 0, w: 8, h: 40, content: 'Hi' }] };
    const { patch, applied } = prepareAIPatch(raw, 'text', seqGen());
    expect(applied).toEqual(['elements']);
    expect(patch.elements[0]).toMatchObject({ id: 'gen-1', type: 'text', content: 'Hi' });
    expect(patch.elements[0].w).toBe(16);                       // clamped up to MIN_SIZE
    expect(patch.elements[0].x).toBeLessThanOrEqual(1920 - 16); // pulled on-screen
  });

  it('rejects the whole elements field when an element is malformed — id-minting does not launder it', () => {
    // A numeric-string geometry must be rejected (no coercion), even though
    // ids are minted before the gate runs.
    expect(prepareAIPatch({ elements: [{ type: 'text', x: 0, y: 0, w: '100', h: 40 }] }, 'text', seqGen()).applied).toEqual([]);
  });

  it('passes non-element fields through the normal gate', () => {
    expect(prepareAIPatch({ title: 'New' }, 'cover', seqGen())).toEqual({ patch: { title: 'New' }, applied: ['title'] });
  });
});

describe('applyPreparedPatch (merge into the deck, preserving images)', () => {
  const deck = (els) => ({ slides: [{ id: 's1', layout: 'text', elements: els }] });
  const img = { id: 'i1', type: 'image', x: 0, y: 0, w: 64, h: 64, src: 'data:image/png;base64,AAA' };
  const newText = { id: 'gen-1', type: 'text', x: 10, y: 10, w: 100, h: 40, content: 'AI' };

  it('preserves an existing background image and applies the AI overlay', () => {
    const out = applyPreparedPatch(deck([img, { id: 'old', type: 'text', x: 0, y: 0, w: 50, h: 20 }]), 's1', { elements: [newText] });
    expect(out.slides[0].elements).toEqual([img, newText]); // image kept (background), `old` replaced
  });

  it('is a no-op when the target slide is gone', () => {
    const d = deck([]);
    expect(applyPreparedPatch(d, 'missing', { elements: [newText] })).toBe(d);
  });

  it('applies a non-element patch unchanged', () => {
    const out = applyPreparedPatch(deck([]), 's1', { title: 'X' });
    expect(out.slides[0].title).toBe('X');
  });
});

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

  it('preserves source array shape including holes (parallel arrays stay aligned)', () => {
    // We deliberately do NOT compact holes — dropping a column hole without the
    // matching row cell would misalign a table; a holey patch is simply rejected
    // by the schema gate and the edit reverts (non-corrupting).
    const patch = fieldPatch({ columns: ['A', null, 'C'] }, ['columns', 2], 'C!');
    expect(patch).toEqual({ columns: ['A', null, 'C!'] });
  });

  it('creates ARRAY-shaped containers for numeric path segments, not objects', () => {
    const patch = fieldPatch({}, ['rows', 0, 0], 'X');
    expect(Array.isArray(patch.rows)).toBe(true);
    expect(Array.isArray(patch.rows[0])).toBe(true);
    expect(patch.rows[0][0]).toBe('X');
  });
});
