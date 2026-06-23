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


describe('sanitizeSlidePatch — chart and roadmap data fields', () => {
  it('accepts a well-shaped chart object', () => {
    const patch = { chart: { categories: ['A', 'B'], series: [{ name: 'S1', values: [1, 2] }] } };
    expect(sanitizeSlidePatch(patch, 'chart')).toEqual(patch);
  });

  it('rejects malformed chart values (array, non-array series values, object categories)', () => {
    expect(sanitizeSlidePatch({ chart: [1, 2] }, 'chart')).toEqual({});
    expect(sanitizeSlidePatch({ chart: { categories: ['A'], series: [{ values: 'nope' }] } }, 'chart')).toEqual({});
    expect(sanitizeSlidePatch({ chart: { categories: [{ q: 1 }], series: [] } }, 'chart')).toEqual({});
  });

  it('rejects plausible-but-unsupported chart shapes that would blank the slide', () => {
    // chartData only reads categories/series — a replace with neither present
    // would silently fall back to the demo data while Co-pilot claims success.
    expect(sanitizeSlidePatch({ chart: { labels: ['A'], datasets: [{ data: [1] }] } }, 'chart')).toEqual({});
    expect(sanitizeSlidePatch({ chart: { categories: ['A'] } }, 'chart')).toEqual({}); // replace loses series
    expect(sanitizeSlidePatch({ chart: { series: [{ values: [1] }] } }, 'chart')).toEqual({}); // and vice versa
  });

  it('accepts well-shaped roadmap lanes, months, and todayIndex', () => {
    const patch = {
      lanes: [{ name: 'A', items: [{ t: 0, d: 2, lbl: 'M1', state: 'done' }] }, { name: 'B', items: [] }],
      months: ['Jan', 'Feb'],
      todayIndex: 1.5,
    };
    expect(sanitizeSlidePatch(patch, 'roadmap')).toEqual(patch);
  });

  it('rejects plausible-but-unsupported lane shapes that would blank the roadmap', () => {
    // roadmapModel reads name/items — a {title, tasks} lane normalizes to an
    // empty lane, leaving the roadmap blank while Co-pilot claims success.
    expect(sanitizeSlidePatch({ lanes: [{ title: 'A', tasks: [] }] }, 'roadmap')).toEqual({});
    expect(sanitizeSlidePatch({ lanes: [{ name: 'A' }] }, 'roadmap')).toEqual({}); // items required
  });

  it('rejects malformed lanes (nested non-flat items, non-object lane) and months', () => {
    expect(sanitizeSlidePatch({ lanes: [{ items: [{ deep: { x: 1 } }] }] }, 'roadmap')).toEqual({});
    expect(sanitizeSlidePatch({ lanes: ['a'] }, 'roadmap')).toEqual({});
    expect(sanitizeSlidePatch({ months: [{ m: 'Jan' }] }, 'roadmap')).toEqual({});
  });
});

describe('sanitizeSlidePatch — todayIndex must be numeric', () => {
  it('accepts finite numbers and explicit null (meaning "no marker")', () => {
    expect(sanitizeSlidePatch({ todayIndex: 3 }, 'roadmap')).toEqual({ todayIndex: 3 });
    expect(sanitizeSlidePatch({ todayIndex: 0 }, 'roadmap')).toEqual({ todayIndex: 0 });
    expect(sanitizeSlidePatch({ todayIndex: null }, 'roadmap')).toEqual({ todayIndex: null });
  });

  it('rejects strings and non-finite values roadmapModel would silently ignore', () => {
    expect(sanitizeSlidePatch({ todayIndex: '3' }, 'roadmap')).toEqual({});
    expect(sanitizeSlidePatch({ todayIndex: NaN }, 'roadmap')).toEqual({});
    expect(sanitizeSlidePatch({ todayIndex: Infinity }, 'roadmap')).toEqual({});
  });
});

describe('sanitizeSlidePatch — empty chart payloads', () => {
  it('rejects empty categories/series (chartData treats empty as missing → demo fallback)', () => {
    expect(sanitizeSlidePatch({ chart: { categories: [], series: [] } }, 'chart')).toEqual({});
    expect(sanitizeSlidePatch({ chart: { categories: ['A'], series: [] } }, 'chart')).toEqual({});
    expect(sanitizeSlidePatch({ chart: { categories: [], series: [{ values: [1] }] } }, 'chart')).toEqual({});
  });
});

