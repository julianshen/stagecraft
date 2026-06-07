export function getFlatSlideIds(deck) {
  if (!deck) return [];
  const flat = [];
  (deck.sections || []).forEach(sec => (sec?.slides || []).forEach(sid => flat.push(sid)));
  return flat;
}
