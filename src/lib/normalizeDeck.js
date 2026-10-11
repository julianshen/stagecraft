// Upgrade a deck written by an older version of the model to the current one.
// Pure and idempotent: anything already current comes back as the same object,
// so callers can normalize on every write without churning references (the
// sync loop compares decks by identity). Every way a deck enters the store —
// the persisted snapshot, PUT/POST bodies, MCP slide writes, AI patches —
// runs through here, so the renderer and exporter only ever see the current
// shape.
//
// Migrations:
// - A text element's ink moved from `fill` to `color` (A3), freeing `fill` to
//   mean the text box's own fill, as on every other shape. A `fill` without a
//   `color` is legacy ink and becomes the `color`. With both, the `fill` is a
//   box fill, which nothing renders or exports yet (F-TXT-2), so it's dropped —
//   matching the gate, which rejects a text `fill` until then.

export function normalizeElement(el) {
  if (!el || typeof el !== 'object' || el.type !== 'text' || el.fill === undefined) return el;
  const { fill, ...rest } = el;
  return rest.color === undefined ? { ...rest, color: fill } : rest;
}

export function normalizeSlide(slide) {
  if (!slide || !Array.isArray(slide.elements)) return slide;
  const elements = slide.elements.map(normalizeElement);
  return elements.some((el, i) => el !== slide.elements[i]) ? { ...slide, elements } : slide;
}

export function normalizeDeck(deck) {
  if (!deck || !Array.isArray(deck.slides)) return deck;
  const slides = deck.slides.map(normalizeSlide);
  return slides.some((s, i) => s !== deck.slides[i]) ? { ...deck, slides } : deck;
}
