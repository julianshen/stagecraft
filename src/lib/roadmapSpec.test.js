import { describe, it, expect } from 'vitest';
import { roadmapModel, ROADMAP_STATES, ROADMAP_LABELS, ROADMAP_HEX, ROADMAP_OKLCH } from './roadmapSpec.js';

describe('roadmapModel — defaults', () => {
  it('returns the demo roadmap (12 months, 4 lanes, TODAY marker) when the slide has no roadmap data', () => {
    for (const slide of [undefined, {}, { title: 'Roadmap' }]) {
      const m = roadmapModel(slide);
      expect(m.months).toHaveLength(12);
      expect(m.lanes).toHaveLength(4);
      expect(m.lanes[0].name).toBe('Platform');
      expect(m.todayIndex).toBe(3.5);
      // every default item has a valid state
      m.lanes.flatMap((l) => l.items).forEach((it) => expect(ROADMAP_STATES).toContain(it.state));
    }
  });
});

describe('roadmapModel — custom data', () => {
  it('uses the slide-provided months and lanes', () => {
    const m = roadmapModel({
      months: ['M1', 'M2', 'M3'],
      lanes: [{ name: 'Build', items: [{ t: 0, d: 2, lbl: 'Spike', state: 'done' }] }],
    });
    expect(m.months).toEqual(['M1', 'M2', 'M3']);
    expect(m.lanes).toHaveLength(1);
    expect(m.lanes[0]).toMatchObject({ name: 'Build' });
    expect(m.lanes[0].items[0]).toMatchObject({ t: 0, d: 2, lbl: 'Spike', state: 'done' });
  });

  it('clamps a bar so it cannot overflow the month axis (t in range, t+d <= months)', () => {
    const m = roadmapModel({
      months: ['a', 'b', 'c'],
      lanes: [{ name: 'L', items: [{ t: 5, d: 10, lbl: 'x', state: 'done' }] }],
    });
    const it = m.lanes[0].items[0];
    expect(it.t).toBe(2);                    // clamped to span-1 (leaves room for the bar)
    expect(it.t + it.d).toBeLessThanOrEqual(3); // duration shrinks so the bar fits the axis
    expect(it.d).toBeGreaterThanOrEqual(1);
  });

  it('coerces an unknown or missing state to "planned"', () => {
    const m = roadmapModel({ months: ['a', 'b'], lanes: [{ name: 'L', items: [{ t: 0, d: 1, state: 'wat' }, { t: 1, d: 1 }] }] });
    expect(m.lanes[0].items.map((i) => i.state)).toEqual(['planned', 'planned']);
  });

  it('coerces non-numeric t/d (incl. null/true, not just NaN) and drops falsy lanes/items', () => {
    const m = roadmapModel({
      months: ['a', 'b', 'c'],
      lanes: [null, { name: 'L', items: [null, { t: 'x', d: 'y', lbl: 'q', state: 'inflight' }, { t: true, d: null, lbl: 'r', state: 'done' }] }],
    });
    expect(m.lanes).toHaveLength(1);
    expect(m.lanes[0].items[0]).toMatchObject({ t: 0, d: 1 }); // 'x'/'y' → fallbacks
    expect(m.lanes[0].items[1]).toMatchObject({ t: 0, d: 1 }); // true/null → fallbacks, NOT 1/0
  });
});

describe('roadmapModel — todayIndex', () => {
  it('honours a slide-provided todayIndex, clamped to the axis', () => {
    expect(roadmapModel({ months: ['a', 'b', 'c'], lanes: [], todayIndex: 2 }).todayIndex).toBe(2);
    expect(roadmapModel({ months: ['a', 'b', 'c'], lanes: [], todayIndex: 99 }).todayIndex).toBe(3);
  });

  it('omits the TODAY marker (null) for a custom roadmap that does not specify one', () => {
    expect(roadmapModel({ months: ['a', 'b'], lanes: [{ name: 'L', items: [] }] }).todayIndex).toBeNull();
  });

  it('clamps the default 3.5 marker to a custom month axis (months without lanes)', () => {
    // usingDefaultLanes stays true, but 3.5 must not fall off a 2-slot axis.
    expect(roadmapModel({ months: ['H1', 'H2'] }).todayIndex).toBe(2);
    expect(roadmapModel(undefined).todayIndex).toBe(3.5); // 12-month default unaffected
  });

  it('treats a non-numeric todayIndex (null/""/string) as "no marker", not month 0', () => {
    const base = { months: ['a', 'b'], lanes: [{ name: 'L', items: [] }] };
    expect(roadmapModel({ ...base, todayIndex: null }).todayIndex).toBeNull();
    expect(roadmapModel({ ...base, todayIndex: '' }).todayIndex).toBeNull();
    expect(roadmapModel({ ...base, todayIndex: '1' }).todayIndex).toBeNull();
    expect(roadmapModel({ ...base, todayIndex: 0 }).todayIndex).toBe(0); // a real 0 IS honoured
  });
});

describe('roadmap palette', () => {
  it('exposes a label, hex, and oklch colour for every state (canvas + export share one list)', () => {
    ROADMAP_STATES.forEach((s) => {
      expect(typeof ROADMAP_LABELS[s]).toBe('string');
      expect(ROADMAP_HEX[s]).toMatch(/^[0-9A-F]{6}$/i);
      expect(typeof ROADMAP_OKLCH[s]).toBe('string');
    });
  });
});
