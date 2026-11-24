export type ByteSource = Uint8Array | ArrayBuffer | Blob;
export interface XmlRuntime { parse(text: string): Document; serialize?(document: Document): string }
export interface SafeXmlRuntime extends XmlRuntime {}
export interface Diagnostic { code: string; message: string; severity: 'info' | 'warning' | 'error'; [key: string]: unknown }
export interface FormatAdapter<Document = unknown, Options extends object = Record<string, unknown>> {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly mimeType: string;
  import(bytes: Uint8Array, options?: Options & { signal?: AbortSignal; maxBytes?: number }): Promise<{ document: Document; diagnostics: Diagnostic[] }>;
  export(document: Document, options?: Options & { signal?: AbortSignal; maxBytes?: number }): Promise<{ bytes: ByteSource; diagnostics: Diagnostic[] }>;
}
export interface Metadata { format: string; mimeType: string; byteLength: number }
export interface ExportMetadata extends Metadata { fileName: string }
export interface ByteOptions { maxBytes?: number; signal?: AbortSignal }
export const DEFAULT_MAX_BYTES: number;
export function safeXmlParse(text: string, runtime?: XmlRuntime): Document;
export function createSafeXmlRuntime(runtime?: XmlRuntime): SafeXmlRuntime;
export function throwIfAborted(signal?: AbortSignal): void;
export function byteLimit(value: number, name?: string): number;
export function readBytes(source: ByteSource, options?: ByteOptions): Promise<Uint8Array>;
export function importDocument<D, O extends object = Record<string, unknown>>(source: unknown, options: O & ByteOptions & {
  adapter: FormatAdapter<D, O>;
  load?: (source: unknown, options: ByteOptions) => ByteSource | Promise<ByteSource>;
}): Promise<{ document: D; diagnostics: Diagnostic[]; metadata: Metadata }>;
export function exportDocument<D, O extends object = Record<string, unknown>>(document: D, options: O & ByteOptions & {
  adapter: Pick<FormatAdapter<D, O>, 'id' | 'mimeType' | 'extensions' | 'export'>;
  fileName?: string;
  save?: (bytes: Uint8Array, metadata: ExportMetadata & { signal?: AbortSignal }) => unknown | Promise<unknown>;
}): Promise<{ bytes: Uint8Array; diagnostics: Diagnostic[]; metadata: ExportMetadata }>;