describe('sanitizeSlidePatch — roadmap item positions must be numeric', () => {
  it('rejects string t/d positions roadmapModel would normalize to 0/1', () => {
    expect(sanitizeSlidePatch({ lanes: [{ name: 'A', items: [{ t: '3', d: 2, lbl: 'M', state: 'done' }] }] }, 'roadmap')).toEqual({});
    expect(sanitizeSlidePatch({ lanes: [{ name: 'A', items: [{ t: 3, d: '2', lbl: 'M', state: 'done' }] }] }, 'roadmap')).toEqual({});
  });

  it('accepts numeric positions and omitted t/d (normItem defaults them)', () => {
    const ok = { lanes: [{ name: 'A', items: [{ t: 3, d: 2, lbl: 'M', state: 'done' }, { lbl: 'No pos' }] }] };
    expect(sanitizeSlidePatch(ok, 'roadmap')).toEqual(ok);
  });
});

describe('sanitizeSlidePatch — data fields are gated to their layouts', () => {
  const chart = { categories: ['A'], series: [{ values: [1] }] };

  it('rejects a chart payload on a non-chart slide (nothing would render it)', () => {
    expect(sanitizeSlidePatch({ chart }, 'text')).toEqual({});
  });

  it('accepts a chart payload when the same patch switches the slide to chart', () => {
    expect(sanitizeSlidePatch({ layout: 'chart', chart }, 'text')).toEqual({ layout: 'chart', chart });
  });

  it('rejects roadmap data fields on a non-roadmap slide', () => {
    expect(sanitizeSlidePatch({ lanes: [{ name: 'A', items: [] }] }, 'kpi')).toEqual({});
    expect(sanitizeSlidePatch({ months: ['Jan'] }, 'kpi')).toEqual({});
    expect(sanitizeSlidePatch({ todayIndex: 2 }, 'kpi')).toEqual({});
  });
});

describe('sanitizeSlidePatch — per-field formatting (fmt)', () => {
  it('accepts an fmt map of fixed top-level field keys', () => {
    const fmt = { title: { bold: true, fontSize: 64, color: '#08f' }, subtitle: { italic: true, underline: true } };
    expect(sanitizeSlidePatch({ fmt }, 'cover')).toEqual({ fmt });
  });

  it('accepts per-item fmt keys the renderer emits (items / kpis / stats / table)', () => {
    // Per-item index paths are now formattable (the renderer styles them via E()).
    expect(sanitizeSlidePatch({ fmt: { 'items.0.t': { bold: true } } }, 'agenda')).toEqual({ fmt: { 'items.0.t': { bold: true } } });
    const fmt = { 'items.2': { italic: true }, 'kpis.1.val': { fontSize: 80 }, 'rows.0.1': { color: '#08f' }, 'columns.2': { bold: true }, title: { bold: true } };
    expect(sanitizeSlidePatch({ fmt }, 'kpi')).toEqual({ fmt });
  });

  it('rejects fmt keys that are not formattable text fields (no rendered field)', () => {
    // A collection root (no index), an unknown leaf, or an invented name still
    // renders nothing, so reject it.
    expect(sanitizeSlidePatch({ fmt: { items: { bold: true } } }, 'agenda')).toEqual({}); // collection root, not an item
    expect(sanitizeSlidePatch({ fmt: { 'items.0.x': { bold: true } } }, 'agenda')).toEqual({}); // unknown item leaf
    expect(sanitizeSlidePatch({ fmt: { headline: { bold: true } } }, 'cover')).toEqual({});
    expect(sanitizeSlidePatch({ fmt: { title: { bold: true }, headline: { bold: true } } }, 'cover')).toEqual({});
  });

  it('rejects an fmt entry carrying an unknown or wrong-typed prop (would persist junk)', () => {
    expect(sanitizeSlidePatch({ fmt: { title: { bold: 'yes' } } }, 'cover')).toEqual({}); // bold must be boolean
    expect(sanitizeSlidePatch({ fmt: { title: { fontSize: '64' } } }, 'cover')).toEqual({}); // fontSize must be a number
    expect(sanitizeSlidePatch({ fmt: { title: { wiggle: true } } }, 'cover')).toEqual({}); // unknown prop
    expect(sanitizeSlidePatch({ fmt: { title: { fontSize: NaN } } }, 'cover')).toEqual({}); // non-finite
  });

  it('rejects — does not throw on — an fmt entry with a prototype-chain prop key', () => {
    // JSON.parse makes __proto__/constructor/toString OWN enumerable keys. The
    // entry-prop check must reject them like any unknown prop, not index
    // FMT_PROP_OK with them: FMT_PROP_OK['__proto__'] resolves to Object.prototype
    // (a throw when called), while 'constructor'/'toString' resolve to callables
    // that return truthy — silently passing an unrenderable prop as "applied".
    for (const prop of ['__proto__', 'constructor', 'toString']) {
      const patch = JSON.parse(`{"fmt":{"title":{"${prop}":1}}}`);
      expect(() => sanitizeSlidePatch(patch, 'cover')).not.toThrow();
      expect(sanitizeSlidePatch(patch, 'cover')).toEqual({}); // entry has no valid prop → whole map dropped
    }
  });

  it('rejects an fmt that is not a map of records', () => {
    expect(sanitizeSlidePatch({ fmt: { title: 'bold' } }, 'cover')).toEqual({}); // entry must be an object
    expect(sanitizeSlidePatch({ fmt: ['title'] }, 'cover')).toEqual({}); // array, not a map
    expect(sanitizeSlidePatch({ fmt: 'bold' }, 'cover')).toEqual({});
  });

  it('accepts an empty fmt map and an empty entry', () => {
    expect(sanitizeSlidePatch({ fmt: {} }, 'cover')).toEqual({ fmt: {} });
    expect(sanitizeSlidePatch({ fmt: { title: {} } }, 'cover')).toEqual({ fmt: { title: {} } });
  });
});

