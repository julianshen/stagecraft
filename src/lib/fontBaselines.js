// Per-(layout, field) canvas default font size, in px of the 1920×1080 authoring
// space. Single-sourced between the renderer (which sizes the field) and the PPTX
// export, which scales its own hand-tuned pt baseline by the user's fmt.fontSize ÷
// this baseline — so a field resized on the canvas exports at the same proportion
// (the two surfaces are independently laid out, so a ratio, not absolute px, is
// what carries across). Extend per layout/field as parity is wired (text first).
export const CANVAS_BASELINE_PX = Object.freeze({
  cover: Object.freeze({ title: 140 }),
  divider: Object.freeze({ title: 140 }),
  text: Object.freeze({ title: 84, body: 32 }),
  // Per-item fields are keyed by field-TYPE (the baseline is the same for every
  // row); the export reads the per-index fmt (items.0.t …) against it.
  agenda: Object.freeze({ title: 96, 'items.n': 36, 'items.t': 38, 'items.d': 22 }),
  list: Object.freeze({ title: 84, items: 38 }),
  // The remaining layouts' titles all render at 72px on the canvas — except thanks,
  // whose title <span> inherits its 220px wrapping <h1>. Each builder's export pt
  // baseline differs, so the canvas↔export ratio still carries per-layout.
  // kpi/split/risks also carry their per-item data fields, keyed by field-type like
  // agenda above (every row shares the canvas px; the export reads the per-index fmt).
  kpi: Object.freeze({ title: 72, 'kpis.val': 68, 'kpis.label': 16, 'kpis.delta': 14 }),
  chart: Object.freeze({ title: 72 }),
  split: Object.freeze({ title: 72, 'stats.val': 72, 'stats.lbl': 20 }),
  table: Object.freeze({ title: 72 }),
  risks: Object.freeze({ title: 72, 'items.t': 36, 'items.d': 24 }),
  roadmap: Object.freeze({ title: 72 }),
  thanks: Object.freeze({ title: 220 }),
});
