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

const isSofMarker = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

// Walk a JPEG's header segments (up to start-of-scan) for the EXIF Orientation
// — its value and where it sits — and the stored frame size.
function scanJpeg(b) {
  const info = { orientation: 1, at: -1, le: true, w: 0, h: 0 };
  if (b[0] !== 0xff || b[1] !== 0xd8) return info;
  for (let at = 2; at + 4 <= b.length;) {
    if (b[at] !== 0xff) break;
    while (b[at + 1] === 0xff) at++; // fill bytes may pad a marker
    const marker = b[at + 1];
    if (marker === 0xda || marker === 0xd9) break; // entropy-coded data / end: no more headers
    const len = (b[at + 2] << 8) | b[at + 3];
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(at + 4, at + 10)) === 'Exif\0\0') {
      const t = at + 10; // TIFF header: 'II' little-endian, else 'MM'
      const le = b[t] === 0x49;
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const ifd = le ? u16(4) | (u16(6) << 16) : (u16(4) << 16) | u16(6);
      for (let i = 0, n = u16(ifd); i < n; i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) {
          const o = u16(entry + 8);
          if (o >= 1 && o <= 8) Object.assign(info, { orientation: o, at: t + entry + 8, le });
          break;
        }
      }
    } else if (isSofMarker(marker)) {
      info.h = (b[at + 5] << 8) | b[at + 6];
      info.w = (b[at + 7] << 8) | b[at + 8];
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
// orientation, for the EXIF cases that swap width and height (5–8): canvas
// transform(a, b, c, d, e, f) maps (x, y) → (ax + cy + e, bx + dy + f).
const TURN = {
  5: () => [0, 1, 1, 0, 0, 0],             // transpose: (y, x)
  6: (w, h) => [0, 1, -1, 0, h, 0],        // 90° clockwise: (h − y, x)
  7: (w, h) => [0, -1, -1, 0, h, w],       // transverse: (h − y, w − x)
  8: (w) => [0, -1, 1, 0, 0, w],           // 90° anticlockwise: (y, w − x)
};

// The upright re-encode of a rotated JPEG data URL; anything else → src.
async function upright(src) {
  const jpeg = jpegBytes(src);
  const info = jpeg && scanJpeg(jpeg.bytes);
  if (!info || info.orientation === 1) return src;
  const o = info.orientation;
  const bitmap = await createImageBitmap(new Blob([jpeg.bytes], { type: 'image/jpeg' }), { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  try {
    // A browser that ignores imageOrientation hands back the stored raster —
    // detectable for the transposing cases (5–8, which include the phone
    // portrait ones) by its unswapped size — so turn it here instead. The
    // same-size flips (2–4) can't be told apart and are left to the browser.
    const turnHere = o >= 5 && info.w !== info.h && bitmap.width === info.w && bitmap.height === info.h;
    const ctx = canvas.getContext('2d');
    if (turnHere) {
      canvas.width = info.h;
      canvas.height = info.w;
      ctx.transform(...TURN[o](info.w, info.h));
    } else {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    return blob ? await blobToDataUrl(blob) : src;
  } finally {
    bitmap.close?.();
    canvas.width = canvas.height = 0; // release the full-size backing store now, not at GC
  }
}

/** The slides with every rotated JPEG picture upright (copies); the same array when there are none. */
export async function uprightSlides(slides) {
  if (typeof createImageBitmap !== 'function') return slides;
  const isImage = (el) => el?.type === 'image' && typeof el.src === 'string';
  const elementsOf = (slide) => (Array.isArray(slide?.elements) ? slide.elements : []);
  // One picture at a time: a full-size bitmap + canvas is ~48 MB for a 12 MP
  // photo. Each distinct src is converted once, however many slides repeat it.
  const fixed = new Map();
  for (const el of slides.flatMap(elementsOf).filter(isImage)) {
    if (!fixed.has(el.src)) fixed.set(el.src, await upright(el.src).catch(() => el.src));
  }
  const turned = (el) => isImage(el) && fixed.get(el.src) !== el.src;
  if (!slides.some((slide) => elementsOf(slide).some(turned))) return slides;
  return slides.map((slide) => (elementsOf(slide).some(turned)
    ? { ...slide, elements: slide.elements.map((el) => (turned(el) ? { ...el, src: fixed.get(el.src) } : el)) }
    : slide));
}
