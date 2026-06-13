// Build a slide patch for an inline text edit. `applySlidePatch` shallow-merges
// the patch over the slide, so a nested edit (an item, a table cell) must carry
// the WHOLE rebuilt top-level field. `fieldPatch` walks `path` from the slide,
// cloning each container along the way (immutable — siblings keep their
// identity), and returns `{ [topLevelKey]: rebuiltValue }`.
//
//   fieldPatch(slide, ['title'], 'X')        -> { title: 'X' }
//   fieldPatch(slide, ['items', 2, 't'], 'X') -> { items: [...with [2].t = 'X'] }
//   fieldPatch(slide, ['rows', 1, 0], 'X')    -> { rows: [...with [1][0] = 'X'] }
export function fieldPatch(slide, path, value) {
  const [key, ...rest] = path;
  if (rest.length === 0) return { [key]: value };

  const clone = (v) => (Array.isArray(v) ? v.slice() : { ...(v || {}) });
  const root = clone(slide[key]);
  let node = root;
  for (let i = 0; i < rest.length - 1; i++) {
    node[rest[i]] = clone(node[rest[i]]);
    node = node[rest[i]];
  }
  node[rest[rest.length - 1]] = value;
  return { [key]: root };
}
