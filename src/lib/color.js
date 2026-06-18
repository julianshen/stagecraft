// Normalize a fill to a lowercase #rrggbb hex for <input type=color>, which
// requires exactly that form. Expands #rgb shorthand; falls back to indigo for
// a non-hex value. Shared by the inspector (PropsPanel) and the inline
// formatting toolbar so both render the same swatch for the same stored colour.
export function toHex(fill) {
  if (typeof fill !== 'string') return '#4f46e5';
  let h = fill.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) h = '#' + h.slice(1).split('').map((c) => c + c).join('');
  return /^#[0-9a-f]{6}$/.test(h) ? h : '#4f46e5';
}

// Is `v` a #rgb or #rrggbb hex string? Used to gate a fill colour to a value
// that renders identically on the canvas (CSS) and in the export (`toHex`) — a
// CSS colour name renders on canvas but exports as the indigo fallback.
export const isHexColor = (v) => typeof v === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v);
