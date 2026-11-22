import { jsonEqual } from './jsonEqual.js';

it('compares JSON objects independently of key order and preserves array order', () => {
  expect(jsonEqual({ a: 1, b: { c: [2, 3] } }, { b: { c: [2, 3] }, a: 1 })).toBe(true);
  expect(jsonEqual([2, 3], [3, 2])).toBe(false);
  expect(jsonEqual({ a: null }, { a: false })).toBe(false);
  expect(jsonEqual({ a: 1 }, { b: 1 })).toBe(false);
  expect(jsonEqual({}, { a: 1 })).toBe(false);
  expect(jsonEqual([], {})).toBe(false);
  expect(jsonEqual(null, {})).toBe(false);
});
