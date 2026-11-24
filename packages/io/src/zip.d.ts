import type JSZip from 'jszip';
import type { ByteSource, ByteOptions } from './index.js';
export interface ZipOptions extends ByteOptions { maxEntries?: number; maxEntryBytes?: number; maxExpandedBytes?: number }
export const DEFAULT_ZIP_LIMITS: Readonly<Required<Pick<ZipOptions, 'maxEntries' | 'maxEntryBytes' | 'maxExpandedBytes'>>>;
export function rejectXmlDeclarations(bytes: Uint8Array): void;
/** Actual inflated lengths are checked, but JSZip allocates each entry first; not a streaming memory ceiling. */
export function inspectZip(source: ByteSource, options?: ZipOptions): Promise<{ zip: JSZip; entryCount: number; expandedBytes: number; byteLength: number;
  /** Recheck ZIP count/declared/actual expanded limits for the inspected bytes. Does not check maxBytes or signals. */
  checkLimits(options?: Pick<ZipOptions, 'maxEntries' | 'maxEntryBytes' | 'maxExpandedBytes'>): void
}>;
