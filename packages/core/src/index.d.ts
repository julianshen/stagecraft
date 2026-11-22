// Public surface of @stagecraft/core.
//
// The typed core is `./editor` and `./document`; their declarations are re-exported here verbatim.
// The legacy deck helpers (`data/deck`, `lib/*`) predate the canonical document model and have no
// declaration files of their own, so they are declared provisionally below with the shapes the
// runtime actually exposes. Tighten these when the legacy layer is retired — they exist so that
// strict TypeScript consumers of `@stagecraft/core` get real types instead of "no declaration file".

export * from './editor/index.js';
export type * from './document/index.js';
export { createDocument, validateDocument, DocumentError, migrateLegacyDeck, toLegacyDeck,
  documentPlugin, presentationPlugin, validateAuthoredObject, validateAuthoredSlide,
  validateChart, chartSchema } from './document/index.js';

export interface AccentDefinition {
  name: string;
  /** OKLCH chroma used to build `--accent` values. */
  chroma: number;
  /** OKLCH hue in degrees. */
  hue: number;
  /** Other host-facing fields the palette carries. */
  [key: string]: unknown;
}

export interface LegacyElement {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rot?: number;
  content?: string;
  fill?: string;
  [key: string]: unknown;
}

export interface LegacySlide {
  id?: string;
  title?: string;
  layout?: string;
  elements?: LegacyElement[];
  [key: string]: unknown;
}

export interface LegacySection {
  id?: string;
  name?: string;
  slides?: string[];
  [key: string]: unknown;
}

/** Legacy flat deck: a slide pool plus sections that order it (pre-canonical model). */
export interface LegacyDeckDocument {
  title?: string;
  size?: { w?: number; h?: number };
  sections?: LegacySection[];
  slides?: LegacySlide[];
  theme?: unknown;
  [key: string]: unknown;
}

/** Built-in starting deck shipped with the app. */
export const SAMPLE_DECK: LegacyDeckDocument;
/** Accent palette keyed by accent id (e.g. `indigo`). */
export const ACCENTS: Record<string, AccentDefinition>;
/** Template decks offered by the template picker. */
export const TEMPLATES: ReadonlyArray<{ id: string; name: string; [key: string]: unknown }>;
/** Resolve a slide's speaker notes from the legacy deck shape. */
export function resolveNotes(slide: LegacySlide | null | undefined, fallback?: string): string;

/** Resolve the render order of a legacy deck (sections → slides). */
export function flattenDeck(deck: LegacyDeckDocument): Array<LegacySlide & { sectionId?: string; sectionName?: string }>;
/** Normalise a legacy deck to the shape the editor expects. */
export function normalizeDeck(deck: LegacyDeckDocument): LegacyDeckDocument;
/** Slide dimensions in px for a deck, honouring its size. */
export function slideDims(deck?: LegacyDeckDocument): { w: number; h: number };
