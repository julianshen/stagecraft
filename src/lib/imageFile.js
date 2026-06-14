// Read a user-picked image File into a data URL (so the image embeds in the deck
// and survives the in-memory/disk round-trip without any network fetch). Isolated
// from the component so the async FileReader path is unit-testable.
//
// Tradeoff (acceptable for a single-user local tool): a full-res photo is several
// MB of base64 that rides inside the deck JSON — re-serialized and re-PUT on every
// debounced sync, and persisted to `.stagecraft-decks.json`. If decks grow heavy
// with images, an object-URL / blob-store design would be the next step.
export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('no file'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
