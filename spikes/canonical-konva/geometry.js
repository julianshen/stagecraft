export const EMU_PER_POINT = 12700;
const positive = n => Number.isFinite(n) && n > 0;
export function viewTransform(size, viewport, zoom = 1) {
  if (![size?.width, size?.height, viewport?.width, viewport?.height, zoom].every(positive)) return null;
  const scale = Math.min(viewport.width / (size.width / EMU_PER_POINT), viewport.height / (size.height / EMU_PER_POINT)) * zoom;
  if (!positive(scale)) return null;
  return { scale, x: (viewport.width - size.width / EMU_PER_POINT * scale) / 2, y: (viewport.height - size.height / EMU_PER_POINT * scale) / 2 };
}
export function moveFromCss(geometry, delta, view) {
  return { x: Math.round(geometry.x + delta.x / view.scale * EMU_PER_POINT), y: Math.round(geometry.y + delta.y / view.scale * EMU_PER_POINT) };
}
export function validGeometry(g) {
  return !!g && [g.x, g.y, g.width, g.height].every(Number.isSafeInteger) && g.width > 0 && g.height > 0 && Number.isFinite(g.rotation ?? 0);
}
export function primitive(object) {
  return object.type === 'shape' && ['rect', 'ellipse'].includes(object.shape) && /^#[0-9a-f]{6}$/i.test(object.fill ?? '') && validGeometry(object.geometry);
}
export function movable(object, extensions) {
  return primitive(object) && (object.extensions?.stagecraftAuthored === true || object.extensions?.editableGeometry === true)
    && !((object.source?.format === 'odp' || extensions?.sourceFormat === 'odp') && (object.geometry.rotation ?? 0) !== 0);
}
export function nodeGeometry(g) {
  return { x: (g.x + g.width / 2) / EMU_PER_POINT, y: (g.y + g.height / 2) / EMU_PER_POINT,
    width: g.width / EMU_PER_POINT, height: g.height / EMU_PER_POINT,
    offsetX: g.width / EMU_PER_POINT / 2, offsetY: g.height / EMU_PER_POINT / 2, rotation: g.rotation ?? 0 };
}
