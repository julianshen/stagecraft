// Deck ordering utilities.
// The deck stores slides in a flat `slides` pool; `sections[].slides` (arrays of
// slide ids) define the render order. flattenDeck resolves that into the ordered
// list the UI iterates over. A slide not referenced by any section is omitted.

export function flattenDeck(deck) {
  const arr = [];
  if (!deck || !Array.isArray(deck.sections) || !Array.isArray(deck.slides)) return arr;
  deck.sections.forEach((sec) => {
    (sec.slides || []).forEach((sid) => {
      const s = deck.slides.find((x) => x.id === sid);
      if (s) arr.push({ ...s, sectionId: sec.id, sectionName: sec.name });
    });
  });
  return arr;
}
