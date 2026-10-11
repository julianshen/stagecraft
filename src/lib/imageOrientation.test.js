import { describe, it, expect, vi, afterEach } from 'vitest';
import { jpegOrientation, clearOrientation, uprightSlides } from './imageOrientation.js';

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
// A JPEG: optional leading segments, an APP1 EXIF IFD0 with one entry
// (Orientation, 0x0112, by default), then a SOF0 frame of w×h.
function exifJpeg(orientation, { bigEndian = false, lead = [], tag = 0x0112, w = 40, h = 30 } = {}) {
  const u16 = (n) => (bigEndian ? [n >> 8, n & 255] : [n & 255, n >> 8]);
  const u32 = (n) => (bigEndian ? [0, 0, n >> 8, n & 255] : [n & 255, n >> 8, 0, 0]);
  const tiff = [...ascii(bigEndian ? 'MM' : 'II'), ...u16(42), ...u32(8),
    ...u16(1), ...u16(tag), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
  const app1 = [...ascii('Exif'), 0, 0, ...tiff];
  const len = app1.length + 2;
  const sof = [0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0];
  return new Uint8Array([0xff, 0xd8, ...lead, 0xff, 0xe1, len >> 8, len & 255, ...app1, ...sof, 0xff, 0xd9]);
}
const b64 = (bytes) => { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };
const dataUrl = (bytes, mime = 'image/jpeg') => `data:${mime};base64,${b64(bytes)}`;
const bytesOf = (url) => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));

describe('jpegOrientation', () => {
  it('reads the EXIF Orientation tag (little- and big-endian TIFF)', () => {
    expect(jpegOrientation(exifJpeg(6))).toBe(6);
    expect(jpegOrientation(exifJpeg(8, { bigEndian: true }))).toBe(8);
  });

  it('skips segments before APP1, however large (an ICC profile can run past 64 KB)', () => {
    expect(jpegOrientation(exifJpeg(3, { lead: [0xff, 0xe0, 0, 6, 1, 2, 3, 4] }))).toBe(3);
    const icc = [0xff, 0xe2, 0xff, 0xff, ...new Array(0xffff - 2).fill(0)];
    expect(jpegOrientation(exifJpeg(6, { lead: [...icc, ...icc] }))).toBe(6);
  });

  it('skips 0xFF fill bytes before a marker', () => {
    expect(jpegOrientation(exifJpeg(6, { lead: [0xff, 0xff] }))).toBe(6);
  });

  it('is 1 (as stored) when there is no usable orientation', () => {
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);        // no EXIF
    expect(jpegOrientation(new Uint8Array([0x89, ...ascii('PNG')]))).toBe(1);          // not a JPEG
    expect(jpegOrientation(exifJpeg(9))).toBe(1);                                       // out of range
    expect(jpegOrientation(exifJpeg(6, { tag: 0x010f }))).toBe(1);                     // EXIF without an Orientation entry
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 8, ...ascii('Nope'), 0, 0]))).toBe(1); // APP1 that isn't EXIF
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0x00]))).toBe(1);               // not a marker
    expect(jpegOrientation(exifJpeg(6, { lead: [0xff, 0xda, 0, 2] }))).toBe(1);        // past start-of-scan: entropy data, not segments
  });
});

describe('clearOrientation', () => {
  it('rewrites the tag to 1 in place — the pixels and every other byte stay as they are', () => {
    const src = exifJpeg(6);
    const out = bytesOf(clearOrientation(dataUrl(src)));
    expect(jpegOrientation(out)).toBe(1);
    expect(out.length).toBe(src.length);
    expect([...out].filter((x, i) => x !== src[i])).toHaveLength(1);
  });

  it('returns the same data URL when there is nothing to clear', () => {
    for (const url of [dataUrl(exifJpeg(1)), dataUrl([0x89, ...ascii('PNG')], 'image/png'), 'data:image/jpeg;base64,%%%']) {
      expect(clearOrientation(url)).toBe(url);
    }
  });
});

