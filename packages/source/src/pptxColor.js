import { child, children, is } from './xml.js';

const DEFAULT_COLOR_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
const COLOR_MAP_SLOTS = ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
const COLOR_TARGETS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
const clamp = value => Math.max(0, Math.min(1, value));
const hexRgb = value => {
  const hex = typeof value === 'string' && value.startsWith('#') ? value.slice(1) : value;
  return /^[0-9a-f]{6}$/i.test(hex ?? '')
    ? [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    : null;
};
const toHsl = rgb => {
  const [r, g, b] = rgb, max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const lightness = (max + min) / 2;
  if (delta < 1e-12) return [0, 0, lightness];
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0)
    : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue / 6, delta / (1 - Math.abs(2 * lightness - 1)), lightness];
};
const fromHsl = hsl => {
  let [h, s, l] = hsl.map(clamp);
  h = ((h % 1) + 1) % 1;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  const rgb = h < 1 / 6 ? [c, x, 0] : h < 2 / 6 ? [x, c, 0]
    : h < 3 / 6 ? [0, c, x] : h < 4 / 6 ? [0, x, c]
      : h < 5 / 6 ? [x, 0, c] : [c, 0, x];
  return rgb.map(value => value + m);
};
const applyTransforms = (node, rgb) => {
  let hsl = null;
  for (const transform of children(node)) {
    const name = transform.localName;
    if (name !== 'lumMod' && name !== 'lumOff') return null;
    const raw = transform.getAttribute('val');
    if (!/^\d+$/.test(raw ?? '')) return null;
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) return null;
    hsl ??= toHsl(rgb);
    hsl[2] = name === 'lumMod' ? hsl[2] * value / 100000 : hsl[2] + value / 100000;
    hsl[2] = clamp(hsl[2]);
    rgb = fromHsl(hsl);
  }
  return rgb;
};
const rgbHex = rgb => '#' + rgb.map(value => Math.round(clamp(value) * 255 + 1e-8)
  .toString(16).padStart(2, '0')).join('').toUpperCase();

export function readPptxColorMap(node) {
  const map = {};
  for (const slot of COLOR_MAP_SLOTS) {
    const value = node?.getAttribute(slot);
    if (value && COLOR_TARGETS.includes(value)) map[slot] = value;
  }
  return map;
}

/** Resolve one DrawingML colour node using an already-resolved theme palette. */
export function resolvePptxColor(node, palette = {}, colorMap = {}) {
  if (!node) return null;
  let rgb = null;
  if (is(node, 'a', 'srgbClr')) rgb = hexRgb(node.getAttribute('val'));
  else if (is(node, 'a', 'sysClr')) rgb = hexRgb(node.getAttribute('lastClr'));
  else if (is(node, 'a', 'schemeClr')) {
    const slot = node.getAttribute('val');
    const mapped = colorMap[slot] ?? slot;
    rgb = hexRgb(palette[mapped]);
  }
  if (!rgb) return null;
  const transformed = applyTransforms(node, rgb);
  return transformed ? rgbHex(transformed) : null;
}

/** Project only colours that can be proved complete; unsupported slots are omitted. */
export function readPptxColorScheme(themeRoot) {
  const scheme = child(child(themeRoot, 'a', 'themeElements'), 'a', 'clrScheme');
  const raw = new Map();
  for (const node of children(scheme)) {
    const definition = children(node)[0];
    if (definition && (is(definition, 'a', 'srgbClr') || is(definition, 'a', 'sysClr') || is(definition, 'a', 'schemeClr'))) {
      raw.set(node.localName, definition);
    }
  }
  const resolveRgb = (node, visiting = new Set()) => {
    if (!node) return null;
    let rgb = null;
    if (is(node, 'a', 'srgbClr')) rgb = hexRgb(node.getAttribute('val'));
    else if (is(node, 'a', 'sysClr')) rgb = hexRgb(node.getAttribute('lastClr'));
    else if (is(node, 'a', 'schemeClr')) {
      const slot = node.getAttribute('val');
      const mapped = DEFAULT_COLOR_MAP[slot] ?? slot;
      if (visiting.has(mapped)) return null;
      visiting.add(mapped);
      rgb = resolveRgb(raw.get(mapped), visiting);
      visiting.delete(mapped);
    }
    return rgb ? applyTransforms(node, rgb) : null;
  };
  const resolve = node => {
    const rgb = resolveRgb(node);
    return rgb ? rgbHex(rgb) : null;
  };
  const palette = {};
  for (const [slot, node] of raw) {
    const color = resolve(node);
    if (color) palette[slot] = color;
  }
  return palette;
}
