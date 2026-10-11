import { describe, it, expect, vi, afterEach } from 'vitest';
import { readImageFile, jpegOrientation } from './imageFile.js';

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
// A JPEG whose APP1 carries an EXIF IFD0 with one Orientation (0x0112) entry.
function exifJpeg(orientation, { bigEndian = false, lead = [], tag = 0x0112 } = {}) {
  const u16 = (n) => (bigEndian ? [n >> 8, n & 255] : [n & 255, n >> 8]);
  const u32 = (n) => (bigEndian ? [0, 0, n >> 8, n & 255] : [n & 255, n >> 8, 0, 0]);
  const tiff = [...ascii(bigEndian ? 'MM' : 'II'), ...u16(42), ...u32(8),
    ...u16(1), ...u16(tag), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
  const app1 = [...ascii('Exif'), 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, ...lead, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xd9]);
}
const jpegFile = (bytes) => new File([bytes], 'photo.jpg', { type: 'image/jpeg' });

describe('jpegOrientation', () => {
  it('reads the EXIF Orientation tag (little- and big-endian TIFF)', () => {
    expect(jpegOrientation(exifJpeg(6))).toBe(6);
    expect(jpegOrientation(exifJpeg(8, { bigEndian: true }))).toBe(8);
  });

  it('skips segments before APP1', () => {
    const app0 = [0xff, 0xe0, 0, 6, 1, 2, 3, 4];
    expect(jpegOrientation(exifJpeg(3, { lead: app0 }))).toBe(3);
  });

  it('is 1 (as stored) when there is no usable orientation', () => {
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);        // no EXIF
    expect(jpegOrientation(new Uint8Array([0x89, ...ascii('PNG')]))).toBe(1);          // not a JPEG
    expect(jpegOrientation(exifJpeg(9))).toBe(1);                                       // out of range
    expect(jpegOrientation(exifJpeg(6, { tag: 0x010f }))).toBe(1);                     // EXIF without an Orientation entry
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 8, ...ascii('Nope'), 0, 0]))).toBe(1); // APP1 that isn't EXIF
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0x00]))).toBe(1);               // not a marker
  });
});

describe('readImageFile — EXIF orientation', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubCanvas(width, height) {
    const bitmap = { width, height, close: vi.fn() };
    const createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: vi.fn(() => 'data:image/jpeg;base64,UPRIGHT') };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : realCreate(tag)));
    return { createImageBitmap, canvas, drawImage, bitmap };
  }
  afterEach(() => vi.restoreAllMocks());

  it('re-encodes a rotated JPEG upright, so every consumer sees the displayed pixels', async () => {
    const { createImageBitmap, canvas, drawImage, bitmap } = stubCanvas(300, 400);
    const file = jpegFile(exifJpeg(6));
    expect(await readImageFile(file)).toBe('data:image/jpeg;base64,UPRIGHT');
    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect([canvas.width, canvas.height]).toEqual([300, 400]);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', expect.any(Number));
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('leaves an upright JPEG byte-for-byte (no re-compression)', async () => {
    const { createImageBitmap } = stubCanvas(10, 10);
    const url = await readImageFile(jpegFile(exifJpeg(1)));
    expect(url).toMatch(/^data:image\/jpeg;base64,\/9j/);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('keeps the original when the browser cannot decode it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode')));
    expect(await readImageFile(jpegFile(exifJpeg(6)))).toMatch(/^data:image\/jpeg;base64,\/9j/);
    vi.stubGlobal('createImageBitmap', undefined);
    expect(await readImageFile(jpegFile(exifJpeg(6)))).toMatch(/^data:image\/jpeg;base64,\/9j/);
  });
});

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
