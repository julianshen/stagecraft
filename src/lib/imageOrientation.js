// EXIF orientation for the PPTX export. A phone JPEG is often stored landscape
// with an EXIF tag saying "display rotated"; the canvas <img> honours the tag,
// but pptxgenjs embeds the raw bytes and PowerPoint versions differ on applying
// it, so the picture could export sideways. The export therefore swaps each
// rotated JPEG for an upright re-encode (on the exported copy only — the stored
// deck keeps the original bytes, colour profile and quality), whichever path
// put it in the deck: the picker, an MCP agent, the Co-pilot or a .pptx import.

/** A JPEG's EXIF Orientation (1–8; 1 = stored upright), from the TIFF IFD0 in its APP1 segment. Unreadable → 1. */
export function jpegOrientation(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  for (let at = 2; at + 4 <= b.length;) {
    if (b[at] !== 0xff) return 1;
    const len = (b[at + 2] << 8) | b[at + 3];
    if (b[at + 1] === 0xe1 && String.fromCharCode(...b.subarray(at + 4, at + 10)) === 'Exif\0\0') {
      const t = at + 10; // TIFF header: 'II' little-endian, else 'MM'
      const le = b[t] === 0x49;
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const ifd = le ? u16(4) | (u16(6) << 16) : (u16(4) << 16) | u16(6);
      for (let i = 0, n = u16(ifd); i < n; i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) {
          const o = u16(entry + 8);
          return o >= 1 && o <= 8 ? o : 1;
        }
      }
      return 1;
    }
    at += 2 + len;
  }
  return 1;
}

const JPEG_B64 = /^data:image\/jpe?g(?:;[^;,]*)*;base64,/i;
const HEAD_B64 = 87384; // base64 chars ≈ 64 KB decoded (a multiple of 4) — APP1 sits at the front

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// The upright re-encode of a rotated JPEG data URL; anything else (or any
// failure) → the src unchanged.
async function upright(src) {
  const m = JPEG_B64.exec(src);
  if (!m || typeof createImageBitmap !== 'function') return src;
  const head = Uint8Array.from(atob(src.slice(m[0].length, m[0].length + HEAD_B64)), (c) => c.charCodeAt(0));
  if (jpegOrientation(head) === 1) return src;
  const bitmap = await createImageBitmap(await (await fetch(src)).blob(), { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    return blob ? await blobToDataUrl(blob) : src;
  } finally {
    bitmap.close?.();
    canvas.width = canvas.height = 0; // release the full-size backing store now, not at GC
  }
}

/** The deck with every rotated JPEG image upright; the same deck when there are none. */
export async function uprightImages(deck) {
  if (!Array.isArray(deck?.slides)) return deck;
  const cache = new Map(); // src → Promise<src>: a picture repeated across slides is decoded once
  const fix = (src) => {
    if (!cache.has(src)) cache.set(src, upright(src).catch(() => src));
    return cache.get(src);
  };
  let changed = false;
  const slides = await Promise.all(deck.slides.map(async (slide) => {
    if (!Array.isArray(slide?.elements)) return slide;
    const elements = await Promise.all(slide.elements.map(async (el) => {
      if (el?.type !== 'image' || typeof el.src !== 'string') return el;
      const src = await fix(el.src);
      return src === el.src ? el : { ...el, src };
    }));
    if (elements.every((el, i) => el === slide.elements[i])) return slide;
    changed = true;
    return { ...slide, elements };
  }));
  return changed ? { ...deck, slides } : deck;
}
