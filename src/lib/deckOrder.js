// Deck ordering utilities.
// The deck stores slides in a flat `slides` pool; `sections[].slides` (arrays of
// slide ids) define the render order. flattenDeck resolves that into the ordered
// list the UI iterates over. A slide not referenced by any section is omitted.

// Move a slide to position `toIndex` within section `toSectionId` (within its
// current section or across sections), updating `sections[].slides` membership.
// `toIndex` is the index in the target section AFTER the slide is removed from
// its source; it's clamped to the section bounds. Immutable; returns the deck
// unchanged if the slide or the target section can't be found.
export function moveSlide(deck, slideId, toSectionId, toIndex) {
  if (!deck || !Array.isArray(deck.sections)) return deck;
  let found = false;
  const stripped = deck.sections.map((sec) => {
    if (Array.isArray(sec.slides) && sec.slides.includes(slideId)) {
      found = true;
      return { ...sec, slides: sec.slides.filter((id) => id !== slideId) };
    }
    return sec;
  });
  if (!found || !stripped.some((sec) => sec.id === toSectionId)) return deck;
  const sections = stripped.map((sec) => {
    if (sec.id !== toSectionId) return sec;
    const slides = [...sec.slides];
    slides.splice(Math.max(0, Math.min(toIndex, slides.length)), 0, slideId);
    return { ...sec, slides };
  });
  return { ...deck, sections };
}

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
