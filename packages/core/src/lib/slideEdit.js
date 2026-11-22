import { sanitizeSlidePatch, applySlidePatch } from './deckUtils.js';
import { assignElementIds, clampElement, mergeOverlay } from './elements.js';

// Prepare an AI slide patch for application. For a patch that sets `elements`
// (the free-form overlay), the order is **mint ids → validate → clamp**: ids are
// minted on the RAW elements first (the gate requires an id, and adding one can't
// launder a bad geometry value, so strict validation still runs on raw x/y/w/h),
// then the validated survivors are clamped to the slide like a manual create.
// `genId` is injected so ids are minted outside any reducer (StrictMode-safe) and
// tests stay deterministic. Returns `{ patch, applied }` — `patch` ready to merge,
// `applied` the field keys that survived the gate (so a caller can report what
// actually changed). Non-element patches pass through the normal gate unchanged.
export function prepareAIPatch(rawPatch, layout, genId) {
  const seeded = Array.isArray(rawPatch?.elements)
    ? { ...rawPatch, elements: assignElementIds(rawPatch.elements, genId) }
    : rawPatch;
  const safe = sanitizeSlidePatch(seeded, layout);
  const patch = Array.isArray(safe.elements)
    ? { ...safe, elements: safe.elements.map((el) => clampElement(el)) }
    : safe;
  // A non-empty all-image elements array is no overlay edit — the model can't
  // author images and the merge drops them, so applying it would only wipe the
  // existing text/shape/line overlay. Drop the field (an empty array stays a
  // genuine clear). Avoids both the data loss and a phantom "applied" report.
  if (Array.isArray(patch.elements) && patch.elements.length > 0
      && patch.elements.every((el) => el.type === 'image')) {
    delete patch.elements;
  }
  return { patch, applied: Object.keys(patch) };
}

// Apply a prepared patch to slide `targetId` in `deck` (no-op if it's gone).
// When the patch sets `elements`, existing image elements are preserved
// (`mergeOverlay`) — the Co-pilot can't round-trip their data URLs — so the AI
// overlay replaces only the text/shape/line layer. Returns a new deck.
export function applyPreparedPatch(deck, targetId, patch) {
  if (!(deck?.slides || []).some((s) => s.id === targetId)) return deck;
  const merged = Array.isArray(patch.elements)
    ? { ...patch, elements: mergeOverlay(deck.slides.find((s) => s.id === targetId)?.elements, patch.elements) }
    : patch;
  return applySlidePatch(deck, targetId, merged);
}

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
