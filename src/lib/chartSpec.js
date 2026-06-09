// Maps a chart slide to a pptxgenjs addChart() spec (chart type + data series).
// Pure and unit-tested; the actual sld.addChart() call lives in pptxExport.js.

// The app's bar chart renders as vertical columns, so bar/column export with
// barDir 'col' for canvas↔PPTX parity (pptxgenjs 'bar' is horizontal by default).
const TYPE_MAP = {
  bar: { type: 'bar', barDir: 'col' },
  column: { type: 'bar', barDir: 'col' },
  line: { type: 'line' },
  area: { type: 'area' },
  pie: { type: 'pie' },
  donut: { type: 'doughnut' },
  doughnut: { type: 'doughnut' },
};

// Sensible defaults so a chart slide with no data still exports a real chart.
const DEFAULT_CATEGORIES = ['Q1', 'Q2', 'Q3', 'Q4'];
const DEFAULT_SERIES = [{ name: 'Coverage', values: [112, 131, 149, 184] }];

export function chartSpec(slide) {
  const m = TYPE_MAP[slide?.chartType] || TYPE_MAP.bar;
  const chart = (slide && slide.chart) || {};
  const categories = Array.isArray(chart.categories) && chart.categories.length ? chart.categories : DEFAULT_CATEGORIES;
  const rawSeries = Array.isArray(chart.series) && chart.series.length ? chart.series : DEFAULT_SERIES;
  const n = categories.length;
  // pptxgenjs wants [{ name, labels, values }] with values aligned to labels —
  // clip an over-long series and pad a short one with 0 (a mismatch corrupts the chart XML).
  const data = rawSeries.map((s, i) => {
    const values = (s && Array.isArray(s.values) ? s.values : []).slice(0, n);
    while (values.length < n) values.push(0);
    return { name: (s && s.name) || `Series ${i + 1}`, labels: categories, values };
  });
  const single = m.type === 'pie' || m.type === 'doughnut';
  return { type: m.type, ...(m.barDir ? { barDir: m.barDir } : {}), data: single ? data.slice(0, 1) : data };
}
