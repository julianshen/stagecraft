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
  if (typeof degrees !== 'number' || !Number.isFinite(degrees)) return null;
  const wrapped = ((degrees % 360) + 360) % 360;
  const rounded = Math.round(wrapped * 100) / 100;
  if (rounded >= 360 || Object.is(rounded, -0)) return 0;
  return rounded;
}

/**
 * Clamp Transformer boundBoxFunc results to a minimum stage-pixel dimension without flipping.
 */
export function clampTransformBox(oldBox, newBox, minStagePx) {
  if (!newBox || !Number.isFinite(newBox.width) || !Number.isFinite(newBox.height)) {
    return oldBox;
  }
  const width = newBox.width < minStagePx ? (Math.abs(newBox.x - oldBox.x) < 1e-6 ? minStagePx : oldBox.width) : newBox.width;
  const height = newBox.height < minStagePx ? (Math.abs(newBox.y - oldBox.y) < 1e-6 ? minStagePx : oldBox.height) : newBox.height;
  if (width < minStagePx || height < minStagePx) return oldBox;
  return {
    ...newBox,
    x: newBox.width < minStagePx && Math.abs(newBox.x - oldBox.x) >= 1e-6 ? oldBox.x : newBox.x,
    y: newBox.height < minStagePx && Math.abs(newBox.y - oldBox.y) >= 1e-6 ? oldBox.y : newBox.y,
    width,
    height,
  };
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
      v => typeof v === 'number' && Number.isFinite(v),
    )
    || scaleX <= 0
    || scaleY <= 0
    || widthPx <= 0
    || heightPx <= 0
  ) {
    return null;
  }
  const normalizedRotation = normalizeRotation(rotation);
  if (normalizedRotation === null) return null;

  const width = Math.max(MIN_OBJECT_SIZE_EMU, Math.round(widthPx * scaleX * EMU_PER_PX));
  const height = Math.max(MIN_OBJECT_SIZE_EMU, Math.round(heightPx * scaleY * EMU_PER_PX));
  const x = Math.round(centerX * EMU_PER_PX - width / 2);
  const y = Math.round(centerY * EMU_PER_PX - height / 2);
  if (![x, y, width, height].every(Number.isSafeInteger)) return null;

  const hasStartRotation = startGeometry != null && Object.hasOwn(startGeometry, 'rotation') && startGeometry.rotation !== undefined;
  const result = {
    ...startGeometry,
    x,
    y,
    width,
    height,
  };
  if (normalizedRotation !== 0 || hasStartRotation) {
    result.rotation = normalizedRotation;
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
