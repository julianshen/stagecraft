export function getFlatSlideIds(deck) {
  const flat = [];
  (deck.sections || []).forEach(sec => (sec?.slides || []).forEach(sid => flat.push(sid)));
  return flat;
}
