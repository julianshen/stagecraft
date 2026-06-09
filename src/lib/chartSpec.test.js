import { describe, it, expect } from 'vitest';
import { chartSpec } from './chartSpec.js';

describe('chartSpec', () => {
  it('maps chartType to a pptxgenjs chart type (bar default)', () => {
    expect(chartSpec({ chartType: 'bar' }).type).toBe('bar');
    expect(chartSpec({ chartType: 'column' }).type).toBe('bar');
    expect(chartSpec({ chartType: 'line' }).type).toBe('line');
    expect(chartSpec({ chartType: 'area' }).type).toBe('area');
    expect(chartSpec({ chartType: 'pie' }).type).toBe('pie');
    expect(chartSpec({ chartType: 'donut' }).type).toBe('doughnut');
    expect(chartSpec({ chartType: 'mystery' }).type).toBe('bar'); // unknown → bar
    expect(chartSpec({}).type).toBe('bar');                        // missing → bar
  });

  it('exports bar/column charts as vertical columns (barDir col), matching the canvas', () => {
    expect(chartSpec({ chartType: 'bar' }).barDir).toBe('col');
    expect(chartSpec({ chartType: 'column' }).barDir).toBe('col');
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

  it('keeps only a single series for pie / doughnut', () => {
    const slide = { chartType: 'pie', chart: { categories: ['a', 'b'], series: [{ name: 'S1', values: [1, 2] }, { name: 'S2', values: [3, 4] }] } };
    expect(chartSpec(slide).data).toHaveLength(1);
  });

  it('names unnamed series and tolerates missing values (padded to categories)', () => {
    const slide = { chartType: 'bar', chart: { categories: ['a'], series: [{}] } };
    const s = chartSpec(slide).data[0];
    expect(s.name).toBe('Series 1');
    expect(s.values).toEqual([0]); // padded to the single category
  });
});
