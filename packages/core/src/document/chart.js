import { cloneJson } from '../editor/index.js';

const fail = () => { const error = new Error('INVALID_CHART'); error.code = 'INVALID_CHART'; throw error; };
const textSchema = { type: 'string', maxLength: 1000 };
/** Portable authoring subset. Cross-array lengths and XML text validity are checked by validateChart. */
export const chartSchema = {
  type: 'object', additionalProperties: false, required: ['kind', 'categories', 'series'],
  properties: {
    kind: { enum: ['bar', 'line', 'pie'] },
    categories: { type: 'array', minItems: 1, maxItems: 100, items: textSchema },
    series: { type: 'array', minItems: 1, maxItems: 20, items: {
      type: 'object', additionalProperties: false, required: ['name', 'values'],
      properties: { name: textSchema, values: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'number' } } },
    } },
  },
  allOf: [{ if: { properties: { kind: { const: 'pie' } } }, then: { properties: {
    series: { maxItems: 1, items: { properties: { values: { items: { type: 'number', minimum: 0 } } } } },
  } } }],
};
function record(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();
}
function text(value) {
  if (typeof value !== 'string' || value.length > 1000) fail();
  for (const c of value) {
    const n = c.codePointAt(0);
    if (!(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0xd7ff || n >= 0xe000 && n <= 0xfffd || n >= 0x10000 && n <= 0x10ffff)) fail();
  }
}
/** Validate and copy data; no executable/accessor objects or external references are accepted. */
export function validateChart(value) {
  let chart;
  try { chart = cloneJson(value); } catch { fail(); }
  record(chart, ['kind', 'categories', 'series']);
  if (!['bar', 'line', 'pie'].includes(chart.kind) || !Array.isArray(chart.categories) || chart.categories.length < 1 || chart.categories.length > 100 ||
      !Array.isArray(chart.series) || chart.series.length < 1 || chart.series.length > 20 || chart.kind === 'pie' && chart.series.length !== 1) fail();
  chart.categories.forEach(text);
  for (const series of chart.series) {
    record(series, ['name', 'values']); text(series.name);
    if (!Array.isArray(series.values) || series.values.length !== chart.categories.length ||
        series.values.some(value => !Number.isFinite(value) || chart.kind === 'pie' && value < 0)) fail();
  }
  return chart;
}
