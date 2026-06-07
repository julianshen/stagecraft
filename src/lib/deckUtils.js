export function getFlatSlideIds(deck) {
  if (!deck) return [];
  const flat = [];
  (deck.sections || []).forEach(sec => (sec?.slides || []).forEach(sid => flat.push(sid)));
  return flat;
}

/**
 * Decide which slide should be selected after the deck changes.
 *
 * @param flat     flattened slide-id order of the new deck (getFlatSlideIds)
 * @param curId    the currently-selected slide id (or null)
 * @param deleting { id, idx } when the change was the editor deleting `id` at
 *                 flat position `idx`, else null
 * @returns the slide id to select (or null)
 *
 * - On a local delete of the selected slide, keep the position (the slide that
 *   slid into `idx`, else the previous one).
 * - If the selected slide vanished for any other reason — e.g. a live MCP/agent
 *   edit removed it — fall back to the first slide.
 * - Otherwise leave the selection unchanged.
 */
export function reconcileCurId(flat, curId, deleting) {
  if (deleting && curId === deleting.id) {
    return flat[deleting.idx] ?? flat[deleting.idx - 1] ?? flat[0] ?? null;
  }
  if (curId && !flat.includes(curId)) {
    return flat[0] ?? null;
  }
  return curId;
}
