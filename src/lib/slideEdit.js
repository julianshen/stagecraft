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

  // Clone the existing container, or create one whose SHAPE matches the next
  // path segment — a numeric segment needs an array (so a missing branch under
  // a numeric index doesn't become an object like {1:{0:'X'}}).
  const container = (existing, nextKey) =>
    Array.isArray(existing) ? existing.slice()
      : existing != null ? { ...existing }
        : (typeof nextKey === 'number' ? [] : {});

  const root = container(slide[key], rest[0]);
  let node = root;
  for (let i = 0; i < rest.length - 1; i++) {
    node[rest[i]] = container(node[rest[i]], rest[i + 1]);
    node = node[rest[i]];
  }
  node[rest[rest.length - 1]] = value;
  // Drop null/undefined holes from the rebuilt array. The renderer maps the
  // ORIGINAL (possibly sparse) array to keep the edited index correct, but the
  // committed array must be hole-free or the schema gate rejects it — the edit
  // lands on the right item, then the array is compacted in one step.
  return { [key]: Array.isArray(root) ? root.filter((x) => x != null) : root };
}
