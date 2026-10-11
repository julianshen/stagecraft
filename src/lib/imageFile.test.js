import { describe, it, expect } from 'vitest';
import { readImageFile } from './imageFile.js';

describe('readImageFile', () => {
  it('resolves a File to a data URL', async () => {
    const file = new File(['hello'], 'pic.png', { type: 'image/png' });
    const url = await readImageFile(file);
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects when given no file', async () => {
    await expect(readImageFile(null)).rejects.toBeInstanceOf(Error);
  });

  it('rejects a non-image file', async () => {
    await expect(readImageFile(new File(['hi'], 'notes.txt', { type: 'text/plain' })))
      .rejects.toThrow(/not an image/i);
  });

  it('rejects a file over the size limit', async () => {
    const big = new File([''], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await expect(readImageFile(big)).rejects.toThrow(/too large|size/i);
  });

  it('rejects when the FileReader fails', async () => {
    const orig = globalThis.FileReader;
    globalThis.FileReader = class {
      readAsDataURL() { this.error = new Error('boom'); queueMicrotask(() => this.onerror?.()); }
    };
    try {
      await expect(readImageFile(new File(['x'], 'x.png', { type: 'image/png' }))).rejects.toThrow('boom');
    } finally {
      globalThis.FileReader = orig;
    }
  });
});
