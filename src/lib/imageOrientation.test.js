import { describe, it, expect, vi, afterEach } from 'vitest';
import { jpegOrientation, uprightImages } from './imageOrientation.js';

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
// A JPEG whose APP1 carries an EXIF IFD0 with one entry (Orientation, 0x0112, by default).
function exifJpeg(orientation, { bigEndian = false, lead = [], tag = 0x0112 } = {}) {
  const u16 = (n) => (bigEndian ? [n >> 8, n & 255] : [n & 255, n >> 8]);
  const u32 = (n) => (bigEndian ? [0, 0, n >> 8, n & 255] : [n & 255, n >> 8, 0, 0]);
  const tiff = [...ascii(bigEndian ? 'MM' : 'II'), ...u16(42), ...u32(8),
    ...u16(1), ...u16(tag), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
  const app1 = [...ascii('Exif'), 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, ...lead, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xd9]);
}
const dataUrl = (bytes, mime = 'image/jpeg') => `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;

describe('jpegOrientation', () => {
  it('reads the EXIF Orientation tag (little- and big-endian TIFF)', () => {
    expect(jpegOrientation(exifJpeg(6))).toBe(6);
    expect(jpegOrientation(exifJpeg(8, { bigEndian: true }))).toBe(8);
  });

  it('skips segments before APP1', () => {
    expect(jpegOrientation(exifJpeg(3, { lead: [0xff, 0xe0, 0, 6, 1, 2, 3, 4] }))).toBe(3);
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

describe('uprightImages', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  // A fake browser decode/encode: createImageBitmap → canvas → toBlob.
  function stubBrowser(width = 300, height = 400) {
    const bitmap = { width, height, close: vi.fn() };
    const createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const drawImage = vi.fn();
    const canvas = {
      width: 0, height: 0, getContext: () => ({ drawImage }),
      toBlob: vi.fn((cb, type) => cb(new Blob(['UPRIGHT'], { type }))),
    };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : realCreate(tag)));
    return { createImageBitmap, canvas, drawImage, bitmap };
  }
  const deckOf = (...elements) => ({ title: 'D', sections: [], slides: [{ id: 's', layout: 'blank', elements }] });

  it('re-encodes a rotated JPEG upright in a copy of the deck, once per distinct src', async () => {
    const { createImageBitmap, canvas, drawImage, bitmap } = stubBrowser();
    const rotated = dataUrl(exifJpeg(6));
    const a = { id: 'a', type: 'image', src: rotated };
    const b = { id: 'b', type: 'image', src: rotated };
    const deck = deckOf(a, b, { id: 't', type: 'text', content: 'x' });
    const out = await uprightImages(deck);
    const want = `data:image/jpeg;base64,${btoa('UPRIGHT')}`;
    expect(out.slides[0].elements.map((e) => e.src)).toEqual([want, want, undefined]);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(createImageBitmap.mock.calls[0][1]).toEqual({ imageOrientation: 'from-image' });
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', expect.any(Number));
    expect(bitmap.close).toHaveBeenCalled();
    expect([canvas.width, canvas.height]).toEqual([0, 0]); // backing store released
    expect(a.src).toBe(rotated); // the stored deck is untouched
  });

  it('returns the same deck when nothing is rotated (upright JPEGs, other formats, no elements)', async () => {
    const { createImageBitmap } = stubBrowser();
    const deck = { ...deckOf(
      { id: 'u', type: 'image', src: dataUrl(exifJpeg(1)) },
      { id: 'p', type: 'image', src: dataUrl([0x89, ...ascii('PNG')], 'image/png') },
      { id: 'r', type: 'image', src: 'https://example.com/x.jpg' },
    ) };
    deck.slides.push({ id: 'c', layout: 'cover' });
    expect(await uprightImages(deck)).toBe(deck);
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(await uprightImages(null)).toBe(null);
  });

  it('keeps the original when the browser cannot decode or encode it', async () => {
    const rotated = dataUrl(exifJpeg(6));
    const deck = deckOf({ id: 'a', type: 'image', src: rotated });
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode')));
    expect(await uprightImages(deck)).toBe(deck);
    vi.stubGlobal('createImageBitmap', undefined);
    expect(await uprightImages(deck)).toBe(deck);
    const { canvas } = stubBrowser();
    canvas.toBlob = (cb) => cb(null); // encode failed
    expect(await uprightImages(deck)).toBe(deck);
  });
});
