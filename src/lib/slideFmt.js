// Per-field text formatting overrides for template slide fields (titles, bullets,
// …). A slide carries `fmt`, a map from a field's path-key to a flat record of
// formatting props; the renderer merges these over the field's template style.
// Single source of truth for the key encoding and the prop→CSS mapping, shared
// by the renderer, the floating toolbar, and the validation gate.

// The stable map key for a field, derived from its render path. Joining with
// dots keeps it a primitive (so it survives the slide-patch validation as an
// object key) and matches the path the toolbar/renderer already know.
//   fmtKey(['title']) -> 'title'   fmtKey(['items', 2, 't']) -> 'items.2.t'
export function fmtKey(path) {
  return path.join('.');
}

// Translate a formatting record into a CSS style object, emitting ONLY the props
// that are set. A toggle stored as `false` (or absent) contributes nothing, so
// un-bolding a field returns it to the template's baseline weight rather than
// forcing 400 — formatting is relative to the field, not absolute.
export function fmtStyle(fmt) {
  if (!fmt) return {};
  const style = {};
  if (fmt.bold) style.fontWeight = 700;
  if (fmt.italic) style.fontStyle = 'italic';
  if (fmt.underline) style.textDecoration = 'underline';
  // A bare number renders as px — matching the slide's fixed 1920×1080 px space
  // (a future PPTX consumer will need px→pt at the export boundary).
  if (fmt.fontSize != null) style.fontSize = fmt.fontSize;
  if (fmt.color != null) style.color = fmt.color;
  return style;
}
