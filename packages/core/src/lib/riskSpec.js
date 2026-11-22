// Risk severity palette — one keyed palette in two render targets, the same
// canvas↔export-parity approach as the chart (CHART_SERIES_*) and roadmap
// (ROADMAP_*) palettes: oklch for the SVG/CSS canvas, hex for pptxgenjs (which
// can't parse oklch). The canvas colours are the source of truth; each hex is
// the exact sRGB of its oklch sibling (OKLab→linear sRGB→gamma, D65) — a test
// recomputes the conversion and asserts equality, so editing one map without
// regenerating the other fails CI. `fallback` colours an unknown severity.

export const SEVERITIES = Object.freeze(['high', 'med', 'low']);

// A traffic-light ramp — red (high) / amber (med) / green (low), the
// universally-read risk-matrix convention. (`low` was previously the canvas's
// blue accent; it's now green so the three severities read as stop/caution/go.)
export const SEVERITY_OKLCH = Object.freeze({
  high: 'oklch(0.55 0.2 25)',
  med: 'oklch(0.65 0.15 75)',
  low: 'oklch(0.62 0.15 150)',
  fallback: '#aaa',
});

export const SEVERITY_HEX = Object.freeze({
  high: 'CC272E',
  med: 'C37F00',
  low: '2E9E52',
  fallback: 'AAAAAA',
});
