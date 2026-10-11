import { describe, it, expect } from 'vitest';
import { dataImageSize } from './imageSize.js';

const url = (mime, bytes) => `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;
const be16 = (n) => [(n >> 8) & 255, n & 255];
const be32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >> 8) & 255];
const le24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

const png = (w, h) => [137, 80, 78, 71, 13, 10, 26, 10, ...be32(13), ...ascii('IHDR'), ...be32(w), ...be32(h), 8, 6, 0, 0, 0];
const gif = (w, h) => [...ascii('GIF89a'), ...le16(w), ...le16(h), 0, 0, 0];
// SOI, an APP0 segment to skip, then a baseline SOF0 (height before width).
const jpeg = (w, h, sof = 0xc0) => [0xff, 0xd8, 0xff, 0xe0, ...be16(6), 1, 2, 3, 4, 0xff, sof, ...be16(11), 8, ...be16(h), ...be16(w), 1, 1, 0x11, 0];
const riff = (chunk) => [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...chunk];

describe('dataImageSize', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    expect(dataImageSize(url('image/png', png(640, 480)))).toEqual({ w: 640, h: 480 });
  });

  it('reads GIF dimensions from the logical screen descriptor', () => {
    expect(dataImageSize(url('image/gif', gif(300, 200)))).toEqual({ w: 300, h: 200 });
  });

  it('reads JPEG dimensions from the first SOF marker, skipping other segments', () => {
    expect(dataImageSize(url('image/jpeg', jpeg(1024, 768)))).toEqual({ w: 1024, h: 768 });
    expect(dataImageSize(url('image/jpeg', jpeg(800, 600, 0xc2)))).toEqual({ w: 800, h: 600 }); // progressive
  });

  it('reads WebP dimensions (lossy VP8, lossless VP8L and extended VP8X)', () => {
    const vp8 = [...ascii('VP8 '), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(400), ...le16(300)];
    expect(dataImageSize(url('image/webp', riff(vp8)))).toEqual({ w: 400, h: 300 });
    // VP8L: 14-bit (w-1) then 14-bit (h-1), little-endian bit-packed after the 0x2f signature.
    const bits = (500 - 1) | ((250 - 1) << 14);
    const vp8l = [...ascii('VP8L'), 0, 0, 0, 0, 0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255];
    expect(dataImageSize(url('image/webp', riff(vp8l)))).toEqual({ w: 500, h: 250 });
    const vp8x = [...ascii('VP8X'), 0, 0, 0, 0, 0, 0, 0, 0, ...le24(1920 - 1), ...le24(1080 - 1)];
    expect(dataImageSize(url('image/webp', riff(vp8x)))).toEqual({ w: 1920, h: 1080 });
  });

  it('finds a JPEG frame size past a large leading segment (EXIF)', () => {
    const exif = [0xff, 0xe1, 0x10, 0x00, ...new Array(0x1000 - 2).fill(0)]; // a 4 KB APP1
    const sof = [0xff, 0xc0, 0, 11, 8, 0x01, 0x2c, 0x01, 0x90, 1, 1, 0x11, 0]; // 400×300
    expect(dataImageSize(url('image/jpeg', [0xff, 0xd8, ...exif, ...sof]))).toEqual({ w: 400, h: 300 });
  });

  it('finds a JPEG frame size behind > 192 KB of metadata segments', () => {
    const app = [0xff, 0xe1, 0xff, 0xff, ...new Array(0xffff - 2).fill(0)]; // a max-size (64 KB) APP1
    const sof = [0xff, 0xc0, 0, 11, 8, 0x01, 0x2c, 0x01, 0x90, 1, 1, 0x11, 0]; // 400×300
    const bytes = new Uint8Array([0xff, 0xd8, ...app, ...app, ...app, ...app, ...sof]); // 256 KB before SOF
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    expect(dataImageSize(`data:image/jpeg;base64,${btoa(bin)}`)).toEqual({ w: 400, h: 300 });
  });

  it('skips 0xFF fill bytes before a JPEG marker', () => {
    const sof = [0xff, 0xff, 0xff, 0xc0, 0, 11, 8, 0x01, 0x2c, 0x01, 0x90, 1, 1, 0x11, 0];
    expect(dataImageSize(url('image/jpeg', [0xff, 0xd8, ...sof]))).toEqual({ w: 400, h: 300 });
  });

  it('reads SVG size from width/height, else from the viewBox', () => {
    const svg = (attrs) => `data:image/svg+xml;base64,${btoa(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}></svg>`)}`;
    expect(dataImageSize(svg('width="320" height="120px"'))).toEqual({ w: 320, h: 120 });
    expect(dataImageSize(svg('viewBox="0 0 64 48"'))).toEqual({ w: 64, h: 48 });
    expect(dataImageSize(svg('width="100%" height="100%" viewBox="0 0 30, 10"'))).toEqual({ w: 30, h: 10 }); // relative units → viewBox
    // absolute CSS units convert to px (96/in), so mixed units keep the true ratio
    const cm = dataImageSize(svg('width="10cm" height="5cm"'));
    expect(cm.w).toBeCloseTo(10 * 96 / 2.54);
    expect(cm.h).toBeCloseTo(5 * 96 / 2.54);
    expect(dataImageSize(svg('width="1in" height="72pt"'))).toEqual({ w: 96, h: 96 });
    expect(dataImageSize(svg('width="12pc" height="25.4mm"'))).toEqual({ w: 192, h: 96 });
    // no intrinsic ratio at all → null: CSS cover/contain then fill the box, which the stretch fallback matches
    expect(dataImageSize(svg('width="10em" height="5em"'))).toBeNull();
    expect(dataImageSize(svg('width="200"'))).toBeNull();
    expect(dataImageSize('data:image/svg+xml;base64,' + btoa('<svg/>'))).toBeNull();
  });

  it('reads BMP dimensions (a negative height means top-down rows)', () => {
    const le32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const bmp = (w, h) => [...ascii('BM'), ...new Array(12).fill(0), ...le32(40), ...le32(w), ...le32(h >>> 0), 1, 0, 24, 0];
    expect(dataImageSize(url('image/bmp', bmp(200, 100)))).toEqual({ w: 200, h: 100 });
    expect(dataImageSize(url('image/bmp', bmp(200, -100)))).toEqual({ w: 200, h: 100 });
    // OS/2 BITMAPCOREHEADER (12 bytes): unsigned 16-bit width/height at 18/20
    const core = [...ascii('BM'), ...new Array(12).fill(0), ...le32(12), 0x2c, 0x01, 0x96, 0x00, 1, 0, 24, 0, 0, 0];
    expect(dataImageSize(url('image/bmp', core))).toEqual({ w: 300, h: 150 });
  });

  it('reads AVIF / HEIC dimensions from the ispe property', () => {
    const be32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
    const avif = [...be32(24), ...ascii('ftypavif'), 0, 0, 0, 0, ...ascii('avifmif1'), ...be32(20), ...ascii('ispe'), 0, 0, 0, 0, ...be32(1280), ...be32(720)];
    expect(dataImageSize(url('image/avif', avif))).toEqual({ w: 1280, h: 720 });
  });

  it('reads an SVG that starts with a UTF-8 byte-order mark', () => {
    const bom = String.fromCharCode(0xef, 0xbb, 0xbf);
    expect(dataImageSize(`data:image/svg+xml;base64,${btoa(`${bom}<svg width="40" height="10"></svg>`)}`)).toEqual({ w: 40, h: 10 });
  });

  it('accepts media-type parameters before ;base64 (e.g. charset)', () => {
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>');
    expect(dataImageSize(`data:image/svg+xml;charset=utf-8;base64,${svg}`)).toEqual({ w: 40, h: 20 });
    expect(dataImageSize(`data:image/png;name=a.png;base64,${btoa(String.fromCharCode(...png(8, 4)))}`)).toEqual({ w: 8, h: 4 });
  });

  it('returns null for anything it cannot size', () => {
    expect(dataImageSize('')).toBeNull();
    expect(dataImageSize(null)).toBeNull();
    expect(dataImageSize('data:image/svg+xml;base64,' + btoa('<html></html>'))).toBeNull(); // not an svg
    expect(dataImageSize('data:image/tiff;base64,' + btoa('II*\0'))).toBeNull();
    expect(dataImageSize(url('image/avif', [0, 0, 0, 24, ...ascii('ftypavif'), ...new Array(16).fill(0)]))).toBeNull(); // no ispe
    expect(dataImageSize('data:image/png;base64,%%%')).toBeNull();            // not base64
    expect(dataImageSize(url('image/jpeg', [0xff, 0xd8, 0xff, 0xd9]))).toBeNull(); // no SOF
    expect(dataImageSize(url('image/jpeg', [0xff, 0xd8, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull(); // not a marker
    expect(dataImageSize(url('image/png', png(0, 10)))).toBeNull();           // degenerate
    expect(dataImageSize(url('image/webp', riff([...ascii('VP8?'), 0, 0, 0, 0])))).toBeNull();
  });
});
