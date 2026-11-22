import { describe, it, expect, vi } from 'vitest';
import { validateChart, chartSchema } from './chart.js';
const chart = () => ({ kind: 'bar', categories: ['A', 'B'], series: [{ name: 'Sales', values: [1, -2] }] });
describe('portable native chart data', () => {
  it('copies valid bar/line data and supports bounded pie data', () => {
    const source = chart(), copy = validateChart(source); source.series[0].values[0] = 42;
    expect(copy.series[0].values).toEqual([1, -2]);
    expect(validateChart({ ...chart(), kind: 'line' }).kind).toBe('line');
    expect(validateChart({ kind: 'pie', categories: ['A'], series: [{ name: '', values: [0] }] }).kind).toBe('pie');
    expect(chartSchema.properties.kind.enum).toEqual(['bar', 'line', 'pie']);
  });
  it('rejects malformed, nonportable and formula-reference metadata', () => {
    const invalid = [null, { ...chart(), kind: 'scatter' }, { ...chart(), workbook: 'https://evil/' },
      { ...chart(), categories: [] }, { ...chart(), categories: Array(101).fill('A') },
      { ...chart(), series: Array(21).fill(chart().series[0]) }, { ...chart(), kind: 'pie' },
      { kind: 'pie', categories: ['A'], series: [{ name: 'A', values: [1] }, { name: 'B', values: [2] }] },
      { ...chart(), series: [{ name: 'A', values: [NaN, 1] }] }, { ...chart(), series: [{ name: 'A', values: [Infinity, 1] }] },
      { ...chart(), series: [{ name: 'A', values: [1] }] }, { ...chart(), categories: ['\u0000', 'A'] },
      { ...chart(), categories: ['\ud800', 'A'] }, { ...chart(), categories: ['x'.repeat(1001), 'A'] }];
    for (const value of invalid) expect(() => validateChart(value)).toThrow('INVALID_CHART');
  });
  it('never invokes getters or accepts non-JSON array entries', () => {
    const getter = vi.fn(); const value = chart(); Object.defineProperty(value, 'kind', { enumerable: true, get: getter });
    expect(() => validateChart(value)).toThrow('INVALID_CHART'); expect(getter).not.toHaveBeenCalled();
    const sparse = chart(); delete sparse.series[0].values[0]; expect(() => validateChart(sparse)).toThrow('INVALID_CHART');
  });
});
