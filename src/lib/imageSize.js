// An embedded image's natural pixel size, read from its data-URL header — no
// decode, no DOM, so the PPTX export can size a `cover`/`contain` picture the
// way the canvas's object-fit does. PNG, GIF, JPEG and WebP; anything else
// (SVG, a malformed payload) → null, and the caller falls back to stretching.

// Headers sit at the front: PNG/GIF/WebP need < 32 bytes, so decode a small
// prefix (base64 chars, a multiple of 4). Only a JPEG may need more — its SOF
// can trail any amount of EXIF/XMP/ICC metadata — so a JPEG is decoded whole
// (once per picture, at export).
const HEAD_CHARS = 64;

function bytesOf(dataUrl, chars) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:image\/[\w.+-]+;base64,/i.exec(dataUrl);
  if (!m) return null;
  try {
    const body = dataUrl.slice(m[0].length);
    const bin = atob(chars ? body.slice(0, chars) : body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null; // not base64
  }
}

const ascii = (b, at, s) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
const be16 = (b, at) => (b[at] << 8) | b[at + 1];
const le16 = (b, at) => b[at] | (b[at + 1] << 8);
const le24 = (b, at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const be32 = (b, at) => ((b[at] << 24) >>> 0) + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);

function jpegSize(b) {
  let at = 2; // past SOI
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    while (b[at + 1] === 0xff) at++; // fill bytes may pad a marker
    const marker = b[at + 1];
    // SOF0–SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { w: be16(b, at + 7), h: be16(b, at + 5) };
    }
    at += 2 + be16(b, at + 2); // skip this segment (its length includes the 2 length bytes)
  }
  return null;
}

function webpSize(b) {
  if (ascii(b, 12, 'VP8 ')) return { w: le16(b, 26) & 0x3fff, h: le16(b, 28) & 0x3fff };
  if (ascii(b, 12, 'VP8L')) {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, 'VP8X')) return { w: le24(b, 24) + 1, h: le24(b, 27) + 1 };
  return null;
}

function sizeOf(b) {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 'PNG')) return { w: be32(b, 16), h: be32(b, 20) };
  if (b.length >= 10 && ascii(b, 0, 'GIF8')) return { w: le16(b, 6), h: le16(b, 8) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  if (b.length >= 16 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return webpSize(b);
  return null;
}

/** `{ w, h }` in pixels for a PNG/GIF/JPEG/WebP data URL, else null. */
export function dataImageSize(dataUrl) {
  let b = bytesOf(dataUrl, HEAD_CHARS);
  if (b && b[0] === 0xff && b[1] === 0xd8) b = bytesOf(dataUrl); // JPEG: scan the whole file
  const size = b && sizeOf(b);
  return size && size.w > 0 && size.h > 0 ? size : null;
}
