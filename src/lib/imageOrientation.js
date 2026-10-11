// EXIF orientation. A phone JPEG is often stored landscape with an EXIF tag
// saying "display rotated". The canvas <img> honours the tag; PowerPoint does
// not apply it to an embedded picture. So a deck's pictures are kept in one
// model — the pixels you see on the canvas — on both sides of the PPTX bridge:
//  - export (uprightSlides): a rotated JPEG is decoded upright and re-encoded,
//    on the exported copy only, whichever path put it in the deck (picker, MCP
//    agent, Co-pilot). The cost lands on that copy alone: a second JPEG
//    generation and the embedded colour profile (a wide-gamut photo is drawn
//    through an sRGB canvas). The stored deck keeps the original bytes.
//  - import (clearOrientation): a picture PowerPoint drew unrotated gets its tag
//    reset to 1 — a lossless two-byte patch — so the canvas draws it as
//    PowerPoint did, and its export then leaves it alone.
import { blobToDataUrl } from './imageFile.js';

// Walk a JPEG's header segments (up to start-of-scan) for the EXIF Orientation:
// its value and where it sits.
function scanJpeg(b) {
  const info = { orientation: 1, at: -1, le: true };
  if (b[0] !== 0xff || b[1] !== 0xd8) return info;
  for (let at = 2; at + 4 <= b.length;) {
    if (b[at] !== 0xff) break;
    while (b[at + 1] === 0xff) at++; // fill bytes may pad a marker
    const marker = b[at + 1];
    if (marker === 0xda || marker === 0xd9) break; // entropy-coded data / end: no more headers
    const len = (b[at + 2] << 8) | b[at + 3];
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(at + 4, at + 10)) === 'Exif\0\0') {
      const t = at + 10; // TIFF header: 'II' little-endian or 'MM' big-endian; anything else is unreadable
      const size = at + 2 + len - t; // TIFF bytes this APP1 holds: every read stays inside them
      const le = b[t] === 0x49 && b[t + 1] === 0x49;
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const u32 = (o) => (le ? u16(o) + u16(o + 2) * 0x10000 : u16(o) * 0x10000 + u16(o + 2));
      const ifd = u32(4);
      const valid = size >= 8 && (le || (b[t] === 0x4d && b[t + 1] === 0x4d)) && u16(2) === 42 && ifd + 2 <= size;
      for (let i = 0, n = valid ? u16(ifd) : 0; i < n && ifd + 2 + (i + 1) * 12 <= size; i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) {
          // A well-formed Orientation is one SHORT (type 3, count 1), held inline in
          // the entry's value field; anything else would make that field an offset.
          const inline = u16(entry + 2) === 3 && u32(entry + 4) === 1;
          const o = u16(entry + 8);
          if (inline && o >= 1 && o <= 8) Object.assign(info, { orientation: o, at: t + entry + 8, le });
          break;
        }
      }
    }
    at += 2 + len;
  }
  return info;
}

/** A JPEG's EXIF Orientation (1–8; 1 = stored upright). Unreadable → 1. */
export const jpegOrientation = (bytes) => scanJpeg(bytes).orientation;

