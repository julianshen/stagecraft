import { describe, it, expect } from 'vitest';
import { chartSpec, chartData, renameCategory, renameSeries, CHART_SERIES_OKLCH, CHART_SERIES_HEX } from './chartSpec.js';
import { oklchToHex } from '../test/oklchToHex.js';

describe('renameSeries — inline chart series-name edit', () => {
  it('renames the target series and returns the full model with categories + other series intact', () => {
    const slide = { chart: { categories: ['A', 'B'], series: [{ name: 'S1', values: [1, 2] }, { name: 'S2', values: [3, 4] }] } };
    const patch = renameSeries(slide, 1, 'Renamed');
    expect(patch.chart.series.map((s) => s.name)).toEqual(['S1', 'Renamed']);
    expect(patch.chart.series[0]).toEqual({ name: 'S1', values: [1, 2] }); // other series intact
    expect(patch.chart.categories).toEqual(['A', 'B']); // categories carried, not dropped
  });

  it('materializes a data-less chart so renaming the series keeps the default categories', () => {
    const patch = renameSeries({}, 0, 'Metrics');
    expect(patch.chart.series[0].name).toBe('Metrics');
    expect(patch.chart.categories).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
  });

  it('is a no-op for an out-of-range series index', () => {
    const slide = { chart: { categories: ['A'], series: [{ name: 'S', values: [1] }] } };
    expect(renameSeries(slide, 9, 'X').chart.series.map((s) => s.name)).toEqual(['S']);
  });
});

describe('renameCategory — inline chart category-label edit', () => {
  it('renames the target category and returns the full {chart:{categories,series}} model', () => {
    const slide = { chart: { categories: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] } };
    const patch = renameCategory(slide, 0, 'A2');
    expect(patch.chart.categories).toEqual(['A2', 'B']);
    expect(patch.chart.series).toEqual([{ name: 'S', values: [1, 2] }]); // series carried, not dropped
  });

  it('materializes a data-less chart so renaming one category keeps the default series', () => {
    // No slide.chart → chartData falls back to DEFAULT_CATEGORIES + DEFAULT_SERIES.
    // A sparse {chart:{categories}} commit would drop the default series; the full
    // model must carry them.
    const patch = renameCategory({}, 0, 'Jan');
    expect(patch.chart.categories).toEqual(['Jan', 'Q2', 'Q3', 'Q4']);
    // the default series is materialized + carried (not dropped), aligned to the
    // categories — assert the shape, not the exact DEFAULT_SERIES numbers.
    expect(patch.chart.series).toHaveLength(1);
    expect(typeof patch.chart.series[0].name).toBe('string');
    expect(patch.chart.series[0].values).toHaveLength(4);
  });

  it('is a no-op rename for an out-of-range index', () => {
    const slide = { chart: { categories: ['A'], series: [{ name: 'S', values: [1] }] } };
    expect(renameCategory(slide, 9, 'X').chart.categories).toEqual(['A']);
  });
});

