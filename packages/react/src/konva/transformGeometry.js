export const EMU_PER_PX = 9525;
export const MIN_OBJECT_SIZE_EMU = 12700;
export const MIN_OBJECT_SIZE_PX = MIN_OBJECT_SIZE_EMU / EMU_PER_PX;
export const ROTATION_SNAPS_15 = Object.freeze(
  Array.from({ length: 24 }, (_, index) => index * 15),
);

/**
 * Normalize degrees to the half-open range [0, 360) rounded to 0.01°, returning null for non-finite input.
 */
export function normalizeRotation(degrees) {
  if (!Number.isFinite(degrees)) return null;
  const rounded = Math.round((((degrees % 360) + 360) % 360) * 100) / 100;
  return rounded >= 360 ? 0 : rounded;
}

/**
 * Clamp Transformer boundBoxFunc results to a minimum stage-pixel dimension without flipping.
 */
export function clampTransformBox(oldBox, newBox, minStagePx) {
  if (!newBox || !Number.isFinite(newBox.width) || !Number.isFinite(newBox.height)) return oldBox;
  if (newBox.width >= minStagePx && newBox.height >= minStagePx) return newBox;

  // Stop aspect-locked (Shift) resize when either axis drops below minStagePx so the ratio holds.
  if (
    oldBox.width > 0
    && oldBox.height > 0
    && newBox.width > 0
    && newBox.height > 0
    && Math.abs(newBox.width / newBox.height - oldBox.width / oldBox.height) < 1e-3
  ) {
    return oldBox;
  }

  const rot = oldBox.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = newBox.x - oldBox.x;
  const dy = newBox.y - oldBox.y;
  const localDx = dx * cos + dy * sin;
  const localDy = -dx * sin + dy * cos;

  // Per local axis: a too-small size grows to the minimum when its leading edge stayed put; otherwise the axis keeps the old box.
  const axis = (oldSize, d, newSize) => {
    if (newSize >= minStagePx) return [d, newSize];
    return Math.abs(d) < 1e-4 ? [d, minStagePx] : [0, oldSize];
  };
  const [outDx, width] = axis(oldBox.width, localDx, newBox.width);
  const [outDy, height] = axis(oldBox.height, localDy, newBox.height);
  if (width < minStagePx || height < minStagePx) return oldBox;
  const x = rot === 0 ? oldBox.x + outDx : oldBox.x + (outDx * cos - outDy * sin);
  const y = rot === 0 ? oldBox.y + outDy : oldBox.y + (outDx * sin + outDy * cos);
  return { ...newBox, x, y, width, height };
}

/**
 * Normalize transient Konva node transform state into canonical integer EMU geometry.
 */
export function normalizeTransformGeometry({
  centerX,
  centerY,
  widthPx,
  heightPx,
  scaleX,
  scaleY,
  rotation,
  startGeometry,
}) {
  if (
    ![centerX, centerY, widthPx, heightPx, scaleX, scaleY].every(
      Number.isFinite,
    )
    || scaleX <= 0
    || scaleY <= 0
    || widthPx <= 0
    || heightPx <= 0
  ) {
    return null;
  }
  if (!Number.isFinite(rotation)) return null;
  const startRotation = startGeometry?.rotation;
  const rawMod = ((rotation % 360) + 360) % 360;
  let finalRotation;
  if (startRotation !== undefined && Number.isFinite(startRotation)) {
    const startMod = ((startRotation % 360) + 360) % 360;
    const delta = Math.abs(rawMod - startMod);
    if (Math.min(delta, 360 - delta) < 1e-6) {
      finalRotation = startRotation;
    } else {
      finalRotation = normalizeRotation(rotation);
      if (finalRotation === null) return null;
    }
  } else {
    finalRotation = normalizeRotation(rotation);
    if (finalRotation === null) return null;
  }

  const width = Math.max(MIN_OBJECT_SIZE_EMU, Math.round(widthPx * scaleX * EMU_PER_PX));
  const height = Math.max(MIN_OBJECT_SIZE_EMU, Math.round(heightPx * scaleY * EMU_PER_PX));
  const x = Math.round(centerX * EMU_PER_PX - width / 2);
  const y = Math.round(centerY * EMU_PER_PX - height / 2);
  if (![x, y, width, height].every(Number.isSafeInteger)) return null;

  const hasStartRotation = startRotation !== undefined;
  const result = {
    ...startGeometry,
    x,
    y,
    width,
    height,
  };
  if (finalRotation !== 0 || hasStartRotation) {
    result.rotation = finalRotation;
  }
  return result;
}

/**
 * Compare canonical geometry objects for no-op detection after normalization.
 */
export function geometriesEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.x === b.x
    && a.y === b.y
    && a.width === b.width
    && a.height === b.height
    && (a.rotation ?? 0) === (b.rotation ?? 0)
  );
}
