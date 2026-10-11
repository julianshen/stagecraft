// An embedded image's natural pixel size, read from its data-URL header — no
// decode, no DOM, so the PPTX export can size a `cover`/`contain` picture the
// way the canvas's object-fit does. PNG, GIF, JPEG, WebP, BMP, SVG and AVIF/
// HEIC; anything else (TIFF, a malformed payload) → null, and the caller falls
// back to stretching.

// Headers sit at the front: PNG/GIF/WebP/BMP need < 32 bytes, so decode a
// small prefix (base64 chars, a multiple of 4). JPEG (SOF after any amount of
// metadata), SVG (size in its root tag's attributes) and AVIF/HEIC (an ispe box
// inside meta) may need more, so those are decoded whole (once per picture, at
// export).
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
const le32s = (b, at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24); // signed
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

// An SVG's size: absolute width/height on the root tag (unitless or px), else
// its viewBox's width/height — the canvas sizes a relative-unit SVG the same way.
const SVG_LEN = /^\s*([\d.]+)(px)?\s*$/;
function svgSize(b) {
  let text = '';
  for (let i = 0; i < b.length; i++) text += String.fromCharCode(b[i]);
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = (name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const w = SVG_LEN.exec(attr('width') ?? ''), h = SVG_LEN.exec(attr('height') ?? '');
  if (w && h) return { w: Number(w[1]), h: Number(h[1]) };
  const vb = (attr('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  return vb.length === 4 && vb.every(Number.isFinite) ? { w: vb[2], h: vb[3] } : null;
}

// AVIF/HEIC (ISO-BMFF): the image's spatial extent lives in an `ispe` property
// box — 4 bytes of version/flags, then width and height (big-endian).
function ispeSize(b) {
  for (let i = 8; i + 16 <= b.length; i++) {
    if (ascii(b, i, 'ispe')) return { w: be32(b, i + 8), h: be32(b, i + 12) };
  }
  return null;
}

const isXml = (b) => /^\s*</.test(String.fromCharCode(...b.subarray(0, 16))); // SVG
const isIsoBmff = (b) => ascii(b, 4, 'ftyp'); // AVIF / HEIC
// Formats whose size can sit beyond the decoded head (see HEAD_CHARS).
const needsWhole = (b) => (b[0] === 0xff && b[1] === 0xd8) || isIsoBmff(b) || isXml(b);

function sizeOf(b) {
  if (b.length >= 26 && ascii(b, 0, 'BM')) return { w: Math.abs(le32s(b, 18)), h: Math.abs(le32s(b, 22)) };
  if (isIsoBmff(b)) return ispeSize(b);
  if (isXml(b)) return svgSize(b);
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 'PNG')) return { w: be32(b, 16), h: be32(b, 20) };
  if (b.length >= 10 && ascii(b, 0, 'GIF8')) return { w: le16(b, 6), h: le16(b, 8) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  if (b.length >= 16 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return webpSize(b);
  return null;
}

/** `{ w, h }` in pixels for a PNG/GIF/JPEG/WebP data URL, else null. */
export function dataImageSize(dataUrl) {
  let b = bytesOf(dataUrl, HEAD_CHARS);
  if (b && needsWhole(b)) b = bytesOf(dataUrl);
  const size = b && sizeOf(b);
  return size && size.w > 0 && size.h > 0 ? size : null;
}