const JPEG_B64 = /^data:image\/jpe?g(?:;[^;,]*)*;base64,/i;
function decode(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
// A JPEG data URL's header and bytes, else null.
function jpegBytes(src) {
  const m = JPEG_B64.exec(src);
  if (!m) return null;
  try {
    return { head: m[0], bytes: decode(src.slice(m[0].length)) };
  } catch {
    return null; // not base64
  }
}

/** The JPEG data URL with its EXIF Orientation reset to 1 (a two-byte patch); anything else unchanged. */
export function clearOrientation(src) {
  const jpeg = jpegBytes(src);
  const info = jpeg && scanJpeg(jpeg.bytes);
  if (!info || info.orientation === 1) return src;
  jpeg.bytes[info.at] = info.le ? 1 : 0;
  jpeg.bytes[info.at + 1] = info.le ? 0 : 1;
  return jpeg.head + encode(jpeg.bytes);
}

// The canvas transform that draws a stored w×h raster in its displayed
// orientation — the EXIF spec's eight cases (5–8 also swap width and height):
// canvas transform(a, b, c, d, e, f) maps (x, y) → (ax + cy + e, bx + dy + f).
const TURN = {
  2: (w) => [-1, 0, 0, 1, w, 0],           // mirror: (w − x, y)
  3: (w, h) => [-1, 0, 0, -1, w, h],       // 180°: (w − x, h − y)
  4: (w, h) => [1, 0, 0, -1, 0, h],        // flip: (x, h − y)
  5: () => [0, 1, 1, 0, 0, 0],             // transpose: (y, x)
  6: (w, h) => [0, 1, -1, 0, h, 0],        // 90° clockwise: (h − y, x)
  7: (w, h) => [0, -1, -1, 0, h, w],       // transverse: (h − y, w − x)
  8: (w) => [0, -1, 1, 0, 0, w],           // 90° anticlockwise: (y, w − x)
};

// A JPEG decoded for drawing, with its size read up front (a closed
// ImageBitmap reports 0×0): createImageBitmap where it takes the
// imageOrientation option, else an <img> — Safari 14 has no createImageBitmap,
// and older engines (Chrome 87, Firefox < 111) reject 'from-image'. Both apply
// EXIF orientation where the browser does.
async function decodeJpeg(bytes) {
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
    } catch {
      // fall through to <img>; a picture neither can decode fails there
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close() {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Whether this browser's decode honours EXIF orientation — told by a 2×1 JPEG
// tagged orientation 6, which comes back 1×2 if it does. Asking once covers
// every case (flips, squares) that no single picture's size can.
const PROBE = '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAAD//Z';
async function honoursOrientation() {
  const probe = await decodeJpeg(decode(PROBE));
  probe.close();
  return probe.width === 1 && probe.height === 2;
}

// The upright re-encode of a rotated JPEG data URL; anything else → src.
// `browserTurns()` resolves whether the decode already applies the orientation.
async function upright(src, browserTurns) {
  const jpeg = jpegBytes(src);
  const o = jpeg ? scanJpeg(jpeg.bytes).orientation : 1;
  if (o === 1) return src;
  const turnHere = !(await browserTurns());
  const picture = await decodeJpeg(jpeg.bytes);
  const canvas = document.createElement('canvas');
  try {
    const { width: w, height: h } = picture;
    const ctx = canvas.getContext('2d');
    // Turned by the browser: draw as is. Otherwise the picture is the stored
    // raster, so apply the orientation here.
    const swap = turnHere && o >= 5;
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;
    if (turnHere) ctx.transform(...TURN[o](w, h));
    ctx.drawImage(picture.source, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    return blob ? await blobToDataUrl(blob) : src;
  } finally {
    picture.close();
    canvas.width = canvas.height = 0; // release the full-size backing store now, not at GC
  }
}

/** The slides with every rotated JPEG picture upright (copies); the same array when there are none. */
export async function uprightSlides(slides) {
  const isImage = (el) => el?.type === 'image' && typeof el.src === 'string';
  const elementsOf = (slide) => (Array.isArray(slide?.elements) ? slide.elements : []);
  // One picture at a time: a full-size bitmap + canvas is ~48 MB for a 12 MP
  // photo. Each distinct src is converted once, however many slides repeat it.
  // The probe runs once, and only if a rotated picture turns up.
  let probe;
  const browserTurns = () => (probe ??= honoursOrientation());
  const fixed = new Map();
  for (const el of slides.flatMap(elementsOf).filter(isImage)) {
    if (!fixed.has(el.src)) fixed.set(el.src, await upright(el.src, browserTurns).catch(() => el.src));
  }
  const turned = (el) => isImage(el) && fixed.get(el.src) !== el.src;
  if (!slides.some((slide) => elementsOf(slide).some(turned))) return slides;
  return slides.map((slide) => (elementsOf(slide).some(turned)
    ? { ...slide, elements: slide.elements.map((el) => (turned(el) ? { ...el, src: fixed.get(el.src) } : el)) }
    : slide));
}
