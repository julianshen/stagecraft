// Maps a chart slide to a pptxgenjs addChart() spec (chart type + data series).
// Pure and unit-tested; the actual sld.addChart() call lives in pptxExport.js.

// Mirror the canvas renderer (ChartByType in SlideRenderer.jsx) so the exported
// chart matches what's on screen: bar → vertical columns (pptxgenjs 'bar' is
// horizontal by default, so barDir 'col'); donut AND pie both draw as a donut;
// anything else — including a missing chartType — falls through to a line chart.
const TYPE_MAP = {
  bar: { type: 'bar', barDir: 'col' },
  area: { type: 'area' },
  donut: { type: 'doughnut' },
  pie: { type: 'doughnut' },
  line: { type: 'line' },
};

// Sensible defaults so a chart slide with no data still exports a real chart.
const DEFAULT_CATEGORIES = ['Q1', 'Q2', 'Q3', 'Q4'];
const DEFAULT_SERIES = [{ name: 'Coverage', values: [112, 131, 149, 184] }];

// One ordered series palette in two render targets: oklch for the SVG canvas,
// hex for the PPTX export (pptxgenjs can't parse oklch). Same order, so a given
// series gets the same colour on screen and in the export — the export mirrors
// the canvas. Each hex is the exact sRGB of its oklch sibling (OKLab→linear
// sRGB→gamma, D65) — a test recomputes the conversion and asserts equality, so
// editing one array without regenerating the other fails CI.
export const CHART_SERIES_OKLCH = Object.freeze(['oklch(0.62 0.17 265)', 'oklch(0.62 0.13 155)', 'oklch(0.7 0.15 75)', 'oklch(0.6 0.18 335)', 'oklch(0.55 0.12 200)', 'oklch(0.6 0.14 25)']);
export const CHART_SERIES_HEX = Object.freeze(['537FEB', '349D62', 'D48E00', 'BE4DAA', '00858D', 'C65954']);

// Normalized chart data for a slide — shared by the PPTX exporter (chartSpec)
// and the on-canvas chart renderers so both draw the same numbers. Falls back to
// sensible defaults; clips an over-long series and pads a short one with 0 so
// every series aligns with the categories.
// The chart pipeline's numeric policy: anything non-finite becomes 0.
export const coerceNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function chartData(slide) {
  const chart = (slide && slide.chart) || {};
  const categories = Array.isArray(chart.categories) && chart.categories.length ? chart.categories : DEFAULT_CATEGORIES;
  const rawSeries = Array.isArray(chart.series) && chart.series.length ? chart.series : DEFAULT_SERIES;
  const n = categories.length;
  const series = rawSeries.map((s, i) => {
    // Coerce to finite numbers (non-numeric → 0) so neither the SVG coords nor
    // the pptxgenjs chart XML get NaN; clip to and pad to the category count.
    const values = (s && Array.isArray(s.values) ? s.values : []).slice(0, n).map(coerceNum);
    while (values.length < n) values.push(0);
    return { name: (s && s.name) || `Series ${i + 1}`, values };
  });
  return { categories, series };
}

export function chartSpec(slide) {
  const m = TYPE_MAP[slide?.chartType] || TYPE_MAP.line; // renderer defaults unknown/missing to line
  const { categories, series } = chartData(slide);
  // pptxgenjs wants [{ name, labels, values }].
  const data = series.map((s) => ({ name: s.name, labels: categories, values: s.values }));
  const single = m.type === 'doughnut';
  return { type: m.type, ...(m.barDir ? { barDir: m.barDir } : {}), data: single ? data.slice(0, 1) : data };
}
