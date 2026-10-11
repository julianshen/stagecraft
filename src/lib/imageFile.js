// Read a user-picked image File into a data URL (so the image embeds in the deck
// and survives the in-memory/disk round-trip without any network fetch). Isolated
// from the component so the async FileReader path is unit-testable.
//
// Tradeoff (acceptable for a single-user local tool): a full-res photo is several
// MB of base64 that rides inside the deck JSON — re-serialized and re-PUT on every
// debounced sync, and persisted to `.stagecraft-decks.json`. If decks grow heavy
// with images, an object-URL / blob-store design would be the next step.
// Cap the embedded size: a data URL rides inside the deck JSON and is re-PUT on
// every sync, so a huge photo would bloat memory/disk and lag editing.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

// A JPEG's EXIF Orientation (1–8; 1 = stored upright), from the TIFF IFD0 in
// its APP1 segment. Anything unreadable → 1.
export function jpegOrientation(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  for (let at = 2; at + 4 <= b.length;) {
    if (b[at] !== 0xff) return 1;
    const marker = b[at + 1];
    const len = (b[at + 2] << 8) | b[at + 3];
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(at + 4, at + 10)) === 'Exif\0\0') {
      const t = at + 10; // TIFF header
      const le = b[t] === 0x49; // 'II' little-endian, else 'MM'
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const u32 = (o) => (le ? u16(o) | (u16(o + 2) << 16) : (u16(o) << 16) | u16(o + 2)) >>> 0;
      const ifd = u32(4);
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

// EXIF orientation only rides in metadata: the <img> on the canvas honours it,
// but pptxgenjs embeds the raw bytes and PowerPoint versions differ on applying
// it, so a phone photo could export sideways (and cover/contain sizing would
// crop the stored, not the displayed, raster). Bake it in once, at insert:
// decode upright and re-encode, so every consumer sees the same pixels. Only a
// rotated JPEG is touched; anything that fails keeps the original.
const HEAD_B64 = 87384; // ≈ 64 KB decoded — EXIF sits in APP1, at the front
async function uprightJpeg(file, dataUrl) {
  try {
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 1 + HEAD_B64));
    const head = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    if (jpegOrientation(head) === 1 || typeof createImageBitmap !== 'function') return dataUrl;
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch {
    return dataUrl;
  }
}

export function readImageFile(file) {
  return readDataUrl(file).then((url) => (file.type === 'image/jpeg' ? uprightJpeg(file, url) : url));
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('no file'));
      return;
    }
    // `accept="image/*"` filters the OS dialog but doesn't guarantee it (drag/drop,
    // "all files"), so validate before reading the bytes into a base64 string.
    if (!file.type?.startsWith('image/')) {
      reject(new Error('That file is not an image'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('That image is too large (max 10 MB)'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