describe('uprightSlides', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  // A fake browser decode/encode: createImageBitmap → canvas → toBlob. `applied`
  // = whether the browser honours imageOrientation: the built-in 2×1 probe (the
  // only 321-byte blob here) then comes back 1×2, and every picture turned.
  const PROBE_BYTES = 321;
  function stubBrowser({ applied = true, size = [40, 30] } = {}) {
    let active = 0;
    const seen = { maxActive: 0 };
    const createImageBitmap = vi.fn(async (blob, { imageOrientation }) => {
      seen.maxActive = Math.max(seen.maxActive, ++active);
      await new Promise((r) => setTimeout(r, 1));
      const [w, h] = blob.size === PROBE_BYTES ? [2, 1] : size;
      const turned = applied && imageOrientation === 'from-image';
      return { width: turned ? h : w, height: turned ? w : h, close: vi.fn(() => { active--; }) };
    });
    const pictureCalls = () => createImageBitmap.mock.calls.filter(([blob]) => blob.size !== PROBE_BYTES);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const ctx = { drawImage: vi.fn(), transform: vi.fn() };
    const canvas = { width: 0, height: 0, sizes: [], getContext: () => ctx,
      toBlob: vi.fn(function (cb, type) { this.sizes.push([this.width, this.height]); cb(new Blob(['UPRIGHT'], { type })); }) };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : realCreate(tag)));
    return { createImageBitmap, pictureCalls, canvas, ctx, seen };
  }
  const slideOf = (...elements) => ({ id: 's', layout: 'blank', elements });
  const UPRIGHT = `data:image/jpeg;base64,${btoa('UPRIGHT')}`;

  it('re-encodes a rotated JPEG upright in copies of the slides, once per distinct src', async () => {
    const { pictureCalls, canvas, ctx } = stubBrowser();
    const rotated = dataUrl(exifJpeg(6));
    const a = { id: 'a', type: 'image', src: rotated };
    const slides = [slideOf(a, { id: 'b', type: 'image', src: rotated }, { id: 't', type: 'text', content: 'x' })];
    const out = await uprightSlides(slides);
    expect(out[0].elements.map((e) => e.src)).toEqual([UPRIGHT, UPRIGHT, undefined]);
    expect(pictureCalls()).toHaveLength(1);
    expect(pictureCalls()[0][1]).toEqual({ imageOrientation: 'from-image' });
    expect(canvas.sizes).toEqual([[30, 40]]);
    expect(ctx.transform).not.toHaveBeenCalled(); // the browser already turned it
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', expect.any(Number));
    expect([canvas.width, canvas.height]).toEqual([0, 0]); // backing store released
    expect(a.src).toBe(rotated); // the stored deck is untouched
  });

  it('turns it itself when the browser ignores imageOrientation', async () => {
    const { canvas, ctx } = stubBrowser({ applied: false });
    const out = await uprightSlides([slideOf({ id: 'a', type: 'image', src: dataUrl(exifJpeg(6)) })]);
    expect(out[0].elements[0].src).toBe(UPRIGHT);
    expect(canvas.sizes).toEqual([[30, 40]]);               // swapped to the displayed size
    expect(ctx.transform).toHaveBeenCalledWith(0, 1, -1, 0, 30, 0); // orientation 6: 90° clockwise
  });

  it.each([
    [2, [-1, 0, 0, 1, 40, 0]],   // mirror
    [3, [-1, 0, 0, -1, 40, 30]], // 180°
    [4, [1, 0, 0, -1, 0, 30]],   // flip
    [5, [0, 1, 1, 0, 0, 0]],     // transpose
    [7, [0, -1, -1, 0, 30, 40]], // transverse
    [8, [0, -1, 1, 0, 0, 40]],   // 90° anticlockwise
  ])('turns orientation %i itself with the EXIF transform', async (o, matrix) => {
    const { ctx } = stubBrowser({ applied: false });
    await uprightSlides([slideOf({ id: 'a', type: 'image', src: dataUrl(exifJpeg(o)) })]);
    expect(ctx.transform).toHaveBeenCalledWith(...matrix);
  });

  it('turns a square picture itself too (the probe, not the picture\'s size, decides)', async () => {
    const { canvas, ctx } = stubBrowser({ applied: false, size: [30, 30] });
    await uprightSlides([slideOf({ id: 'a', type: 'image', src: dataUrl(exifJpeg(6, { w: 30, h: 30 })) })]);
    expect(canvas.sizes).toEqual([[30, 30]]);
    expect(ctx.transform).toHaveBeenCalledWith(0, 1, -1, 0, 30, 0);
  });

  it('decodes one picture at a time (full-size bitmaps add up)', async () => {
    const { pictureCalls, seen } = stubBrowser();
    const slides = [6, 8, 3].map((o, i) => slideOf({ id: `i${i}`, type: 'image', src: dataUrl(exifJpeg(o, { w: 40 + i })) }));
    await uprightSlides(slides);
    expect(pictureCalls()).toHaveLength(3);
    expect(seen.maxActive).toBe(1);
  });

  it('returns the same slides when nothing is rotated (upright JPEGs, other formats, no elements)', async () => {
    const { createImageBitmap } = stubBrowser();
    const slides = [slideOf(
      { id: 'u', type: 'image', src: dataUrl(exifJpeg(1)) },
      { id: 'p', type: 'image', src: dataUrl([0x89, ...ascii('PNG')], 'image/png') },
      { id: 'r', type: 'image', src: 'https://example.com/x.jpg' },
    ), { id: 'c', layout: 'cover' }];
    expect(await uprightSlides(slides)).toBe(slides);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('keeps the original when the browser cannot decode or encode it', async () => {
    const slides = [slideOf({ id: 'a', type: 'image', src: dataUrl(exifJpeg(6)) })];
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode')));
    expect(await uprightSlides(slides)).toBe(slides);
    vi.stubGlobal('createImageBitmap', undefined);
    expect(await uprightSlides(slides)).toBe(slides);
    const { canvas } = stubBrowser();
    canvas.toBlob = (cb) => cb(null); // encode failed
    expect(await uprightSlides(slides)).toBe(slides);
  });
});
