import { describe, it, expect } from 'vitest';
import { fmtKey, fmtStyle, isFormattablePath, isFormattableKey, remapCollectionFmt } from './slideFmt.js';

// The formattable vocabulary, validated as both a render path (array, indices
// are numbers — used by the renderer's E()) and a stored key (string, indices
// are digits — used by the patch gate). Both must agree on exactly the fields
// the renderer formats: top-level fields + per-item index paths.
describe('isFormattablePath / isFormattableKey', () => {
  const both = (path, key, expected) => {
    expect(isFormattablePath(path)).toBe(expected);
    expect(isFormattableKey(key)).toBe(expected);
  };

  it('accepts the fixed top-level fields', () => {
    both(['title'], 'title', true);
    both(['note'], 'note', true);
  });

  it('accepts per-item paths the renderer emits', () => {
    both(['items', 2], 'items.2', true);                 // list item (primitive)
    both(['items', 0, 't'], 'items.0.t', true);          // agenda item sub-field
    both(['items', 5, 'n'], 'items.5.n', true);
    both(['kpis', 1, 'label'], 'kpis.1.label', true);
    both(['kpis', 3, 'val'], 'kpis.3.val', true);
    both(['stats', 0, 'lbl'], 'stats.0.lbl', true);
    both(['columns', 2], 'columns.2', true);             // table header
    both(['rows', 1, 4], 'rows.1.4', true);              // table cell (row.col)
  });

  it('rejects unknown roots, unknown leaves, and non-index segments', () => {
    both(['headline'], 'headline', false);               // not a formattable field
    both(['items', 0, 'x'], 'items.0.x', false);         // unknown agenda sub-field
    both(['kpis', 0, 'lbl'], 'kpis.0.lbl', false);       // lbl is a stat leaf, not kpi
    both(['bogus', 0, 't'], 'bogus.0.t', false);         // unknown collection
    both(['stats', 0], 'stats.0', false);                // stats items aren't primitives — need a leaf
    expect(isFormattableKey('items.x.t')).toBe(false);   // non-numeric index
    expect(isFormattableKey('rows.1.x')).toBe(false);    // non-numeric column (key side)
    expect(isFormattablePath(['rows', 1, 'x'])).toBe(false); // and the path side: a cell's column must be a real number
    expect(isFormattablePath(['items', '2'])).toBe(false); // a path index must be a number, not a string
    expect(isFormattablePath(['items', 0, 't', 'x'])).toBe(false); // too deep — no field that deep
    expect(isFormattableKey('items.0.t.x')).toBe(false);
  });

  it('rejects prototype-chain collection names without throwing', () => {
    // A stored fmt key is untrusted (JSON.parse makes "__proto__.0.t" an own
    // enumerable key the gate iterates). Collection names that resolve up
    // ITEM_FIELDS' prototype chain (`__proto__`→Object.prototype,
    // `constructor`→Object, `toString`/`hasOwnProperty`→functions) are not
    // arrays, so an unguarded `ITEM_FIELDS[coll].includes` THROWS instead of
    // rejecting — silently passing the gate's try/catch boundary as "applied".
    for (const proto of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      both([proto, 0, 't'], `${proto}.0.t`, false);
    }
  });
});

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

// When a per-item collection is reordered or an item is deleted, the index-keyed
// fmt must follow its item. `newOrder[newIndex] = oldIndex`; an old index missing
// from newOrder was deleted (its fmt is dropped). Keeps formatting aligned without
// stable item ids — the slide-patch merge replaces `fmt` wholesale, so the editor
// sends the remapped map alongside the reordered collection.
describe('remapCollectionFmt', () => {
  it('returns a falsy fmt unchanged (nothing to remap)', () => {
    expect(remapCollectionFmt(undefined, 'items', [0])).toBeUndefined();
    expect(remapCollectionFmt(null, 'items', [])).toBeNull();
  });

  it('drops a deleted item’s keys and shifts later items down', () => {
    // 3 agenda items, delete index 1 → old 0 and 2 survive (new positions 0 and 1)
    const fmt = {
      'items.0.t': { bold: true },
      'items.1.t': { italic: true },   // deleted
      'items.2.n': { underline: true },
      title: { bold: true },           // top-level — untouched
    };
    expect(remapCollectionFmt(fmt, 'items', [0, 2])).toEqual({
      'items.0.t': { bold: true },
      'items.1.n': { underline: true }, // old 2 → new 1
      title: { bold: true },
    });
  });

  it('remaps an arbitrary reorder for both object-leaf and primitive item keys', () => {
    const fmt = { 'items.0.t': { bold: true }, 'items.1': { italic: true } };
    expect(remapCollectionFmt(fmt, 'items', [1, 0])).toEqual({
      'items.1.t': { bold: true },  // old 0 → new 1
      'items.0': { italic: true },  // old 1 → new 0 (list primitive, no leaf)
    });
  });

  it('only rewrites the named collection — other collections and fields are preserved', () => {
    const fmt = { 'items.0.t': { bold: true }, 'kpis.0.val': { color: '#08f' }, subtitle: { italic: true } };
    // remap kpis with a swap; items.* and subtitle must be left exactly as-is
    expect(remapCollectionFmt(fmt, 'kpis', [0])).toEqual(fmt);
  });
});
