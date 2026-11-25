export const ODP_MIME: 'application/vnd.oasis.opendocument.presentation';
export interface OdpOptions {
  fileName?: string;
  signal?: AbortSignal;
  maxBytes?: number;
  maxEntries?: number;
  maxEntryBytes?: number;
  maxExpandedBytes?: number;
  xml?: { parse(text: string): Document };
}
export interface OdpDiagnostic extends Diagnostic { severity: 'warning' }
export interface OdpElement {
  /** Preserved in Stagecraft identity metadata; regenerated for foreign ODP files without a matching map. */
  id: string; type: 'rect' | 'ellipse' | 'text'; x: number; y: number; w: number; h: number;
  fill?: string; content?: string; color?: string; fontSize?: number; fontFamily?: string;
  bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right';
}
export interface OdpDocument {
  title?: string; theme?: string;
  /** Preserved in Stagecraft identity metadata when present. */
  id?: string; size?: { w?: 1920; h: number };
  /** Section ids, names and slide order are preserved in Stagecraft identity metadata. */
  sections: { id: string; name: string; slides: string[] }[];
  /** Slide and element ids are preserved when the metadata fingerprint still matches the ODF structure. */
  slides: { id: string; title?: string; layout: 'blank'; notes?: string; elements: OdpElement[] }[];
}
export function importOdp(source: Uint8Array | ArrayBuffer | Blob, options?: OdpOptions): Promise<{ document: OdpDocument; diagnostics: OdpDiagnostic[] }>;
export function writeOdp(document: OdpDocument, options?: OdpOptions): Promise<Uint8Array>;
export const odpAdapter: {
  readonly id: 'odp'; readonly extensions: string[]; readonly mimeType: typeof ODP_MIME;
  import: typeof importOdp;
  export(document: OdpDocument, options?: OdpOptions): Promise<{ bytes: Uint8Array; diagnostics: OdpDiagnostic[] }>;
};
import type { Diagnostic } from '@stagecraft/io';
