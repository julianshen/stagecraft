// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { importDocument, exportDocument, readBytes } from './index.js';
const adapter = { id: 'test', mimeType: 'application/test', extensions: ['test'],
  import: async bytes => ({ document: [...bytes], diagnostics: [] }),
  export: async document => ({ bytes: Uint8Array.from(document), diagnostics: [] }) };

describe('explicit host I/O', () => {
  it('imports byte views and Blob, preserving only the view and reporting metadata', async () => {
    const result = await importDocument(new Uint8Array([1, 2, 3]).subarray(1), { adapter });
    expect(result.document).toEqual([2, 3]);
    expect(result.metadata).toEqual({ format: 'test', mimeType: 'application/test', byteLength: 2 });
    expect((await importDocument(new Blob([new Uint8Array([4])]), { adapter })).document).toEqual([4]);
  });
  it('uses only explicit load/save callbacks and never fetches a URL', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try {
      await expect(importDocument('https://example.com/file', { adapter })).rejects.toThrow('explicit host load');
      const load = vi.fn(async () => new Uint8Array([7]));
      const result = await importDocument('host-key', { adapter, load });
      expect(result.document).toEqual([7]);
      const save = vi.fn();
      expect((await exportDocument([8], { adapter, save })).bytes).toEqual(new Uint8Array([8]));
      expect(save).toHaveBeenCalledOnce();
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('supplies explicit or sanitized default filenames to the host save callback', async () => {
    const save = vi.fn();
    const output = await exportDocument([8], { adapter, fileName: 'chosen.test', save });
    expect(output.metadata.fileName).toBe('chosen.test');
    expect(save.mock.calls[0][1].fileName).toBe('chosen.test');
    const documentAdapter = { ...adapter, export: async () => ({ bytes: new Uint8Array(), diagnostics: [] }) };
    expect((await exportDocument({ title: '../Quarter: One' }, { adapter: documentAdapter })).metadata.fileName).toBe('_Quarter_ One.test');
    expect((await exportDocument({}, { adapter: documentAdapter })).metadata.fileName).toBe('document.test');
    await expect(exportDocument([], { adapter, fileName: '' })).rejects.toThrow('fileName');
  });
  it('validates byte inputs, output and limits', async () => {
    await expect(readBytes('not bytes')).rejects.toThrow('Expected');
    await expect(readBytes(new Uint8Array(2), { maxBytes: 1 })).rejects.toThrow('maxBytes');
    await expect(readBytes(new Uint8Array(), { maxBytes: NaN })).rejects.toThrow('safe integer');
    await expect(importDocument('key', { adapter, load: () => 'bad' })).rejects.toThrow('Expected');
    await expect(exportDocument([1, 2], { adapter, maxBytes: 1 })).rejects.toThrow('maxBytes');
  });
  it('checks abort before and after asynchronous host/adapter calls', async () => {
    const c = new AbortController(); c.abort(new Error('cancelled'));
    const load = vi.fn();
    await expect(importDocument('key', { adapter, signal: c.signal, load })).rejects.toThrow('cancelled');
    expect(load).not.toHaveBeenCalled();
    const late = new AbortController();
    await expect(importDocument('key', { adapter, signal: late.signal, load: async () => {
      late.abort(new Error('late')); return new Uint8Array();
    } })).rejects.toThrow('late');
    const during = new AbortController(); const save = vi.fn();
    await expect(exportDocument([], { adapter: { ...adapter, export: async () => {
      during.abort(new Error('during')); return { bytes: new Uint8Array(), diagnostics: [] };
    } }, signal: during.signal, save })).rejects.toThrow('during');
    expect(save).not.toHaveBeenCalled();
  });
});
