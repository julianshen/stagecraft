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

  it('rejects when the FileReader fails', async () => {
    const orig = globalThis.FileReader;
    globalThis.FileReader = class {
      readAsDataURL() { this.error = new Error('boom'); queueMicrotask(() => this.onerror?.()); }
    };
    try {
      await expect(readImageFile(new File(['x'], 'x.png'))).rejects.toThrow('boom');
    } finally {
      globalThis.FileReader = orig;
    }
  });
});
