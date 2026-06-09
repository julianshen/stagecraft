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
    const slides = [...(sec.slides || [])]; // a section may carry no slides array
    slides.splice(Math.max(0, Math.min(toIndex, slides.length)), 0, slideId);
    return { ...sec, slides };
  });
  return { ...deck, sections };
}

let dupSeq = 0;
const uid = (p) => `${p}-${Date.now().toString(36)}-${(dupSeq++).toString(36)}`;
function newSlideId() { return uid('slide'); }

// Append a new empty section. Immutable; returns { deck, sectionId } (the id is
// handed back so the caller can focus/rename the fresh section) or null for a
// malformed deck. A blank name falls back to 'New section'.
export function addSection(deck, name) {
  if (!deck || !Array.isArray(deck.sections)) return null;
  const sectionId = uid('sec');
  const section = { id: sectionId, name: name?.trim() || 'New section', slides: [] };
  return { deck: { ...deck, sections: [...deck.sections, section] }, sectionId };
}

// Rename a section. Immutable; returns the SAME deck reference (so callers don't
// trigger a spurious state update / sync write) for a malformed deck, an unknown
// section, a blank name, or a name unchanged after trimming.
export function renameSection(deck, sectionId, name) {
  if (!deck || !Array.isArray(deck.sections)) return deck;
  const trimmed = name?.trim();
  const target = trimmed && deck.sections.find((sec) => sec.id === sectionId);
  if (!target || target.name === trimmed) return deck;
  const sections = deck.sections.map((sec) => (sec.id === sectionId ? { ...sec, name: trimmed } : sec));
  return { ...deck, sections };
}

// Delete a section, merging its slides into a neighbour so none are lost and the
// flattened order is preserved: a section's slides sit at the boundary they
// already occupy, so merging up (append to the previous section) or — for the
// first section — merging down (prepend to the next) leaves flattenDeck order
// byte-for-byte unchanged. Immutable; the slide pool is untouched. No-op
// (returns the deck unchanged) for a malformed deck, an unknown section, or the
// only remaining section (a deck keeps at least one section).
export function deleteSection(deck, sectionId) {
  if (!deck || !Array.isArray(deck.sections)) return deck;
  const i = deck.sections.findIndex((sec) => sec.id === sectionId);
  if (i < 0 || deck.sections.length <= 1) return deck;
  const targetIdx = i > 0 ? i - 1 : 1;
  const moved = deck.sections[i].slides || [];
  const sections = deck.sections
    .map((sec, idx) => {
      if (idx !== targetIdx) return sec;
      const own = sec.slides || [];
      // Merging up: removed section came after the target → append.
      // Merging down (removed section was first): it came before → prepend.
      return { ...sec, slides: i > 0 ? [...own, ...moved] : [...moved, ...own] };
    })
    .filter((_, idx) => idx !== i);
  return { ...deck, sections };
}

// Duplicate slide `slideId`: a deep clone with fresh ids (slide + its elements)
// inserted right after the original in its section. Immutable; returns
// { deck, newId } or null if the slide/deck can't be used. The caller may pass
// `newId` so two applications agree on the copy's id: decide + read `newId` from
// one call against the current deck, then re-apply with that same id through an
// onDeckChange updater against the freshest deck, and select it.
export function duplicateSlide(deck, slideId, newId = newSlideId()) {
  if (!deck || !Array.isArray(deck.slides) || !Array.isArray(deck.sections)) return null;
  const orig = deck.slides.find((s) => s.id === slideId);
  if (!orig) return null;
  const clone = JSON.parse(JSON.stringify(orig)); // deep copy — no shared nested refs
  clone.id = newId;
  if (Array.isArray(clone.elements)) clone.elements = clone.elements.map((e) => ({ ...e, id: uid('el') }));
  const sections = deck.sections.map((sec) => {
    if (!Array.isArray(sec.slides) || !sec.slides.includes(slideId)) return sec;
    const slides = [...sec.slides];
    slides.splice(slides.indexOf(slideId) + 1, 0, newId);
    return { ...sec, slides };
  });
  return { deck: { ...deck, slides: [...deck.slides, clone], sections }, newId };
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
