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
  id: string; type: 'rect' | 'ellipse' | 'text'; x: number; y: number; w: number; h: number;
  fill?: string; content?: string; color?: string; fontSize?: number; fontFamily?: string;
  bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right';
}
export interface OdpDocument {
  title?: string; theme?: string; id?: string; size?: { w?: 1920; h: number };
  sections: { id: string; name: string; slides: string[] }[];
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