describe('sanitizeSlidePatch — free-form canvas elements', () => {
  // Valid elements carry an id (the gate requires one; applyAIPatch mints it
  // before the gate runs). Fills are hex; image src is a data URL.
  const text = { id: 'a', type: 'text', x: 10, y: 20, w: 100, h: 40, content: 'Hi', fill: '#111' };
  const shape = { id: 'b', type: 'shape', x: 0, y: 0, w: 50, h: 50, fill: '#abc' };
  const line = { id: 'c', type: 'line', x: 0, y: 0, w: 200, h: 8, fill: '#111' };

  it('accepts an array of valid elements (text / shape / line) — layout-agnostic', () => {
    const patch = { elements: [text, shape, line] };
    expect(sanitizeSlidePatch(patch, 'text')).toEqual(patch);
    expect(sanitizeSlidePatch(patch, 'chart')).toEqual(patch); // overlays any layout
  });

  it('accepts every known shape type (via the shared shape registry) and an empty array', () => {
    const types = ['rounded', 'circle', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arrow', 'rect', 'ellipse'];
    const els = types.map((type, i) => ({ id: `s${i}`, type, x: i, y: 0, w: 16, h: 16, fill: '#abc' }));
    expect(sanitizeSlidePatch({ elements: els }, 'text')).toEqual({ elements: els });
    expect(sanitizeSlidePatch({ elements: [] }, 'text')).toEqual({ elements: [] }); // clears the overlay
  });

  it('requires a hex fill on every fill-bearing element (text/line/shape); only image needs none', () => {
    expect(sanitizeSlidePatch({ elements: [{ id: 's', type: 'circle', x: 0, y: 0, w: 16, h: 16 }] }, 'text')).toEqual({}); // fill-less shape
    expect(sanitizeSlidePatch({ elements: [{ id: 't', type: 'text', x: 0, y: 0, w: 50, h: 20, content: 'x' }] }, 'text')).toEqual({}); // fill-less text (canvas --ink vs export #15171C)
    expect(sanitizeSlidePatch({ elements: [{ id: 'l', type: 'line', x: 0, y: 0, w: 50, h: 8 }] }, 'text')).toEqual({}); // fill-less line
    const img = { id: 'i', type: 'image', x: 0, y: 0, w: 64, h: 64, src: 'data:image/png;base64,AAA' };
    expect(sanitizeSlidePatch({ elements: [img] }, 'text')).toEqual({ elements: [img] }); // image needs no fill
  });

  it('accepts a path element (points + stroke, no fill) and rejects malformed/missing points', () => {
    const path = { id: 'p', type: 'path', x: 0, y: 0, w: 200, h: 100, points: [[0, 0], [1, 1]], stroke: '#15171C', strokeWidth: 2 };
    expect(sanitizeSlidePatch({ elements: [path] }, 'text')).toEqual({ elements: [path] }); // a freehand stroke needs no fill
    // points must be ≥2 finite [x,y] pairs — the renderer/export need a polyline.
    expect(sanitizeSlidePatch({ elements: [{ ...path, points: [[0, 0]] }] }, 'text')).toEqual({});        // <2 points
    expect(sanitizeSlidePatch({ elements: [{ ...path, points: [[0], [1, 1]] }] }, 'text')).toEqual({});   // a non-pair point
    const noPoints = { id: 'p', type: 'path', x: 0, y: 0, w: 200, h: 100, stroke: '#15171C', strokeWidth: 2 };
    expect(sanitizeSlidePatch({ elements: [noPoints] }, 'text')).toEqual({});                              // a path with no points renders nothing
    const noStroke = { id: 'p', type: 'path', x: 0, y: 0, w: 200, h: 100, points: [[0, 0], [1, 1]] };
    expect(sanitizeSlidePatch({ elements: [noStroke] }, 'text')).toEqual({});                              // stroke is the path's colour — required (canvas --ink vs export #15171C otherwise)
  });

  it('requires non-empty content on a text element (an empty one renders nothing)', () => {
    expect(sanitizeSlidePatch({ elements: [{ id: 't', type: 'text', x: 0, y: 0, w: 50, h: 20, fill: '#111' }] }, 'text')).toEqual({}); // no content
    expect(sanitizeSlidePatch({ elements: [{ id: 't', type: 'text', x: 0, y: 0, w: 50, h: 20, fill: '#111', content: '' }] }, 'text')).toEqual({}); // empty content
    expect(sanitizeSlidePatch({ elements: [text] }, 'text')).toEqual({ elements: [text] }); // text fixture has content
  });

  it('accepts a known strokeDash (solid/dashed/dotted) and rejects an unknown one', () => {
    const base = { id: 's', type: 'rect', x: 0, y: 0, w: 50, h: 50, fill: '#abc', stroke: '#000', strokeWidth: 2 };
    for (const d of ['solid', 'dashed', 'dotted']) {
      expect(sanitizeSlidePatch({ elements: [{ ...base, strokeDash: d }] }, 'text')).toEqual({ elements: [{ ...base, strokeDash: d }] });
    }
    expect(sanitizeSlidePatch({ elements: [{ ...base, strokeDash: 'wavy' }] }, 'text')).toEqual({}); // unknown style → reject
  });

  it('rejects a non-positive fontSize (export would emit a negative point size)', () => {
    expect(sanitizeSlidePatch({ elements: [{ ...text, fontSize: -20 }] }, 'text')).toEqual({});
    expect(sanitizeSlidePatch({ elements: [{ ...text, fontSize: 0 }] }, 'text')).toEqual({});
    expect(sanitizeSlidePatch({ elements: [{ ...text, fontSize: 24 }] }, 'text')).toEqual({ elements: [{ ...text, fontSize: 24 }] });
  });

  it('accepts a shape stroke (hex colour + non-negative width), rejects malformed ones', () => {
    const stroked = { ...shape, stroke: '#123456', strokeWidth: 2 };
    expect(sanitizeSlidePatch({ elements: [stroked] }, 'text')).toEqual({ elements: [stroked] });
    const noOutline = { ...shape, stroke: '#123456', strokeWidth: 0 }; // 0 = no outline, still valid
    expect(sanitizeSlidePatch({ elements: [noOutline] }, 'text')).toEqual({ elements: [noOutline] });
    expect(sanitizeSlidePatch({ elements: [{ ...stroked, stroke: 'red' }] }, 'text')).toEqual({});        // non-hex stroke
    expect(sanitizeSlidePatch({ elements: [{ ...stroked, strokeWidth: -1 }] }, 'text')).toEqual({});       // negative width
  });

  it('accepts a shadow object (hex colour + non-neg blur + finite offsets), rejects malformed ones', () => {
    const shadowed = { ...shape, shadow: { color: '#000000', blur: 16, x: 4, y: 8 } };
    expect(sanitizeSlidePatch({ elements: [shadowed] }, 'text')).toEqual({ elements: [shadowed] });
    expect(sanitizeSlidePatch({ elements: [{ ...shape, shadow: { color: 'black', blur: 16, x: 0, y: 0 } }] }, 'text')).toEqual({}); // non-hex
    expect(sanitizeSlidePatch({ elements: [{ ...shape, shadow: { color: '#000', blur: -1, x: 0, y: 0 } }] }, 'text')).toEqual({}); // negative blur
    expect(sanitizeSlidePatch({ elements: [{ ...shape, shadow: { color: '#000', blur: 0, x: 0 } }] }, 'text')).toEqual({});        // missing y
    expect(sanitizeSlidePatch({ elements: [{ ...shape, shadow: { color: '#000', blur: 0, x: 0, y: 0, bogus: 1 } }] }, 'text')).toEqual({}); // extra key
    expect(sanitizeSlidePatch({ elements: [{ ...shape, shadow: 'on' }] }, 'text')).toEqual({});                                    // not an object
  });

  it('accepts a gradient object (hex stops + finite angle), rejects malformed ones', () => {
    const grad = { ...shape, gradient: { from: '#4f46e5', to: '#06b6d4', angle: 135 } };
    expect(sanitizeSlidePatch({ elements: [grad] }, 'text')).toEqual({ elements: [grad] });
    expect(sanitizeSlidePatch({ elements: [{ ...shape, gradient: { from: 'red', to: '#fff', angle: 90 } }] }, 'text')).toEqual({});       // non-hex stop
    expect(sanitizeSlidePatch({ elements: [{ ...shape, gradient: { from: '#000', to: '#fff', angle: 'x' } }] }, 'text')).toEqual({});     // non-finite angle
    expect(sanitizeSlidePatch({ elements: [{ ...shape, gradient: { from: '#000', to: '#fff' } }] }, 'text')).toEqual({});                 // missing angle
    expect(sanitizeSlidePatch({ elements: [{ ...shape, gradient: { from: '#000', to: '#fff', angle: 0, bogus: 1 } }] }, 'text')).toEqual({}); // extra key
    expect(sanitizeSlidePatch({ elements: [{ ...shape, gradient: 'on' }] }, 'text')).toEqual({});                                         // not an object
  });

  it('accepts a string groupId, rejects a non-string', () => {
    const grouped = { ...shape, groupId: 'grp-1' };
    expect(sanitizeSlidePatch({ elements: [grouped] }, 'text')).toEqual({ elements: [grouped] });
    expect(sanitizeSlidePatch({ elements: [{ ...shape, groupId: 42 }] }, 'text')).toEqual({});   // non-string id
    expect(sanitizeSlidePatch({ elements: [{ ...shape, groupId: { a: 1 } }] }, 'text')).toEqual({}); // object
  });

  it('constrains align to left/center/right (the renderer maps only those)', () => {
    expect(sanitizeSlidePatch({ elements: [{ ...text, align: 'center' }] }, 'text')).toEqual({ elements: [{ ...text, align: 'center' }] });
    expect(sanitizeSlidePatch({ elements: [{ ...text, align: 'justify' }] }, 'text')).toEqual({}); // not a value the renderer maps
  });

  it('accepts the full optional field set with correct types', () => {
    const rich = { id: 'e1', type: 'text', x: 0, y: 0, w: 100, h: 40, content: 'A', fontSize: 48, bold: true, italic: false, underline: true, align: 'center', fontFamily: 'Inter', fill: '#111', rot: 30, opacity: 50 };
    expect(sanitizeSlidePatch({ elements: [rich] }, 'text')).toEqual({ elements: [rich] });
  });

  it('accepts an image only with a data-URL src; rejects a remote src', () => {
    const img = { id: 'i', type: 'image', x: 0, y: 0, w: 64, h: 64, src: 'data:image/png;base64,AAA' };
    expect(sanitizeSlidePatch({ elements: [img] }, 'text')).toEqual({ elements: [img] });
    expect(sanitizeSlidePatch({ elements: [{ ...img, src: 'https://evil.example/x.png' }] }, 'text')).toEqual({}); // no remote fetch
  });

  it('gates fill to a hex colour (canvas == export); rejects a CSS name', () => {
    expect(sanitizeSlidePatch({ elements: [{ ...shape, fill: '#aabbcc' }] }, 'text')).toEqual({ elements: [{ ...shape, fill: '#aabbcc' }] });
    expect(sanitizeSlidePatch({ elements: [{ ...shape, fill: 'red' }] }, 'text')).toEqual({}); // would render indigo on export
  });

  it('rejects the whole field if any element is malformed (replace-not-merge strictness)', () => {
    expect(sanitizeSlidePatch({ elements: 'nope' }, 'text')).toEqual({});                          // not an array
    expect(sanitizeSlidePatch({ elements: [text, 'str'] }, 'text')).toEqual({});                    // non-object element
    expect(sanitizeSlidePatch({ elements: [{ ...text, type: 'bogus' }] }, 'text')).toEqual({});     // unknown type
    expect(sanitizeSlidePatch({ elements: [{ id: 'x', type: 'text', x: 0, y: 0, w: 100, fill: '#111' }] }, 'text')).toEqual({}); // missing h
    expect(sanitizeSlidePatch({ elements: [{ type: 'text', x: 0, y: 0, w: 10, h: 10, fill: '#111' }] }, 'text')).toEqual({}); // missing id
    expect(sanitizeSlidePatch({ elements: [{ ...text, x: NaN }] }, 'text')).toEqual({});            // non-finite geometry
    expect(sanitizeSlidePatch({ elements: [{ ...text, w: 'wide' }] }, 'text')).toEqual({});         // non-numeric geometry
    expect(sanitizeSlidePatch({ elements: [{ ...text, w: '100' }] }, 'text')).toEqual({});          // a NUMERIC string is still rejected (no coercion at the gate)
  });

  it('rejects an element with a wrong-typed known field or an unknown key', () => {
    expect(sanitizeSlidePatch({ elements: [{ ...text, fontSize: 'big' }] }, 'text')).toEqual({});   // fontSize must be a number
    expect(sanitizeSlidePatch({ elements: [{ ...text, bold: 'yes' }] }, 'text')).toEqual({});        // bold must be a boolean
    expect(sanitizeSlidePatch({ elements: [{ ...shape, fill: 42 }] }, 'text')).toEqual({});          // fill must be a string
    expect(sanitizeSlidePatch({ elements: [{ ...text, id: 7 }] }, 'text')).toEqual({});              // id must be a string
    expect(sanitizeSlidePatch({ elements: [{ ...text, bogus: 1 }] }, 'text')).toEqual({});           // unknown key
    expect(sanitizeSlidePatch({ elements: [{ ...text, type: null }] }, 'text')).toEqual({});         // non-string type rejected (not thrown)
    expect(sanitizeSlidePatch({ elements: [{ ...text, type: 42 }] }, 'text')).toEqual({});
  });

  it('rejects — does not throw on — an element with a prototype-chain own key', () => {
    // JSON.parse creates an OWN enumerable __proto__ property (an object literal
    // wouldn't). The validator must reject it like any unknown key, not try to
    // call Object.prototype (which `ELEMENT_FIELD_OK['__proto__']` resolves to).
    // The id makes it reach the key-loop (so the __proto__ guard is exercised,
    // not short-circuited by the missing-id check).
    const patch = JSON.parse('{"elements":[{"id":"p","type":"text","x":0,"y":0,"w":10,"h":10,"__proto__":{"polluted":true}}]}');
    expect(() => sanitizeSlidePatch(patch, 'text')).not.toThrow();
    expect(sanitizeSlidePatch(patch, 'text')).toEqual({});
    expect({}.polluted).toBeUndefined(); // and nothing was polluted
  });
});
