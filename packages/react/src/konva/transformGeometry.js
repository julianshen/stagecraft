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
  // Per axis: a too-small size grows to the minimum when its leading edge stayed put; otherwise the axis keeps the old box.
  const axis = (oldPos, oldSize, newPos, newSize) => {
    if (newSize >= minStagePx) return [newPos, newSize];
    return Math.abs(newPos - oldPos) < 1e-6 ? [newPos, minStagePx] : [oldPos, oldSize];
  };
  const [x, width] = axis(oldBox.x, oldBox.width, newBox.x, newBox.width);
  const [y, height] = axis(oldBox.y, oldBox.height, newBox.y, newBox.height);
  if (width < minStagePx || height < minStagePx) return oldBox;
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
  const normalizedRotation = normalizeRotation(rotation);
  if (normalizedRotation === null) return null;

  const width = Math.max(MIN_OBJECT_SIZE_EMU, Math.round(widthPx * scaleX * EMU_PER_PX));
  const height = Math.max(MIN_OBJECT_SIZE_EMU, Math.round(heightPx * scaleY * EMU_PER_PX));
  const x = Math.round(centerX * EMU_PER_PX - width / 2);
  const y = Math.round(centerY * EMU_PER_PX - height / 2);
  if (![x, y, width, height].every(Number.isSafeInteger)) return null;

  const hasStartRotation = startGeometry?.rotation !== undefined;
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
