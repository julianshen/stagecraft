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
  return { [key]: root };
}
// NB: a rebuilt array keeps any null/undefined holes from the source. For the
// independent-item arrays (items/kpis/stats) that just means the schema gate
// rejects the patch and EditableText reverts the edit (non-corrupting) — we do
// NOT compact holes, because `columns` runs parallel to every row's cells, so
// dropping a column hole without dropping the matching cell would misalign the
// table. Holey arrays are a malformed edge; well-formed decks never hit this.
