// Roadmap timeline model — the single source the canvas RoadmapGraphic and the
// PPTX export both render from (the same canvas↔export-parity approach as
// chartSpec/chartData). A slide may carry `months`, `lanes`, and `todayIndex`;
// when it doesn't, we fall back to the built-in demo roadmap so existing decks
// render unchanged. Each item is `{ t, d, lbl, state }` — start month, duration
// in months, label, and lifecycle state.

const DEFAULT_MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const DEFAULT_LANES = [
  { name: 'Platform', items: [{ t: 0, d: 2, lbl: 'Workflow GA', state: 'done' }, { t: 3, d: 3, lbl: 'Audit v2', state: 'done' }, { t: 7, d: 4, lbl: 'Data residency', state: 'inflight' }] },
  { name: 'Growth', items: [{ t: 1, d: 3, lbl: 'Self-serve EU', state: 'done' }, { t: 5, d: 3, lbl: 'SMB re-price', state: 'inflight' }, { t: 9, d: 2, lbl: 'PLG loops', state: 'planned' }] },
  { name: 'AI', items: [{ t: 2, d: 4, lbl: 'Copilot α', state: 'inflight' }, { t: 7, d: 5, lbl: 'Auto-workflow', state: 'planned' }] },
  { name: 'Enterprise', items: [{ t: 0, d: 6, lbl: 'SAML→OIDC', state: 'done' }, { t: 6, d: 3, lbl: 'Gov cloud', state: 'atrisk' }, { t: 9, d: 2, lbl: 'SOC2 II', state: 'planned' }] },
];
const DEFAULT_TODAY = 3.5;

export const ROADMAP_STATES = ['done', 'inflight', 'atrisk', 'planned'];
export const ROADMAP_LABELS = { done: 'Shipped', inflight: 'In-flight', atrisk: 'At risk', planned: 'Planned' };
// One palette, two render targets: oklch for the SVG canvas, hex for pptxgenjs
// (which can't parse oklch). Both legends + bars derive from the same maps so
// the canvas and the export can't drift.
export const ROADMAP_OKLCH = { done: 'oklch(0.62 0.13 155)', inflight: 'oklch(0.62 0.17 265)', atrisk: 'oklch(0.65 0.18 25)', planned: '#ddd' };
export const ROADMAP_HEX = { done: '27AE60', inflight: '6E5BE6', atrisk: 'E0533A', planned: 'CCCCCC' };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// Strict: only a real finite number passes (no +coercion), so null/''/true/[]
// fall back rather than becoming 0/1 — consistent with the todayIndex check.
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function normItem(it, span) {
  // t in [0, span-1] (leaving room for the bar); duration >= 1 but shrunk so the
  // bar never runs past the axis (t + d <= span).
  const t = clamp(num(it.t, 0), 0, Math.max(0, span - 1));
  const d = clamp(num(it.d, 1), 1, Math.max(1, span - t));
  return {
    t,
    d,
    lbl: it.lbl || '',
    state: ROADMAP_STATES.includes(it.state) ? it.state : 'planned',
  };
}

// Normalize a slide into a render-ready roadmap: { months, lanes, todayIndex }.
// todayIndex is null when neither the slide nor the demo default supplies one
// (so a custom roadmap doesn't get a spurious TODAY marker).
export function roadmapModel(slide) {
  const usingDefaultLanes = !Array.isArray(slide?.lanes);
  const months = Array.isArray(slide?.months) && slide.months.length ? slide.months : DEFAULT_MONTHS;
  const span = months.length;
  const lanes = (usingDefaultLanes ? DEFAULT_LANES : slide.lanes)
    .filter(Boolean)
    .map((lane) => ({
      name: lane.name || '',
      items: (Array.isArray(lane.items) ? lane.items : []).filter(Boolean).map((it) => normItem(it, span)),
    }));
  // A numeric slide-supplied index is clamped to the axis; otherwise the demo
  // gets its marker (3.5, in range for the 12-month default) and a custom
  // roadmap gets none. Number.isFinite (no coercion) rejects null/''/strings, so
  // an explicit `todayIndex: null` correctly means "no marker", not month 0.
  const todayIndex = Number.isFinite(slide?.todayIndex)
    ? clamp(slide.todayIndex, 0, span)
    : (usingDefaultLanes ? DEFAULT_TODAY : null);
  return { months, lanes, todayIndex };
}
