export { SAMPLE_DECK, ACCENTS, TEMPLATES, resolveNotes } from './data/deck.js';export { flattenDeck } from './lib/deckOrder.js';
export { normalizeDeck } from './lib/normalizeDeck.js';
export { slideDims } from './lib/slideDims.js';
export {
  validateChart,
  chartSchema
} from './document/chart.js';
export { createEditor, EditorError, cloneJson } from './editor/index.js';
export { createDocument, validateDocument, DocumentError, migrateLegacyDeck, toLegacyDeck, documentPlugin, presentationPlugin, validateAuthoredObject, validateAuthoredSlide } from './document/index.js';
