// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { inspectZip, rejectXmlDeclarations } from './zip.js';
const packed = async entries => { const zip = new JSZip(); for (const [name, data] of Object.entries(entries)) zip.file(name, data); return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }); };
describe('ZIP preflight', () => {
  it('rejects duplicate entries before JSZip can overwrite one', async () => {
    const bytes = await packed({ 'a.xml': '<a/>', 'b.xml': '<b/>' });
    // Change both local-header and central-directory names without changing lengths.
    const modified = new Uint8Array(Buffer.from(bytes).toString('latin1').replaceAll('b.xml', 'a.xml').split('').map(c => c.charCodeAt(0)));
    await expect(inspectZip(modified)).rejects.toThrow(/Duplicate|ambiguous/);
  });
  it.each([{ local: 'a/./xx' }, { local: 'a//xxx' }, { local: 'a/\0xxx' }, { local: 'a/xxxx', central: 'b/yyyy' }])('rejects unsafe or conflicting Unicode overrides: %j', async override => {
    const bytes = await packed({ 'é/foo': 'payload' });
    const buffer = Buffer.from(bytes);
    for (const [signature, header, flags, nameOffset, extraOffset] of [
      [0x04034b50, 30, 6, 26, 28], [0x02014b50, 46, 8, 28, 30],
    ]) {
      const marker = Buffer.alloc(4); marker.writeUInt32LE(signature);
      for (let start = buffer.indexOf(marker); start >= 0; start = buffer.indexOf(marker, start + 4)) {
        const nameLength = buffer.readUInt16LE(start + nameOffset);
        if (buffer.subarray(start + header, start + header + nameLength).toString() !== 'é/foo') continue;
        buffer.writeUInt16LE(buffer.readUInt16LE(start + flags) & ~0x800, start + flags);
        const end = start + header + nameLength + buffer.readUInt16LE(start + extraOffset);
        for (let at = start + header + nameLength; at + 4 <= end;) {
          const size = buffer.readUInt16LE(at + 2);
          if (buffer.readUInt16LE(at) === 0x7075) Buffer.from(signature === 0x02014b50 ? override.central ?? override.local : override.local).copy(buffer, at + 9);
          at += size + 4;
        }
      }
    }
    await expect(inspectZip(new Uint8Array(buffer))).rejects.toThrow(/Unsafe|ambiguous/);
  });
  it('retains unambiguous Unicode entry names', async () => {
    const { zip } = await inspectZip(await packed({ 'é/foo': 'payload' }));
    expect(await zip.file('é/foo').async('string')).toBe('payload');
  });
  it('counts actual bytes in every entry, including unsupported binary parts', async () => {
    const bytes = await packed({ 'a.xml': '<a/>', 'unknown.bin': 'x'.repeat(200) });
    const result = await inspectZip(bytes);
    expect(result.expandedBytes).toBe(204);
    await expect(inspectZip(bytes, { maxEntries: 1 })).rejects.toThrow('maxEntries');
    await expect(inspectZip(bytes, { maxEntryBytes: 199 })).rejects.toThrow('limits');
    await expect(inspectZip(bytes, { maxExpandedBytes: 203 })).rejects.toThrow('limits');
  });
  it('rechecks exact limits and invalid options without reading entries again', async () => {
    const bytes = await packed({ 'a.bin': 'x'.repeat(200), 'b.bin': 'y'.repeat(100) });
    const result = await inspectZip(bytes);
    const reads = vi.spyOn(Object.getPrototypeOf(result.zip.file('a.bin')), 'async');
    try {
      expect(() => result.checkLimits({ maxEntries: 2, maxEntryBytes: 200, maxExpandedBytes: 300 })).not.toThrow();
      for (const limits of [{ maxEntries: 1 }, { maxEntryBytes: 199 }, { maxExpandedBytes: 299 }]) {
        expect(() => result.checkLimits(limits)).toThrow();
      }
      for (const key of ['maxEntries', 'maxEntryBytes', 'maxExpandedBytes']) {
        for (const value of [-1, NaN, 1.5, null]) expect(() => result.checkLimits({ [key]: value })).toThrow(/non-negative/);
      }
      expect(reads).not.toHaveBeenCalled();
    } finally { reads.mockRestore(); }
  });
  it('retains declared directory sizes even though directories are not inflated', async () => {
    const zip = new JSZip(); zip.folder('dir'); zip.file('data', 'x');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const loaded = await JSZip.loadAsync(bytes);
    // Directory metadata also participates in the declared-size check.
    loaded.files['dir/']._data = { uncompressedSize: 100 };
    const load = vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(loaded);
    let result;
    try { result = await inspectZip(bytes); } finally { load.mockRestore(); }
    expect(result.expandedBytes).toBe(1);
    expect(() => result.checkLimits({ maxEntryBytes: 100, maxExpandedBytes: 101 })).not.toThrow();
    expect(() => result.checkLimits({ maxEntryBytes: 99 })).toThrow(/declared/);
    expect(() => result.checkLimits({ maxExpandedBytes: 100 })).toThrow(/declared/);
  });
  it('retains actual inflated maxima independently from declared sizes', async () => {
    const bytes = await packed({ data: 'x' });
    const zip = await JSZip.loadAsync(bytes);
    // Isolate the inspector's actual-byte check from JSZip's own mismatch rejection.
    zip.file('data').async = async () => new Uint8Array(200);
    const load = vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(zip);
    let result;
    try { result = await inspectZip(bytes); } finally { load.mockRestore(); }
    expect(result.expandedBytes).toBe(200);
    expect(() => result.checkLimits({ maxEntryBytes: 200, maxExpandedBytes: 200 })).not.toThrow();
    expect(() => result.checkLimits({ maxEntryBytes: 199 })).toThrow(/inflated/);
    expect(() => result.checkLimits({ maxExpandedBytes: 199 })).toThrow(/inflated/);
  });
  it('rejects DTD declarations before format parsers, including UTF-16', async () => {
    await expect(inspectZip(await packed({ 'a.xml': '<!DOCTYPE a [<!ENTITY x "x">]><a/>' }))).rejects.toThrow('DTD');
    expect(() => rejectXmlDeclarations(new Uint8Array(Buffer.from('<!DOCTYPE a><a/>', 'utf16le')))).toThrow('DTD');
  });
  it('rejects traversal, encrypted content and unsupported ZIP forms', async () => {
    await expect(inspectZip(await packed({ '../evil.xml': '<a/>' }))).rejects.toThrow('Unsafe');
    await expect(inspectZip(await packed({ EncryptionInfo: 'x' }))).rejects.toThrow('Encrypted');
    await expect(inspectZip(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).rejects.toThrow('ZIP');
    const bytes = await packed({ a: 'a' });
    const at = Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4b, 1, 2]));
    bytes[at + 8] |= 1;
    await expect(inspectZip(bytes)).rejects.toThrow('Encrypted');
  });
  it('rejects dishonest inflated-size metadata', async () => {
    const bytes = await packed({ 'a.bin': 'x'.repeat(200) });
    const at = Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4b, 1, 2]));
    new DataView(bytes.buffer).setUint32(at + 24, 1, true);
    // JSZip itself detects the mismatch after inflation; no unverified entry reaches a parser.
    await expect(inspectZip(bytes, { maxEntryBytes: 10 })).rejects.toThrow();
  });
});
