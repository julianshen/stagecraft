// Read a user-picked image File into a data URL (so the image embeds in the deck
// and survives the in-memory/disk round-trip without any network fetch). Isolated
// from the component so the async FileReader path is unit-testable.
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
