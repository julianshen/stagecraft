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

/** A Blob/File as a data URL. */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

export async function readImageFile(file) {
  if (!file) throw new Error('no file');
  // `accept="image/*"` filters the OS dialog but doesn't guarantee it (drag/drop,
  // "all files"), so validate before reading the bytes into a base64 string.
  if (!file.type?.startsWith('image/')) throw new Error('That file is not an image');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('That image is too large (max 10 MB)');
  return blobToDataUrl(file);
}
