import JSZip from 'jszip';
import { byteLimit, readBytes, throwIfAborted } from './index.js';
import { rejectXmlDeclarations as rejectXmlTextDeclarations } from './xml.js';

export const DEFAULT_ZIP_LIMITS = Object.freeze({ maxEntries: 10000, maxEntryBytes: 32 * 1024 * 1024, maxExpandedBytes: 256 * 1024 * 1024 });

function checkEntryPath(name) {
  const segments = name.endsWith('/') ? name.slice(0, -1).split('/') : name.split('/');
  if (!name || /[\\\x00-\x1f\x7f]/.test(name) || name.startsWith('/') || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('Unsafe ZIP entry path');
  }
}

function checkUnicodePaths(bytes, view, start, end) {
  let identity;
  for (let at = start; at < end;) {
    if (at + 4 > end) throw new Error('Invalid ZIP extra field');
    const size = view.getUint16(at + 2, true);
    if (at + 4 + size > end) throw new Error('Invalid ZIP extra field length');
    // Info-ZIP Unicode Path: version + CRC32 of raw name + UTF-8 name.
    // Inspect even an unused override; do not permit unsafe alternate identities.
    if (view.getUint16(at, true) === 0x7075 && size >= 5) {
      checkEntryPath(new TextDecoder().decode(bytes.subarray(at + 9, at + 4 + size)));
      const payload = bytes.subarray(at + 4, at + 4 + size);
      if (identity && !sameBytes(identity, payload)) throw new Error('Duplicate or ambiguous Unicode ZIP identity');
      identity = payload;
    }
    at += 4 + size;
  }
  return identity;
}
const sameBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

// Check the central directory before JSZip builds its entry map (duplicate names
// must still count). ZIP64, split archives and encrypted entries are unsupported.
function inspectDirectory(bytes, maxEntries) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Not a supported ZIP package');
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)
    || view.getUint16(end + 8, true) !== count || count === 0xffff
    || view.getUint32(end + 12, true) === 0xffffffff || view.getUint32(end + 16, true) === 0xffffffff) throw new Error('Split and ZIP64 packages are unsupported');
  if (count > maxEntries) throw new RangeError('ZIP exceeds maxEntries');
  let at = view.getUint32(end + 16, true);
  const directoryEnd = at + view.getUint32(end + 12, true);
  if (directoryEnd !== end) throw new Error('Unsupported ZIP directory layout');
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (at + 46 > directoryEnd || view.getUint32(at, true) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    if (view.getUint16(at + 8, true) & 1) throw new Error('Encrypted ZIP entries are unsupported');
    if (view.getUint32(at + 20, true) === 0xffffffff || view.getUint32(at + 24, true) === 0xffffffff || view.getUint32(at + 42, true) === 0xffffffff) throw new Error('ZIP64 entries are unsupported');
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    if (at + 46 + nameLength + extraLength > directoryEnd) throw new Error('Invalid ZIP name');
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    checkEntryPath(name);
    const centralIdentity = checkUnicodePaths(bytes, view, at + 46 + nameLength, at + 46 + nameLength + extraLength);
    if (names.has(name)) throw new Error('Duplicate ZIP entry name');
    names.add(name);
    const local = view.getUint32(at + 42, true);
    if (local + 30 > end || view.getUint32(local, true) !== 0x04034b50) throw new Error('Invalid ZIP local header');
    const localNameLength = view.getUint16(local + 26, true), localExtraLength = view.getUint16(local + 28, true);
    if (local + 30 + localNameLength + localExtraLength > end) throw new Error('Invalid ZIP local name');
    const localName = new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + localNameLength));
    checkEntryPath(localName);
    if (localName !== name) throw new Error('Duplicate or ambiguous ZIP entry names');
    const localIdentity = checkUnicodePaths(bytes, view, local + 30 + localNameLength, local + 30 + localNameLength + localExtraLength);
    // Reject conflicting alternate identities conservatively, including bad-CRC
    // fields that another ZIP reader might interpret differently. No silent repair.
    if (centralIdentity && localIdentity && !sameBytes(centralIdentity, localIdentity)) throw new Error('Duplicate or ambiguous Unicode ZIP identity');
    at += 46 + nameLength + extraLength + view.getUint16(at + 32, true);
  }
  if (at !== directoryEnd) throw new Error('Invalid ZIP directory length');
  return count;
}

