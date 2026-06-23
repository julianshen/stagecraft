import { describe, it, expect } from 'vitest';
import { roadmapModel, renameLane, renameMonth, relabelMilestone, ROADMAP_STATES, ROADMAP_LABELS, ROADMAP_HEX, ROADMAP_OKLCH } from './roadmapSpec.js';

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

// All three inline-edit helpers return the FULL materialized { months, lanes,
// todayIndex } patch (matching RoadmapLanesEditor), so editing one label on a
// demo roadmap can't flip off the default lanes / months / TODAY marker.
describe('renameLane — inline lane-name edit', () => {
  it('renames the target lane and returns the full materialized model', () => {
    const slide = { lanes: [
      { name: 'Alpha', items: [{ t: 0, d: 2, lbl: 'A1', state: 'done' }] },
      { name: 'Beta', items: [{ t: 1, d: 1, lbl: 'B1', state: 'planned' }] },
    ] };
    const patch = renameLane(slide, 0, 'Alpha 2');
    expect(Object.keys(patch).sort()).toEqual(['lanes', 'months', 'todayIndex']);
    expect(patch.lanes.map((l) => l.name)).toEqual(['Alpha 2', 'Beta']);
    expect(patch.lanes[1]).toEqual(roadmapModel(slide).lanes[1]); // sibling untouched
  });

  it('preserves the demo TODAY marker and other default lanes (commits the whole model)', () => {
    // A bare roadmap renders from the fallback (todayIndex 3.5, 4 lanes). A
    // {lanes}-only patch would set slide.lanes, flip usingDefaultLanes, and drop
    // the marker — so the patch must carry months + todayIndex too.
    const patch = renameLane({ layout: 'roadmap' }, 0, 'Core');
    expect(patch.todayIndex).toBe(3.5);
    expect(patch.lanes.map((l) => l.name)).toEqual(['Core', 'Growth', 'AI', 'Enterprise']);
    // and re-deriving from the patched slide keeps the marker (the regression guard)
    expect(roadmapModel({ layout: 'roadmap', ...patch }).todayIndex).toBe(3.5);
  });

  it('is a no-op rename for an out-of-range index', () => {
    expect(renameLane({}, 99, 'X').lanes).toEqual(roadmapModel({}).lanes);
  });
});

describe('renameMonth — inline month-label edit', () => {
  it('renames the target month on a demo roadmap, keeping the other months, lanes, and TODAY', () => {
    const patch = renameMonth({ layout: 'roadmap' }, 0, 'Q1');
    expect(patch.months[0]).toBe('Q1');
    expect(patch.months.slice(1)).toEqual(roadmapModel({}).months.slice(1)); // others untouched
    expect(patch.todayIndex).toBe(3.5); // marker survives (full model committed)
    expect(patch.lanes).toHaveLength(4); // default lanes survive
  });
});

describe('relabelMilestone — inline milestone-label edit', () => {
  it('relabels lanes[li].items[ii].lbl, preserving every other item and lane', () => {
    const slide = { lanes: [
      { name: 'A', items: [{ t: 0, d: 2, lbl: 'One', state: 'done' }, { t: 3, d: 1, lbl: 'Two', state: 'planned' }] },
      { name: 'B', items: [{ t: 1, d: 1, lbl: 'Three', state: 'inflight' }] },
    ] };
    const patch = relabelMilestone(slide, 0, 1, 'Two!');
    expect(patch.lanes[0].items.map((it) => it.lbl)).toEqual(['One', 'Two!']);
    expect(patch.lanes[1]).toEqual(roadmapModel(slide).lanes[1]); // other lane untouched
  });

  it('materializes the demo roadmap so relabelling one milestone keeps the defaults + TODAY', () => {
    const patch = relabelMilestone({ layout: 'roadmap' }, 0, 0, 'Shipped!');
    expect(patch.lanes[0].items[0].lbl).toBe('Shipped!');
    expect(patch.lanes[0].items[1].lbl).toBe('Audit v2'); // sibling milestone intact
    expect(patch.lanes).toHaveLength(4);  // other default lanes survive
    expect(patch.todayIndex).toBe(3.5);   // marker survives
  });
});