describe('chart series palette', () => {
  it('is one ordered palette in two render targets (oklch canvas + hex export), aligned by index', () => {
    expect(CHART_SERIES_OKLCH.length).toBe(CHART_SERIES_HEX.length);
    expect(CHART_SERIES_OKLCH.length).toBeGreaterThanOrEqual(4);
    CHART_SERIES_OKLCH.forEach((c) => expect(c).toMatch(/^oklch\(/));
    CHART_SERIES_HEX.forEach((c) => expect(c).toMatch(/^[0-9A-F]{6}$/i));
    // Frozen so a consumer can't mutate the shared source of truth.
    expect(Object.isFrozen(CHART_SERIES_OKLCH)).toBe(true);
    expect(Object.isFrozen(CHART_SERIES_HEX)).toBe(true);
  });

  it('keeps each hex the exact sRGB of its oklch sibling, so the two cannot drift', () => {
    expect(CHART_SERIES_OKLCH.map(oklchToHex)).toEqual(CHART_SERIES_HEX);
  });
});

describe('chartData', () => {
  it('returns defaults when the slide carries no chart data', () => {
    const { categories, series } = chartData({});
    expect(categories.length).toBeGreaterThan(0);
    expect(series).toHaveLength(1);
    expect(series[0].values.length).toBe(categories.length);
  });

  it('coerces non-numeric values to 0', () => {
    const d = chartData({ chart: { categories: ['a', 'b', 'c'], series: [{ values: [5, 'oops', null] }] } });
    expect(d.series[0].values).toEqual([5, 0, 0]);
  });

  it('tolerates a null/undefined slide', () => {
    for (const arg of [null, undefined]) {
      const { categories, series } = chartData(arg);
      expect(categories.length).toBeGreaterThan(0);
      expect(series[0].values.length).toBe(categories.length);
    }
  });

  it('normalizes categories + series, padding/clipping values to the category count', () => {
    const d = chartData({ chart: { categories: ['a', 'b', 'c'], series: [{ name: 'S', values: [1] }, { values: [9, 8, 7, 6] }] } });
    expect(d.categories).toEqual(['a', 'b', 'c']);
    expect(d.series[0]).toEqual({ name: 'S', values: [1, 0, 0] });   // padded
    expect(d.series[1]).toEqual({ name: 'Series 2', values: [9, 8, 7] }); // clipped + named
  });
});

describe('chartSpec', () => {
  it('maps chartType to a pptxgenjs chart type, mirroring the canvas renderer', () => {
    expect(chartSpec({ chartType: 'bar' }).type).toBe('bar');
    expect(chartSpec({ chartType: 'line' }).type).toBe('line');
    expect(chartSpec({ chartType: 'area' }).type).toBe('area');
    expect(chartSpec({ chartType: 'donut' }).type).toBe('doughnut');
    expect(chartSpec({ chartType: 'pie' }).type).toBe('doughnut');  // canvas draws a donut for pie
    expect(chartSpec({ chartType: 'mystery' }).type).toBe('line');  // unknown → line (renderer default)
    expect(chartSpec({}).type).toBe('line');                        // missing → line (renderer default)
  });

  it('exports bar charts as vertical columns (barDir col), matching the canvas', () => {
    expect(chartSpec({ chartType: 'bar' }).barDir).toBe('col');
    expect(chartSpec({ chartType: 'line' }).barDir).toBeUndefined();
  });

  it('pads a series shorter than the categories so values align with labels', () => {
    const slide = { chartType: 'bar', chart: { categories: ['a', 'b', 'c'], series: [{ name: 'S', values: [5] }] } };
    expect(chartSpec(slide).data[0].values).toEqual([5, 0, 0]);
  });

  it('uses default categories/series when the slide carries no chart data', () => {
    const { data } = chartSpec({ chartType: 'bar' });
    expect(data).toHaveLength(1);
    expect(data[0].labels.length).toBeGreaterThan(0);
    expect(data[0].values.length).toBe(data[0].labels.length);
  });

  it('maps the slide chart data into pptxgenjs series ({name,labels,values})', () => {
    const slide = {
      chartType: 'line',
      chart: {
        categories: ['Jan', 'Feb', 'Mar'],
        series: [
          { name: 'Plan', values: [10, 20, 30] },
          { name: 'Actual', values: [12, 18, 33] },
        ],
      },
    };
    const { type, data } = chartSpec(slide);
    expect(type).toBe('line');
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ name: 'Plan', labels: ['Jan', 'Feb', 'Mar'], values: [10, 20, 30] });
    expect(data[1].name).toBe('Actual');
  });

  it('truncates a series longer than the categories', () => {
    const slide = { chartType: 'bar', chart: { categories: ['a', 'b'], series: [{ name: 'S', values: [1, 2, 3, 4] }] } };
    expect(chartSpec(slide).data[0].values).toEqual([1, 2]);
  });

  it('tolerates a null/undefined series element', () => {
    const slide = { chartType: 'bar', chart: { categories: ['a', 'b'], series: [null, { name: 'S', values: [1, 2] }] } };
    const { data } = chartSpec(slide);
    expect(data[0]).toEqual({ name: 'Series 1', labels: ['a', 'b'], values: [0, 0] });
    expect(data[1].name).toBe('S');
  });

  it('keeps only a single series for pie / doughnut', () => {
    const multi = { categories: ['a', 'b'], series: [{ name: 'S1', values: [1, 2] }, { name: 'S2', values: [3, 4] }] };
    expect(chartSpec({ chartType: 'pie', chart: multi }).data).toHaveLength(1);
    expect(chartSpec({ chartType: 'donut', chart: multi }).data).toHaveLength(1);
  });

  it('names unnamed series and tolerates missing values (padded to categories)', () => {
    const slide = { chartType: 'bar', chart: { categories: ['a'], series: [{}] } };
    const s = chartSpec(slide).data[0];
    expect(s.name).toBe('Series 1');
    expect(s.values).toEqual([0]); // padded to the single category
  });
});
