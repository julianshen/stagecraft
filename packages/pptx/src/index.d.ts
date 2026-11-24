import type { ByteSource, FormatAdapter } from '@stagecraft/io';
import type { ZipOptions } from '@stagecraft/io/zip';
/** Stagecraft's existing deck-shaped editable subset. Source OOXML is not retained. */
export interface Deck { title?: string; author?: string; subtitle?: string; theme?: string; sections: Array<Record<string, any>>; slides: Array<Record<string, any>>; [key: string]: any }
/** A host XML implementation with browser-compatible Element children and iterable NodeLists/attributes. */
export interface XmlRuntime { parse(text: string): Document; serialize(document: Document): string }
/** Limits for untrusted ZIP input. Generated PPTX output does not accept these options. */
export interface PptxImportOptions extends ZipOptions {
  xml?: XmlRuntime;
}
export interface PptxWriteOptions {
  fileName?: string;
  xml?: XmlRuntime;
  includeNotes?: boolean;
  range?: { from: number; to: number } | null;
  /** Optional host raster preprocessing. The browser download wrapper supplies EXIF normalization. */
  prepareImages?: (slides: Array<Record<string, any>>) => Array<Record<string, any>> | Promise<Array<Record<string, any>>>;
  signal?: AbortSignal;
}
/** @deprecated Use PptxImportOptions or PptxWriteOptions according to the operation. */
export type PptxOptions = PptxImportOptions;
export const PPTX_MIME: string;
export function importPptx(source: ByteSource, options?: PptxImportOptions): Promise<{ deck: Deck; warnings: string[] }>;
/** Returns bytes without downloading; inject xml in Node when grouped or gradient shapes need postprocessing. */
export function writePptx(deck: Deck, options?: PptxWriteOptions): Promise<Uint8Array>;
/** Browser-only download compatibility wrapper; returns the generated filename. */
export function exportToPPTX(deck: Deck, options?: PptxWriteOptions): Promise<string>;
export const pptxAdapter: FormatAdapter<Deck, PptxImportOptions, PptxWriteOptions>;