/** Reject declarations before an XML parser sees them, including UTF-16/32 forms. */
export function rejectXmlDeclarations(bytes, _name = 'XML') {
  // ASCII declarations remain detectable after removing interleaved NUL bytes.
  rejectXmlTextDeclarations(new TextDecoder().decode(bytes));
}

function zipLimits({ maxEntries = DEFAULT_ZIP_LIMITS.maxEntries, maxEntryBytes = DEFAULT_ZIP_LIMITS.maxEntryBytes,
  maxExpandedBytes = DEFAULT_ZIP_LIMITS.maxExpandedBytes } = {}) {
  const limits = { maxEntries, maxEntryBytes, maxExpandedBytes };
  for (const [name, value] of Object.entries(limits)) byteLimit(value, name);
  return limits;
}

// This closure retains only numbers, not the ZIP, entry buffers or caller options.
function cachedLimitCheck(entryCount, declaredBytes, maxDeclaredEntryBytes, expandedBytes, maxActualEntryBytes) {
  return options => {
    const { maxEntries, maxEntryBytes, maxExpandedBytes } = zipLimits(options);
    if (entryCount > maxEntries) throw new RangeError('ZIP exceeds maxEntries');
    if (maxDeclaredEntryBytes > maxEntryBytes || declaredBytes > maxExpandedBytes) throw new RangeError('ZIP declared size exceeds expanded limits');
    if (maxActualEntryBytes > maxEntryBytes || expandedBytes > maxExpandedBytes) throw new RangeError('ZIP inflated size exceeds expanded limits');
  };
}

/**
 * Inspect every actual inflated entry, not only claimed ZIP sizes. JSZip allocates
 * each inflated entry before the actual-size check: this is NOT a streaming memory
 * ceiling. Hostile input needs process isolation / a streaming inflater as well.
 */
export async function inspectZip(source, options = {}) {
  const { signal } = options;
  const { maxEntries, maxEntryBytes, maxExpandedBytes } = zipLimits(options);
  const bytes = await readBytes(source, options);
  const declaredCount = inspectDirectory(bytes, maxEntries);
  const zip = await JSZip.loadAsync(bytes);
  throwIfAborted(signal);
  const entries = Object.values(zip.files);
  // Unicode path overrides and path normalization must not silently merge entries.
  if (entries.length !== declaredCount) throw new Error('Duplicate or ambiguous ZIP entry names');
  if (entries.length > maxEntries) throw new RangeError('ZIP exceeds maxEntries');
  let expandedBytes = 0;
  let declaredBytes = 0, maxDeclaredEntryBytes = 0, maxActualEntryBytes = 0;
  for (const entry of entries) {
    const original = entry.unsafeOriginalName ?? entry.name;
    checkEntryPath(original);
    checkEntryPath(entry.name);
    if (entry.name !== original) throw new Error('Duplicate or ambiguous ZIP entry names');
    if (/(^|\/)(EncryptionInfo|EncryptedPackage)$/i.test(entry.name)) throw new Error('Encrypted Office packages are unsupported');
    const size = entry._data?.uncompressedSize ?? 0;
    declaredBytes += size;
    maxDeclaredEntryBytes = Math.max(maxDeclaredEntryBytes, size);
    if (size > maxEntryBytes || declaredBytes > maxExpandedBytes) throw new RangeError('ZIP declared size exceeds expanded limits');
  }
  for (const entry of entries) {
    throwIfAborted(signal);
    if (entry.dir) continue;
    const data = await entry.async('uint8array');
    throwIfAborted(signal);
    expandedBytes += data.byteLength;
    maxActualEntryBytes = Math.max(maxActualEntryBytes, data.byteLength);
    if (data.byteLength > maxEntryBytes || expandedBytes > maxExpandedBytes) throw new RangeError('ZIP inflated size exceeds expanded limits');
    if (/\.(xml|rels)$/i.test(entry.name)) rejectXmlDeclarations(data, entry.name);
  }
  return { zip, entryCount: entries.length, expandedBytes, byteLength: bytes.byteLength,
    checkLimits: cachedLimitCheck(entries.length, declaredBytes, maxDeclaredEntryBytes, expandedBytes, maxActualEntryBytes) };
}
