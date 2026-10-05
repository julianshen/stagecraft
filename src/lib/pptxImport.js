// PowerPoint (.pptx) import — the inbound half of PowerPoint compatibility.
//
// A .pptx is a zip of OOXML parts. This reads it entirely client-side (JSZip +
// DOMParser, no upload) and maps every slide onto the `blank` layout: the slide's
// shapes, text boxes, pictures, lines, groups and tables become the free-form
// `elements` overlay, in the 1920×1080 authoring space. That keeps the import
// faithful to the source's positions (PowerPoint has no notion of Stagecraft's
// semantic layouts) and re-exports through the same `addElements` path.
//
// Inheritance is resolved the way PowerPoint does it, to the depth that matters
// for a faithful first pass: placeholder geometry slide → layout → master; text
// size / colour / alignment / bullets through the shape's list style, the layout
// and master placeholders, then the master's text styles; scheme colours through
// the master's colour map and the theme (with lumMod/lumOff/tint/shade/alpha).
// What can't be represented (charts, SmartArt, EMF/WMF pictures, …) is reported
// in `warnings` rather than silently dropped.

import JSZip from 'jszip';
import { SLIDE_W, SLIDE_H, MIN_LINE_THICKNESS } from './elements.js';
import { isValidElement } from './deckUtils.js';
import { SHAPES, shapeDef, clipPoints } from './shapes.js';
import { MAX_IMAGE_BYTES } from './imageFile.js';

const EMU_PER_PT = 12700;
// Inflated-size budgets for the package's XML (a real slide part is KBs; a
// heavy deck's XML totals a few MB).
const MAX_XML_PART_BYTES = 16 * 1024 * 1024;
const MAX_XML_TOTAL_BYTES = 128 * 1024 * 1024;
// Total inflated size of embedded pictures (each also capped at MAX_IMAGE_BYTES).
const MAX_MEDIA_TOTAL_BYTES = 64 * 1024 * 1024;
// Total data-URL characters across every picture copy the deck carries (each
// element holds its own copy until there's a shared asset store).
const MAX_OUTPUT_IMAGE_CHARS = 96 * 1024 * 1024;

// ---- tiny XML helpers (namespace-agnostic: match on localName) ----
const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
function kid(el, name) {
  if (el) for (const c of el.children) if (c.localName === name) return c;
  return null;
}
// Walk a chain of child names: path(sp, 'spPr', 'xfrm', 'off').
const path = (el, ...names) => names.reduce((cur, n) => kid(cur, n), el);
function desc(el, name) {
  if (!el) return null;
  for (const c of el.children) {
    if (c.localName === name) return c;
    const d = desc(c, name);
    if (d) return d;
  }
  return null;
}
// Attribute by local name, ignoring the prefix (r:id / r:embed / p14:dur).
function attr(el, name) {
  if (!el) return null;
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
}
// A relationship-namespace attribute (r:id / r:embed): a prefixed attribute, so
// `<p:sldId id="256" r:id="rId2">` resolves to the rId, not the numeric id.
function relAttr(el, name) {
  if (!el) return null;
  for (const a of el.attributes) if (a.localName === name && a.prefix) return a.value;
  return null;
}
// A picture's relationship: embedded (r:embed) or linked (r:link — external).
const blipRel = (blip) => relAttr(blip, 'embed') ?? relAttr(blip, 'link');
// An xsd:boolean attribute: "1"/"true" or "0"/"false"; absent → `d`.
const boolAttr = (el, name, d = false) => {
  const v = attr(el, name);
  return v == null ? d : v === '1' || v === 'true';
};
const numAttr = (el, name, d = null) => {
  const s = attr(el, name);
  const v = Number(s);
  return s != null && Number.isFinite(v) ? v : d;
};

// ---- package parts + relationships ----
const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
function resolvePart(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const out = [];
  for (const seg of (dirOf(base) + target).split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}
const relsPathOf = (p) => `${dirOf(p)}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels`;

class Pkg {
  constructor(zip) { this.zip = zip; this.cache = new Map(); this.media = new Map(); this.xmlBytes = 0; this.mediaBytes = 0; this.outChars = 0; }
  // Parse an XML part (cached). Each part's declared inflated size — and the
  // package's running total — is checked before inflating, so a zip bomb fails
  // fast instead of exhausting memory.
  async xml(p) {
    if (!this.cache.has(p)) {
      const f = this.zip.file(p);
      if (f) {
        this.xmlBytes += f._data?.uncompressedSize ?? 0;
        if (f._data?.uncompressedSize > MAX_XML_PART_BYTES || this.xmlBytes > MAX_XML_TOTAL_BYTES) {
          throw new Error('This presentation is too large to import (an XML part exceeds the size limit).');
        }
      }
      this.cache.set(p, f ? parseXml(await f.async('string')).documentElement : null);
    }
    return this.cache.get(p);
  }
  // { [rId]: { type, target(path) } } for a part.
  async rels(p) {
    const root = await this.xml(relsPathOf(p));
    const out = {};
    for (const r of kids(root, 'Relationship')) {
      const external = attr(r, 'TargetMode') === 'External';
      out[attr(r, 'Id')] = {
        type: (attr(r, 'Type') || '').split('/').pop(),
        target: external ? attr(r, 'Target') : resolvePart(p, attr(r, 'Target') || ''),
        external,
      };
    }
    return out;
  }
}
const relOfType = (rels, type) => Object.values(rels).find((r) => r.type === type)?.target || null;

// ---- colour ----
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const hex2 = (n) => Math.round(clamp01(n) * 255).toString(16).padStart(2, '0').toUpperCase();
function hexToRgb(h) {
  const n = parseInt(h, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb([h, s, l]) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
// Apply DrawingML colour transforms (the ones themes actually use).
function applyMods(hex, clrEl) {
  let rgb = hexToRgb(hex);
  let alpha = 1;
  for (const m of clrEl.children) {
    const v = numAttr(m, 'val', 100000) / 100000;
    if (m.localName === 'lumMod' || m.localName === 'lumOff') {
      const hsl = rgbToHsl(rgb);
      hsl[2] = clamp01(m.localName === 'lumMod' ? hsl[2] * v : hsl[2] + v);
      rgb = hslToRgb(hsl);
    } else if (m.localName === 'shade') rgb = rgb.map((c) => c * v);
    else if (m.localName === 'tint') rgb = rgb.map((c) => c + (1 - c) * (1 - v));
    else if (m.localName === 'alpha') alpha = clamp01(v);
  }
  return { hex: `#${rgbHex(rgb)}`, alpha };
}

// DrawingML preset colours (a:prstClr) are the CSS named colours, written in
// camelCase with dk/lt/med abbreviations (dkGoldenrod, ltSlateGray, medSeaGreen).
const PRESET_COLORS = Object.fromEntries([
  'aliceblue:F0F8FF antiquewhite:FAEBD7 aqua:00FFFF aquamarine:7FFFD4 azure:F0FFFF beige:F5F5DC bisque:FFE4C4',
  'black:000000 blanchedalmond:FFEBCD blue:0000FF blueviolet:8A2BE2 brown:A52A2A burlywood:DEB887',
  'cadetblue:5F9EA0 chartreuse:7FFF00 chocolate:D2691E coral:FF7F50 cornflowerblue:6495ED cornsilk:FFF8DC',
  'crimson:DC143C cyan:00FFFF darkblue:00008B darkcyan:008B8B darkgoldenrod:B8860B darkgray:A9A9A9',
  'darkgrey:A9A9A9 darkgreen:006400 darkkhaki:BDB76B darkmagenta:8B008B darkolivegreen:556B2F darkorange:FF8C00',
  'darkorchid:9932CC darkred:8B0000 darksalmon:E9967A darkseagreen:8FBC8F darkslateblue:483D8B',
  'darkslategray:2F4F4F darkslategrey:2F4F4F darkturquoise:00CED1 darkviolet:9400D3 deeppink:FF1493',
  'deepskyblue:00BFFF dimgray:696969 dimgrey:696969 dodgerblue:1E90FF firebrick:B22222 floralwhite:FFFAF0',
  'forestgreen:228B22 fuchsia:FF00FF gainsboro:DCDCDC ghostwhite:F8F8FF gold:FFD700 goldenrod:DAA520 gray:808080',
  'grey:808080 green:008000 greenyellow:ADFF2F honeydew:F0FFF0 hotpink:FF69B4 indianred:CD5C5C indigo:4B0082',
  'ivory:FFFFF0 khaki:F0E68C lavender:E6E6FA lavenderblush:FFF0F5 lawngreen:7CFC00 lemonchiffon:FFFACD',
  'lightblue:ADD8E6 lightcoral:F08080 lightcyan:E0FFFF lightgoldenrodyellow:FAFAD2 lightgray:D3D3D3',
  'lightgrey:D3D3D3 lightgreen:90EE90 lightpink:FFB6C1 lightsalmon:FFA07A lightseagreen:20B2AA',
  'lightskyblue:87CEFA lightslategray:778899 lightslategrey:778899 lightsteelblue:B0C4DE lightyellow:FFFFE0',
  'lime:00FF00 limegreen:32CD32 linen:FAF0E6 magenta:FF00FF maroon:800000 mediumaquamarine:66CDAA',
  'mediumblue:0000CD mediumorchid:BA55D3 mediumpurple:9370DB mediumseagreen:3CB371 mediumslateblue:7B68EE',
  'mediumspringgreen:00FA9A mediumturquoise:48D1CC mediumvioletred:C71585 midnightblue:191970 mintcream:F5FFFA',
  'mistyrose:FFE4E1 moccasin:FFE4B5 navajowhite:FFDEAD navy:000080 oldlace:FDF5E6 olive:808000 olivedrab:6B8E23',
  'orange:FFA500 orangered:FF4500 orchid:DA70D6 palegoldenrod:EEE8AA palegreen:98FB98 paleturquoise:AFEEEE',
  'palevioletred:DB7093 papayawhip:FFEFD5 peachpuff:FFDAB9 peru:CD853F pink:FFC0CB plum:DDA0DD powderblue:B0E0E6',
  'purple:800080 red:FF0000 rosybrown:BC8F8F royalblue:4169E1 saddlebrown:8B4513 salmon:FA8072 sandybrown:F4A460',
  'seagreen:2E8B57 seashell:FFF5EE sienna:A0522D silver:C0C0C0 skyblue:87CEEB slateblue:6A5ACD slategray:708090',
  'slategrey:708090 snow:FFFAFA springgreen:00FF7F steelblue:4682B4 tan:D2B48C teal:008080 thistle:D8BFD8',
  'tomato:FF6347 turquoise:40E0D0 violet:EE82EE wheat:F5DEB3 white:FFFFFF whitesmoke:F5F5F5 yellow:FFFF00',
  'yellowgreen:9ACD32',
].join(' ').split(' ').map((kv) => kv.split(':')));
const presetHex = (name) => PRESET_COLORS[String(name ?? '').toLowerCase()
  .replace(/^dk/, 'dark').replace(/^lt/, 'light').replace(/^med/, 'medium')] ?? null;
const DEFAULT_CLR_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
// A scheme slot (through the colour map) as an opaque colour, or null.
const schemeHex = (ctx, key) => ctx.scheme[ctx.clrMap[key] || key] || null;
const schemeColor = (ctx, key) => {
  const v = schemeHex(ctx, key);
  return v ? { hex: `#${v}`, alpha: 1 } : null;
};

// scRGB channels are linear-light percentages (100000ths); gamma-encode to sRGB.
const linearToSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const rgbHex = (rgb) => rgb.map(hex2).join('');

// Resolve a colour-choice element (srgbClr / scrgbClr / hslClr / schemeClr /
// sysClr / prstClr) to { hex: '#RRGGBB', alpha } — or null when it can't be
// resolved (phClr etc.).
function colorOf(clrEl, ctx) {
  if (!clrEl) return null;
  let base = null;
  switch (clrEl.localName) {
    case 'srgbClr': base = attr(clrEl, 'val'); break;
    case 'scrgbClr': base = rgbHex(['r', 'g', 'b'].map((k) => linearToSrgb(clamp01(numAttr(clrEl, k, 0) / 100000)))); break;
    case 'hslClr': base = rgbHex(hslToRgb([numAttr(clrEl, 'hue', 0) / 21600000, clamp01(numAttr(clrEl, 'sat', 0) / 100000), clamp01(numAttr(clrEl, 'lum', 0) / 100000)])); break;
    case 'sysClr': base = attr(clrEl, 'lastClr') || (attr(clrEl, 'val') === 'window' ? 'FFFFFF' : '000000'); break;
    case 'prstClr': base = presetHex(attr(clrEl, 'val')); break;
    case 'schemeClr': base = schemeHex(ctx, attr(clrEl, 'val')); break;
    default: return null;
  }
  if (!base || !/^[0-9a-f]{6}$/i.test(base)) return null;
  return applyMods(base.toUpperCase(), clrEl);
}
// The colour inside a fill-ish parent (solidFill / bgRef / fontRef / …).
const COLOR_TAGS = ['srgbClr', 'scrgbClr', 'hslClr', 'schemeClr', 'sysClr', 'prstClr'];
const colorIn = (parent, ctx) => {
  const c = parent && [...parent.children].find((x) => COLOR_TAGS.includes(x.localName));
  return c ? colorOf(c, ctx) : null;
};

// A shape-properties fill → { kind: 'none' } | { kind: 'solid', color } |
// { kind: 'grad', color, from, to, angle } | null (unspecified → inherit/style).
// `color` is the fill's representative solid (a gradient's first stop).
// Path (radial / rectangular / shape) gradients have no CSS-linear equivalent
// here, so they import as linear with a warning.
function fillOf(props, ctx, warn) {
  if (!props) return null;
  if (kid(props, 'noFill')) return { kind: 'none' };
  const solid = kid(props, 'solidFill');
  if (solid) {
    const color = colorIn(solid, ctx);
    return color ? { kind: 'solid', color } : null;
  }
  const grad = kid(props, 'gradFill');
  if (grad) {
    const stops = kids(path(grad, 'gsLst'), 'gs')
      .map((gs) => ({ pos: numAttr(gs, 'pos', 0), color: colorIn(gs, ctx) }))
      .filter((s) => s.color)
      .sort((a, b) => a.pos - b.pos);
    if (!stops.length) return null;
    if (kid(grad, 'path')) warn?.('Radial and path gradients were imported as linear gradients.');
    // OOXML lin ang is clockwise from →, in 60000ths; CSS 0deg is ↑ → +90.
    const ang = numAttr(kid(grad, 'lin'), 'ang', 0) / 60000;
    return { kind: 'grad', color: stops[0].color, from: stops[0].color, to: stops[stops.length - 1].color, angle: Math.round((ang + 90) % 360) };
  }
  return null;
}

const opacityOf = (alpha) => (alpha < 1 ? { opacity: Math.round(alpha * 100) } : {});

// ---- geometry ----
// The source slide (cx×cy EMU) fits the 1920×1080 canvas uniformly, centred —
// a 4:3 deck letterboxes rather than stretching.
function makeFit(cx, cy) {
  const k = Math.min(SLIDE_W / cx, SLIDE_H / cy);
  return { k, ox: (SLIDE_W - cx * k) / 2, oy: (SLIDE_H - cy * k) / 2, w: cx * k, h: cy * k };
}
const round2 = (v) => Math.round(v * 100) / 100;

// An xfrm → EMU box (+ rotation/flips), mapped through the group transform chain.
function xfrmBox(xfrm, groupT) {
  if (!xfrm) return null;
  const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext');
  if (!off || !ext) return null;
  const box = {
    x: numAttr(off, 'x', 0), y: numAttr(off, 'y', 0), w: numAttr(ext, 'cx', 0), h: numAttr(ext, 'cy', 0),
    rot: numAttr(xfrm, 'rot', 0) / 60000,
    flipH: boolAttr(xfrm, 'flipH'), flipV: boolAttr(xfrm, 'flipV'),
  };
  return groupT ? groupT(box) : box;
}
const toPx = (box, fit) => ({
  x: round2(fit.ox + box.x * fit.k), y: round2(fit.oy + box.y * fit.k),
  w: round2(box.w * fit.k), h: round2(box.h * fit.k),
  ...(box.rot ? { rot: round2(box.rot) } : {}),
});

// Move a box's centre by a clockwise (y-down) turn of `deg` about (gx, gy) — the
// box itself keeps its size; callers add `deg` to its own rotation.
function turnAbout(b, gx, gy, deg) {
  if (!deg) return b;
  const t = (deg * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  const dx = b.x + b.w / 2 - gx, dy = b.y + b.h / 2 - gy;
  return { ...b, x: gx + dx * cos - dy * sin - b.w / 2, y: gy + dx * sin + dy * cos - b.h / 2 };
}

// A group's child coordinate space (chOff/chExt) maps onto its own box.
function groupTransform(grpSpPr, parentT) {
  const xfrm = kid(grpSpPr, 'xfrm');
  const own = xfrmBox(xfrm, parentT);
  const chOff = kid(xfrm, 'chOff'), chExt = kid(xfrm, 'chExt');
  if (!own || !chOff || !chExt) return parentT;
  const cx = numAttr(chOff, 'x', 0), cy = numAttr(chOff, 'y', 0);
  const ecx = numAttr(chExt, 'cx', 0), ecy = numAttr(chExt, 'cy', 0);
  const sx = ecx ? own.w / ecx : 1;
  const sy = ecy ? own.h / ecy : 1;
  // Scale/offset into the group box; a flipped group then mirrors each child's
  // centre about the group centre (before rotating, as PowerPoint applies it),
  // reverses the child's rotation when exactly one axis is mirrored, and toggles
  // the child's own flip (lines take the mirrored endpoints; other mirrored
  // children report themselves). Finally the group's rotation turns the child
  // about the group centre and adds to its own, so the composition holds.
  const gx = own.x + own.w / 2, gy = own.y + own.h / 2;
  const fx = own.flipH ? -1 : 1, fy = own.flipV ? -1 : 1;
  return (b) => {
    const w = b.w * sx, h = b.h * sy;
    const mx = gx + fx * (own.x + (b.x - cx) * sx + w / 2 - gx), my = gy + fy * (own.y + (b.y - cy) * sy + h / 2 - gy);
    const childRot = fx * fy * (b.rot || 0);
    return {
      ...turnAbout({ ...b, w, h, x: mx - w / 2, y: my - h / 2 }, gx, gy, own.rot || 0),
      rot: childRot + (own.rot || 0),
      flipH: b.flipH !== own.flipH, flipV: b.flipV !== own.flipV,
    };
  };
}

// ---- preset geometry → element type ----
// The core is the SHAPES registry inverted (its `pptx` key is the OOXML preset),
// so a shape added there imports too; aliases map close presets onto it.
const PRST_TYPE = {
  ...Object.fromEntries(Object.entries(SHAPES).filter(([, d]) => !d.line).map(([type, d]) => [d.pptx, type])),
  rect: 'rect', snip1Rect: 'rect', flowChartProcess: 'rect', custGeom: 'rect',
  round1Rect: 'rounded', round2SameRect: 'rounded', flowChartAlternateProcess: 'rounded',
  flowChartConnector: 'circle',
  rtTriangle: 'triangle', flowChartExtract: 'triangle',
  flowChartDecision: 'diamond',
  homePlate: 'arrow', chevron: 'arrow',
  star4: 'star', star6: 'star',
  line: 'line', straightConnector1: 'line',
  // Elbow connectors (curved ones are approximated by the elbow, with a warning).
  bentConnector3: 'elbow', curvedConnector3: 'elbow',
};
// An outline-only (no fill) shape becomes a stroked closed `path` — the element
// model's fills are always solid, but a path is stroke-only. Its points follow
// the shape: a sampled ellipse, the clip polygon, or the box.
function outlinePoints(type) {
  const def = shapeDef(type);
  if (def?.round) {
    return Array.from({ length: 33 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2;
      return [round2(0.5 + 0.5 * Math.cos(a)), round2(0.5 + 0.5 * Math.sin(a))];
    });
  }
  if (def?.clip) {
    const pts = clipPoints(def.clip);
    return [...pts, pts[0]];
  }
  return [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
}

const FLIP_WARNING = 'Mirrored (flipped) shapes and pictures were imported unmirrored.';

// ---- line (a:ln) ----
const DASH = { dash: 'dashed', lgDash: 'dashed', sysDash: 'dashed', dashDot: 'dashed', lgDashDot: 'dashed', lgDashDotDot: 'dashed', sysDashDot: 'dashed', sysDashDotDot: 'dashed', dot: 'dotted', sysDot: 'dotted' };
function lineOf(ln, ctx, styleLnColor) {
  if (kid(ln, 'noFill')) return null;
  const color = colorIn(kid(ln, 'solidFill'), ctx) || styleLnColor;
  if (!color) return null;
  // Default line width is 0.75pt (9525 EMU).
  const w = numAttr(ln, 'w', 9525);
  const dash = DASH[attr(kid(ln, 'prstDash'), 'val')];
  // An arrowhead on either end (type other than "none") — not representable yet.
  const arrow = ['headEnd', 'tailEnd'].some((e) => (attr(kid(ln, e), 'type') || 'none') !== 'none');
  return { color, w, dash, arrow };
}

// ---- text ----
const ALIGN = { ctr: 'center', r: 'right', just: 'left', l: 'left', dist: 'center' };
const ANCHOR = { t: 'top', ctr: 'middle', b: 'bottom' };
// Placeholder types that share a template slot: a centred title is a title; a
// subtitle / object / untyped placeholder is a body.
const normPhType = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' || t == null ? 'body' : t);
// Text-style category of a placeholder type (which master txStyles applies).
const phCategory = (type) => {
  const n = normPhType(type);
  return n === 'title' || n === 'body' ? n : 'other';
};

// The first value a getter yields across an ordered chain of list-style levels.
const firstOf = (chain, get) => {
  for (const el of chain) {
    const v = el ? get(el) : null;
    if (v != null) return v;
  }
  return null;
};

// An auto-number's label: arabic / alpha / roman numbering in PowerPoint's
// period, paren-right or paren-both forms (unknown schemes fall back to "n.").
function autoNumber(type, n) {
  const roman = (v) => [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
    .reduce((acc, [k, r]) => { while (v >= k) { acc += r; v -= k; } return acc; }, '');
  const alpha = (v) => { let out = ''; for (; v > 0; v = Math.floor((v - 1) / 26)) out = String.fromCharCode(97 + ((v - 1) % 26)) + out; return out; };
  const m = /^(arabic|alphaLc|alphaUc|romanLc|romanUc)(Period|ParenR|ParenBoth)$/.exec(type);
  if (!m) return `${n}.`;
  const core = { arabic: String(n), alphaLc: alpha(n), alphaUc: alpha(n).toUpperCase(), romanLc: roman(n), romanUc: roman(n).toUpperCase() }[m[1]];
  return m[2] === 'Period' ? `${core}.` : m[2] === 'ParenR' ? `${core})` : `(${core})`;
}

function textOf(sp, ctx, inh) {
  const txBody = kid(sp, 'txBody');
  if (!txBody) return null;
  const lvlName = (p) => `lvl${Math.min(9, numAttr(kid(p, 'pPr'), 'lvl', 0) + 1)}pPr`;
  // The list-style levels for a paragraph: shape → layout ph → master ph (local),
  // then the master text style by placeholder category (kept apart: a shape
  // style's fontRef colour ranks between the two). Each is an a:lvlNpPr.
  const localFor = (p) => [txBody, ...inh.txBodies].map((tb) => path(tb, 'lstStyle', lvlName(p)));
  const masterFor = (p) => kid(inh.txStyle, lvlName(p));
  const lines = [];
  const counters = {}; // auto-number state per indent level
  let firstRun = null, firstPara = null;
  for (const p of kids(txBody, 'p')) {
    let t = '';
    for (const c of p.children) {
      if (c.localName === 'r' || c.localName === 'fld') {
        const run = kid(c, 't')?.textContent ?? '';
        t += run;
        if (!firstRun && run.trim()) { firstRun = c; firstPara = p; }
      } else if (c.localName === 'br') t += '\n';
    }
    if (!t.trim()) {
      // A blank paragraph keeps numbering going, unless it explicitly sets a
      // non-numbered bullet (a separator between two lists) — that restarts it.
      const own = kid(p, 'pPr');
      if (kid(own, 'buNone') || kid(own, 'buChar')) delete counters[numAttr(own, 'lvl', 0)];
      lines.push(t);
      continue;
    }
    const pPr = kid(p, 'pPr');
    const lvl = numAttr(pPr, 'lvl', 0);
    // Bullets: the nearest buNone / buChar / buAutoNum in the chain decides; an
    // auto-number is materialized (its type + startAt, counted per level and
    // restarting after a differently-bulleted paragraph at that level).
    const bu = firstOf([pPr, ...localFor(p), masterFor(p)], (el) => kid(el, 'buNone') ?? kid(el, 'buChar') ?? kid(el, 'buAutoNum'));
    let bullet = null;
    if (bu?.localName === 'buChar') bullet = attr(bu, 'char') || '•';
    else if (bu?.localName === 'buAutoNum') {
      // PowerPoint repeats a list's startAt on every item, so the count only
      // restarts when the scheme or the startAt value changes.
      const type = attr(bu, 'type') || 'arabicPeriod';
      const start = numAttr(bu, 'startAt', 1);
      const prev = counters[lvl];
      const n = prev && prev.type === type && prev.start === start ? prev.n + 1 : start;
      counters[lvl] = { type, start, n };
      bullet = autoNumber(type, n);
    }
    if (bu?.localName !== 'buAutoNum') delete counters[lvl];
    lines.push(bullet ? `${'  '.repeat(lvl)}${bullet} ${t}` : t);
  }
  // Trim leading/trailing blank paragraphs; keep interior blank lines.
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const content = lines.join('\n');
  if (!content.trim()) return null;

  // The element takes its first run's style, falling back through the chain.
  const rPr = kid(firstRun, 'rPr');
  const pPr0 = kid(firstPara, 'pPr');
  // The paragraph's own pPr (its defRPr) outranks the list styles.
  const local = [pPr0, ...localFor(firstPara)];
  const chain = [...local, masterFor(firstPara)];
  const defRPr = (el) => kid(el, 'defRPr');
  const runAttr = (name) => attr(rPr, name) ?? firstOf(chain, (el) => attr(defRPr(el), name));
  const isOn = (name) => { const v = runAttr(name); return v === '1' || v === 'true'; };
  const bodyPrs = [kid(txBody, 'bodyPr'), ...inh.txBodies.map((tb) => kid(tb, 'bodyPr'))];
  const szHundredths = numAttr(rPr, 'sz') ?? firstOf(chain, (el) => numAttr(defRPr(el), 'sz')) ?? 1800;
  // The first body that declares an autofit mode decides: only normAutofit
  // scales (noAutofit / spAutoFit stop an inherited shrink).
  const fontScale = firstOf(bodyPrs, (bp) => (kid(bp, 'normAutofit') ? numAttr(kid(bp, 'normAutofit'), 'fontScale', 100000)
    : kid(bp, 'noAutofit') || kid(bp, 'spAutoFit') ? 100000 : null)) ?? 100000;
  const u = runAttr('u');
  // Colour precedence: run → list styles → the shape style's fontRef → the
  // master text style → tx1.
  const fillOfLvl = (el) => colorIn(kid(defRPr(el), 'solidFill'), ctx);
  const color = colorIn(kid(rPr, 'solidFill'), ctx)
    || firstOf(local, fillOfLvl)
    || inh.fontRefColor
    || firstOf([masterFor(firstPara)], fillOfLvl)
    || schemeColor(ctx, 'tx1')
    || { hex: '#000000', alpha: 1 };
  let face = attr(kid(rPr, 'latin'), 'typeface') ?? firstOf(chain, (el) => attr(kid(defRPr(el), 'latin'), 'typeface'));
  // A shape style's fontRef (major/minor) picks the theme face when no list
  // style names one.
  face ??= { major: '+mj-lt', minor: '+mn-lt' }[inh.fontRefIdx];
  if (face === '+mj-lt') face = ctx.fonts.major;
  else if (face === '+mn-lt') face = ctx.fonts.minor;
  const algn = firstOf(chain, (el) => attr(el, 'algn'));
  const anchor = firstOf(bodyPrs, (bp) => attr(bp, 'anchor'));
  const spcPct = firstOf(chain, (el) => numAttr(path(el, 'lnSpc', 'spcPct'), 'val'));

  const px = (szHundredths / 100) * (fontScale / 100000) * EMU_PER_PT * ctx.fit.k;
  return {
    content,
    fontSize: Math.max(1, round2(px)),
    fill: color.hex,
    ...opacityOf(color.alpha),
    ...(isOn('b') ? { bold: true } : {}),
    ...(isOn('i') ? { italic: true } : {}),
    ...(u && u !== 'none' ? { underline: true } : {}),
    ...(face ? { fontFamily: face } : {}),
    align: ALIGN[algn] || 'left',
    valign: ANCHOR[anchor] || 'top',
    // PowerPoint "single" spacing ≈ 1.2× the font size (the canvas default).
    ...(spcPct != null && spcPct > 0 ? { lineSpacing: round2((spcPct / 100000) * 1.2) } : {}),
  };
}

// ---- slide parsing ----
function phOf(sp) {
  const ph = desc(kid(sp, 'nvSpPr') || kid(sp, 'nvPicPr') || kid(sp, 'nvGraphicFramePr'), 'ph');
  return ph ? { type: attr(ph, 'type'), idx: attr(ph, 'idx') } : null;
}
// Find the matching placeholder shape in a layout/master spTree.
function findPh(tree, ph, byIdx = true) {
  if (!tree || !ph) return null;
  const phs = kids(tree, 'sp').map((s) => [s, phOf(s)]).filter(([, p]) => p);
  const hit = (byIdx && ph.idx != null && phs.find(([, p]) => p.idx === ph.idx))
    || phs.find(([, p]) => normPhType(p.type) === normPhType(ph.type));
  return hit ? hit[0] : null;
}

class SlideReader {
  constructor(pkg, ctx, rels, layoutTree, masterTree, warn) {
    Object.assign(this, { pkg, ctx, rels, layoutTree, masterTree, warn });
    this.out = [];
    this.n = 0;
  }

  id(prefix) { this.n += 1; return `${prefix}-${this.n}`; }

  // Inheritance sources for a placeholder: its layout + master counterparts.
  inherit(sp) {
    const own = phOf(sp);
    const lay = own ? findPh(this.layoutTree, own) : null;
    // An idx-only placeholder takes its effective type from the matched layout
    // slot, which then picks the master placeholder and the text style.
    const ph = own && own.type == null && lay ? { ...own, type: phOf(lay).type } : own;
    const mas = ph ? findPh(this.masterTree, ph, false) : null;
    // Shape style refs (fill/line/font) inherit like the rest: slide → layout → master.
    const style = kid(sp, 'style') ?? kid(lay, 'style') ?? kid(mas, 'style');
    const txStyles = this.ctx.txStyles;
    const cat = ph ? phCategory(ph.type) : 'other';
    return {
      ph,
      xfrm: path(sp, 'spPr', 'xfrm') || path(lay, 'spPr', 'xfrm') || path(mas, 'spPr', 'xfrm'),
      txBodies: [lay, mas].map((s) => kid(s, 'txBody')).filter(Boolean),
      txStyle: kid(txStyles, `${cat}Style`),
      spPrs: [kid(lay, 'spPr'), kid(mas, 'spPr')].filter(Boolean),
      style,
      fontRefColor: colorIn(kid(style, 'fontRef'), this.ctx),
      fontRefIdx: attr(kid(style, 'fontRef'), 'idx'),
    };
  }

  // Walk a shape tree. `rels` resolves pictures (a layout/master's own part rels
  // for its furniture); `only` filters the top-level nodes (furniture skips
  // placeholders). Nested groups share their outermost group's id.
  async walk(tree, { groupT = null, groupId, rels = this.rels, only = null } = {}) {
    for (const node of tree.children) {
      if (only && !only(node)) continue;
      switch (node.localName) {
        case 'sp':
        case 'cxnSp': this.shape(node, groupT, groupId); break;
        case 'pic': await this.picture(node, groupT, groupId, rels); break;
        case 'grpSp':
          await this.walk(node, { groupT: groupTransform(kid(node, 'grpSpPr'), groupT), groupId: groupId || this.id('grp'), rels });
          break;
        case 'graphicFrame': this.frame(node, groupT, groupId); break;
        case 'AlternateContent': {
          // mc:AlternateContent — prefer the Fallback (plain DrawingML) branch.
          const branch = kid(node, 'Fallback') || kid(node, 'Choice');
          if (branch) await this.walk(branch, { groupT, groupId, rels });
          break;
        }
        default: break;
      }
    }
  }

  // A click/hover link on a shape, picture or frame itself (on its cNvPr) can't be
  // represented yet — report it rather than leave a silently inert button.
  noteShapeLinks(node) {
    const nv = kid(node, 'nvSpPr') ?? kid(node, 'nvPicPr') ?? kid(node, 'nvCxnSpPr') ?? kid(node, 'nvGraphicFramePr');
    const cNvPr = desc(nv, 'cNvPr');
    if (kid(cNvPr, 'hlinkClick') || kid(cNvPr, 'hlinkHover')) this.warn('Click/hover links on shapes were not imported.');
  }

  // A text body's element fields (textOf), reporting what text can't carry yet.
  text(sp, inh) {
    const body = kid(sp, 'txBody');
    if (desc(body, 'hlinkClick') || desc(body, 'hlinkMouseOver')) this.warn('Hyperlinks in text were imported as plain text.');
    return textOf(sp, this.ctx, inh);
  }

  push(el, groupId) {
    const full = { id: this.id('el'), ...el, ...(groupId ? { groupId } : {}) };
    if (isValidElement(full)) this.out.push(full);
    else this.warn(`Skipped an element that could not be represented (${el.type}).`);
  }

  // A filled element with an optional outline. Element `opacity` fades the
  // whole element, so a fill and outline at different alphas split into the
  // filled body plus a grouped outline path, each with its own opacity.
  // `group()` supplies the group id (only needed for the split).
  pushPainted(el, fillAlpha, stroke, strokeAlpha, outline, group) {
    if (!stroke || fillAlpha === strokeAlpha) {
      this.push({ ...el, ...stroke, ...opacityOf(fillAlpha) }, group());
      return;
    }
    const gid = group(true);
    this.push({ ...el, ...opacityOf(fillAlpha) }, gid);
    this.push({ type: 'path', x: el.x, y: el.y, w: el.w, h: el.h, ...(el.rot ? { rot: el.rot } : {}),
      points: outlinePoints(outline), ...stroke, ...opacityOf(strokeAlpha) }, gid);
  }

  shape(sp, groupT, groupId) {
    const inh = this.inherit(sp);
    this.noteShapeLinks(sp);
    // Slide-number / date / footer placeholders are master furniture.
    if (inh.ph && ['sldNum', 'dt', 'ftr'].includes(inh.ph.type)) {
      this.warn('Slide numbers, dates and footers were not imported.');
      return;
    }
    const box = xfrmBox(inh.xfrm, groupT);
    if (!box || !(box.w >= 0) || !(box.h >= 0)) return;
    const geo = toPx(box, this.ctx.fit);
    const spPr = kid(sp, 'spPr');
    // Geometry may be inherited from the layout/master placeholder.
    const prst = firstOf([spPr, ...inh.spPrs], (p) => attr(kid(p, 'prstGeom'), 'prst') ?? (kid(p, 'custGeom') ? 'custGeom' : null));
    if (prst === 'custGeom') this.warn('Freeform (custom-geometry) shapes were imported as rectangles.');
    const { style } = inh;
    // A shape style's fill/line refs (idx 0 = "no style fill/line").
    const styleRef = (name) => (numAttr(kid(style, name), 'idx', 0) > 0 ? colorIn(kid(style, name), this.ctx) : null);
    const styleFill = styleRef('fillRef');
    const styleLn = styleRef('lnRef');
    // The outline may be inherited from the layout/master placeholder; the first
    // explicit a:ln wins (an explicit <a:noFill/> line still means "no outline").
    const ln = lineOf(firstOf([spPr, ...inh.spPrs], (p) => kid(p, 'ln')), this.ctx, styleLn);
    const known = PRST_TYPE[prst];
    if (prst && !known) this.warn(`Shape "${prst}" was imported as a rectangle.`);
    const type = known || (prst ? 'rect' : null);
    if ((box.flipH || box.flipV) && type !== 'line') this.warn(FLIP_WARNING);
    if (ln?.arrow) this.warn('Arrowheads on lines and connectors were not imported.');
    if (['blipFill', 'pattFill', 'grpFill'].some((f) => kid(spPr, f))) {
      this.warn("Picture or pattern fills on shapes aren't supported — those shapes import without them.");
    }

    if (type === 'line') {
      if (ln) this.line(box, ln, groupId);
      return;
    }
    if (type === 'elbow') {
      if (prst.startsWith('curved')) this.warn('Curved connectors were imported as elbow (right-angle) lines.');
      if (ln) this.elbow(box, ln, groupId);
      return;
    }
    // A geometry with text imports as two elements (shape + text overlay); a
    // local group keeps them moving together, unless a PowerPoint group already does.
    const text = this.text(sp, inh);
    let gid = groupId;
    const pairUp = (split) => { gid = gid || (text || split ? this.id('grp') : undefined); return gid; };
    if (type) {
      const fill = fillOf(spPr, this.ctx, this.warn) || firstOf(inh.spPrs, (p) => fillOf(p, this.ctx, this.warn))
        || (styleFill ? { kind: 'solid', color: styleFill } : { kind: 'none' });
      const stroke = ln ? {
        stroke: ln.color.hex, strokeWidth: Math.max(1, round2(ln.w * this.ctx.fit.k)),
        ...(ln.dash ? { strokeDash: ln.dash } : {}),
      } : {};
      if (fill.color) {
        this.pushPainted({
          type, ...geo, fill: fill.color.hex,
          ...(fill.kind === 'grad' ? { gradient: { from: fill.from.hex, to: fill.to.hex, angle: fill.angle } } : {}),
        }, fill.color.alpha, ln && stroke, ln?.color.alpha, type, pairUp);
      } else if (ln) {
        // Outline-only shape → a closed stroked path (fills are always solid).
        this.push({ type: 'path', ...geo, points: outlinePoints(type), ...stroke }, pairUp());
      }
    }
    if (text) this.push({ type: 'text', ...geo, ...text }, gid);
  }

  // A straight line/connector: endpoints from the box + flips → a rotated bar
  // (the element model's `line` is a bar whose height is its thickness).
  line(box, ln, groupId) {
    const { fit } = this.ctx;
    const thick = Math.max(MIN_LINE_THICKNESS, round2(ln.w * fit.k));
    const alpha = opacityOf(ln.color.alpha);
    // A dashed/dotted connector → a stroked two-point path (a `line` element is
    // a solid bar). A degenerate axis (a horizontal/vertical connector) gets a
    // `thick`-wide box centred on the line so the path has room to draw.
    if (ln.dash) {
      const g = toPx(box, fit);
      const [px0, px1] = box.flipH ? [1, 0] : [0, 1];
      const [py0, py1] = box.flipV ? [1, 0] : [0, 1];
      const flatX = g.w < thick, flatY = g.h < thick;
      this.push({
        type: 'path', ...g,
        ...(flatX ? { x: round2(g.x + g.w / 2 - thick / 2), w: thick } : {}),
        ...(flatY ? { y: round2(g.y + g.h / 2 - thick / 2), h: thick } : {}),
        points: [[flatX ? 0.5 : px0, flatY ? 0.5 : py0], [flatX ? 0.5 : px1, flatY ? 0.5 : py1]],
        stroke: ln.color.hex, strokeWidth: thick, strokeDash: ln.dash, ...alpha,
      }, groupId);
      return;
    }
    const x1 = box.flipH ? box.x + box.w : box.x, x2 = box.flipH ? box.x : box.x + box.w;
    const y1 = box.flipV ? box.y + box.h : box.y, y2 = box.flipV ? box.y : box.y + box.h;
    const dx = (x2 - x1) * fit.k, dy = (y2 - y1) * fit.k;
    const len = Math.hypot(dx, dy);
    const cx = fit.ox + ((x1 + x2) / 2) * fit.k, cy = fit.oy + ((y1 + y2) / 2) * fit.k;
    const rot = round2(Math.atan2(dy, dx) * 180 / Math.PI + (box.rot || 0));
    this.push({
      type: 'line', x: round2(cx - len / 2), y: round2(cy - thick / 2), w: round2(Math.max(len, 1)), h: thick,
      fill: ln.color.hex, ...(rot ? { rot } : {}), ...alpha,
    }, groupId);
  }

  // An elbow connector: start → across to the midpoint bend (PowerPoint's
  // default; a custom adj is not read) → down → across to the end, as a stroked
  // path in its box (flips mirror the points).
  elbow(box, ln, groupId) {
    const { fit } = this.ctx;
    const thick = Math.max(MIN_LINE_THICKNESS, round2(ln.w * fit.k));
    const fx = (x) => (box.flipH ? round2(1 - x) : x), fy = (y) => (box.flipV ? round2(1 - y) : y);
    this.push({
      type: 'path', ...toPx(box, fit),
      points: [[0, 0], [0.5, 0], [0.5, 1], [1, 1]].map(([x, y]) => [fx(x), fy(y)]),
      stroke: ln.color.hex, strokeWidth: thick, ...(ln.dash ? { strokeDash: ln.dash } : {}),
      ...opacityOf(ln.color.alpha),
    }, groupId);
  }

  async picture(pic, groupT, groupId, rels) {
    const inh = this.inherit(pic);
    this.noteShapeLinks(pic);
    const nvPr = path(pic, 'nvPicPr', 'nvPr');
    if (['videoFile', 'audioFile', 'quickTimeFile', 'wavAudioFile'].some((m) => desc(nvPr, m))) {
      this.warn('Video and audio were imported as their poster image (playback is not supported).');
    }
    const box = xfrmBox(inh.xfrm, groupT);
    if (!box) return;
    if (box.flipH || box.flipV) this.warn(FLIP_WARNING);
    const srcRect = path(pic, 'blipFill', 'srcRect');
    if (srcRect && [...srcRect.attributes].some((a) => Number(a.value))) this.warn('Cropped pictures import uncropped (stretched to their frame).');
    if (path(pic, 'blipFill', 'tile')) this.warn(TILE_WARNING);
    const blip = path(pic, 'blipFill', 'blip');
    const src = await imageData(this.pkg, rels[blipRel(blip)], this.warn);
    // Picture transparency is the blip's alphaModFix (amt in 100000ths).
    const amt = clamp01(numAttr(kid(blip, 'alphaModFix'), 'amt', 100000) / 100000);
    // PowerPoint stretches a picture to its frame (a:stretch) — keep that, not cover.
    if (src) {
      this.push({ type: 'image', ...toPx(box, this.ctx.fit), src, fit: 'stretch',
        ...(amt < 1 ? { opacity: Math.round(amt * 100) } : {}) }, groupId);
    }
  }

  frame(gf, groupT, groupId) {
    this.noteShapeLinks(gf);
    const box = xfrmBox(kid(gf, 'xfrm'), groupT);
    const data = path(gf, 'graphic', 'graphicData');
    const tbl = kid(data, 'tbl');
    if (box && tbl) { this.table(tbl, box, groupId); return; }
    const uri = attr(data, 'uri') || '';
    const what = uri.includes('chart') ? 'chart' : uri.includes('diagram') ? 'SmartArt graphic' : 'embedded object';
    this.warn(`A ${what} can't be imported yet — a labelled placeholder was added.`);
    if (box) {
      const geo = toPx(box, this.ctx.fit);
      const gid = groupId || this.id('grp'); // backing box + label move together
      this.push({ type: 'rect', ...geo, fill: '#F2F2F2', stroke: '#BFBFBF', strokeWidth: 2, strokeDash: 'dashed' }, gid);
      this.push({ type: 'text', ...geo, content: `[${what} — not imported]`, fill: '#7F7F7F',
        fontSize: 24, align: 'center', valign: 'middle' }, gid);
    }
  }

  // A cell's outline: its explicit lnL/lnR/lnT/lnB when uniform (all "no line"
  // → none), else the light grid default. Mixed sides can't be drawn per-edge
  // yet, so the first explicit line stands in for all four, with a warning.
  cellBorder(tcPr) {
    const DEFAULT = { stroke: '#BFBFBF', strokeWidth: 1 };
    const sides = ['lnL', 'lnR', 'lnT', 'lnB'].map((n) => kid(tcPr, n));
    if (!sides.some(Boolean)) return DEFAULT;
    const toStroke = (ln) => {
      const l = ln && lineOf(ln, this.ctx, null);
      return l ? { stroke: l.color.hex, strokeWidth: Math.max(1, round2(l.w * this.ctx.fit.k)), ...(l.dash ? { strokeDash: l.dash } : {}) } : null;
    };
    const strokes = sides.map((ln) => (ln ? toStroke(ln) : undefined));
    const key = (st) => (st ? `${st.stroke}|${st.strokeWidth}|${st.strokeDash || ''}` : 'none');
    if (strokes.every((st) => st !== undefined) && new Set(strokes.map(key)).size === 1) return strokes[0];
    this.warn('Table cell borders were approximated (per-side borders are not supported).');
    return strokes.find(Boolean) ?? null;
  }

  // A native table → one cell rect + text per cell, on the table's grid.
  table(tbl, box, groupId) {
    const gid = groupId || this.id('grp');
    if (box.flipH || box.flipV) this.warn(FLIP_WARNING);
    if (desc(kid(tbl, 'tblPr'), 'tableStyleId')) this.warn('Table styles (banding, header fills) are not applied — only explicit cell fills.');
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => numAttr(c, 'w', 0));
    const rows = kids(tbl, 'tr');
    const colSum = cols.reduce((a, b) => a + b, 0) || 1;
    const rowHs = rows.map((r) => numAttr(r, 'h', 0));
    // Rows scale to the frame either way (a group may compress it); rows that
    // declare no height share the frame equally.
    if (!rowHs.some((h) => h > 0)) rowHs.fill(box.h / Math.max(1, rows.length));
    const rowSum = rowHs.reduce((a, b) => a + b, 0) || 1;
    const sx = box.w / colSum, sy = box.h / rowSum;
    let y = box.y;
    rows.forEach((tr, ri) => {
      let x = box.x;
      const h = rowHs[ri] * sy;
      kids(tr, 'tc').forEach((tc, ci) => {
        if (!boolAttr(tc, 'hMerge') && !boolAttr(tc, 'vMerge')) {
          const span = numAttr(tc, 'gridSpan', 1);
          const cw = cols.slice(ci, ci + span).reduce((a, b) => a + b, 0) * sx;
          const ch = rowHs.slice(ri, ri + numAttr(tc, 'rowSpan', 1)).reduce((a, b) => a + b, 0) * sy;
          // A rotated frame turns each cell about the table centre.
          // A flipped frame mirrors the grid within the table; a rotated one
          // then turns each cell about the table centre.
          const mx = box.flipH ? 2 * box.x + box.w - x - cw : x;
          const my = box.flipV ? 2 * box.y + box.h - y - ch : y;
          const cellBox = { ...turnAbout({ x: mx, y: my, w: cw, h: ch }, box.x + box.w / 2, box.y + box.h / 2, box.rot), rot: box.rot };
          const geo = toPx(cellBox, this.ctx.fit);
          const fill = fillOf(kid(tc, 'tcPr'), this.ctx, this.warn);
          // An explicitly transparent cell keeps only its grid outline; an
          // unspecified one (table style decides) falls back to white.
          const border = this.cellBorder(kid(tc, 'tcPr'));
          if (fill?.kind === 'none') {
            if (border) this.push({ type: 'path', ...geo, points: outlinePoints('rect'), ...border }, gid);
          } else {
            this.pushPainted({ type: 'rect', ...geo, fill: fill?.color ? fill.color.hex : '#FFFFFF' },
              fill?.color?.alpha ?? 1, border, 1, 'rect', () => gid);
          }
          const text = this.text(tc, { txBodies: [], txStyle: kid(this.ctx.txStyles, 'otherStyle') });
          const anchor = ANCHOR[attr(kid(tc, 'tcPr'), 'anchor')];
          if (text) this.push({ type: 'text', ...geo, ...text, ...(anchor ? { valign: anchor } : {}) }, gid);
        }
        x += (cols[ci] || 0) * sx;
      });
      y += h;
    });
  }
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
// A picture part as a data URL. Cached per part (master/layout art and
// backgrounds recur on every slide — one decode, one shared string); capped at
// the same MAX_IMAGE_BYTES as a picked image, since it rides in the deck JSON.
async function imageData(pkg, rel, warn) {
  if (!rel) return null;
  if (rel.external) { warn('A linked (external) picture was skipped.'); return null; }
  if (pkg.media.has(rel.target)) {
    // Each element carries its own data URL (there's no shared asset store yet).
    warn('Pictures reused across slides (e.g. master logos or backgrounds) are copied onto every slide, which enlarges the deck.');
  } else pkg.media.set(rel.target, encodeImage(pkg, rel.target, warn));
  const src = await pkg.media.get(rel.target);
  // Every copy is serialized into the deck JSON, so all copies (not just the
  // distinct pictures) share an output budget; past it, further copies are skipped.
  if (src) {
    pkg.outChars += src.length;
    if (pkg.outChars > MAX_OUTPUT_IMAGE_CHARS) {
      warn('Some repeated picture copies were skipped to keep the deck within its 96 MB picture budget.');
      return null;
    }
  }
  return src;
}
async function encodeImage(pkg, target, warn) {
  const ext = target.split('.').pop().toLowerCase();
  const mime = MIME[ext];
  const file = pkg.zip.file(target);
  if (!mime || !file) { warn(`A .${ext} picture can't be shown in the browser and was skipped.`); return null; }
  // Reject from the zip directory's declared size before inflating (JSZip keeps
  // it on the loaded entry); the post-decode check covers an entry without one.
  const tooBig = () => { warn('A picture larger than 10 MB was skipped.'); return null; };
  if (file._data?.uncompressedSize > MAX_IMAGE_BYTES) return tooBig();
  // A package-wide budget too: many pictures each under the cap could still
  // exhaust memory, so later ones are skipped once the total is spent.
  pkg.mediaBytes += file._data?.uncompressedSize ?? 0;
  if (pkg.mediaBytes > MAX_MEDIA_TOTAL_BYTES) {
    warn('Pictures beyond the 64 MB total import budget were skipped.');
    return null;
  }
  const b64 = await file.async('base64');
  if ((b64.length * 3) / 4 > MAX_IMAGE_BYTES) return tooBig();
  return `data:${mime};base64,${b64}`;
}

// Background: slide → layout → master; a solid/gradient fill or a theme bgRef
// gives bgColor; a picture fill becomes a full-bleed image element underneath.
// Tiling has no image-element equivalent; the picture stretches to its frame instead.
const TILE_WARNING = 'Tiled picture fills were imported as a single stretched picture.';
async function backgroundOf(pkg, ctx, parts, warn) {
  for (const { root, rels } of parts) {
    const bg = path(root, 'cSld', 'bg');
    if (!bg) continue;
    const bgPr = kid(bg, 'bgPr');
    if (bgPr) {
      const blip = path(bgPr, 'blipFill', 'blip');
      if (blip) {
        if (path(bgPr, 'blipFill', 'tile')) warn(TILE_WARNING);
        const src = await imageData(pkg, rels[blipRel(blip)], warn);
        if (src) return { image: src };
      }
      const f = fillOf(bgPr, ctx, warn);
      if (f?.color) return { color: f.color.hex };
    }
    const ref = colorIn(kid(bg, 'bgRef'), ctx);
    if (ref) return { color: ref.hex };
  }
  return { color: schemeColor(ctx, 'bg1')?.hex || '#FFFFFF' };
}

// Speaker notes: the notes slide's body placeholder text.
async function notesOf(pkg, rels) {
  const part = relOfType(rels, 'notesSlide');
  const root = part && await pkg.xml(part);
  const tree = path(root, 'cSld', 'spTree');
  const body = kids(tree, 'sp').find((s) => phOf(s)?.type === 'body');
  if (!body) return '';
  return kids(kid(body, 'txBody'), 'p').map((p) => [...p.children]
    .map((c) => (c.localName === 'br' ? '\n' : kid(c, 't')?.textContent ?? '')).join('')).join('\n').trim();
}

// p:transition (possibly inside mc:AlternateContent) → { type, duration }.
const SPEED_MS = { fast: 500, med: 750, slow: 1000 };
function transitionOf(root) {
  const tr = desc(root, 'transition');
  if (!tr) return null;
  // The effect is the transition's first child that isn't a sound/extension.
  const kind = [...tr.children].find((e) => !['sndAc', 'extLst'].includes(e.localName))?.localName;
  const type = !kind ? 'fade' : kind === 'morph' ? 'morph' : kind === 'cut' ? 'none'
    : ['push', 'wipe', 'cover', 'pull', 'split', 'reveal', 'pan'].includes(kind) ? 'slide' : 'fade';
  const dur = numAttr(tr, 'dur') ?? SPEED_MS[attr(tr, 'spd')] ?? 750;
  return { type, duration: dur > 0 ? dur : 750 };
}

const plainText = (sp) => kids(kid(sp, 'txBody'), 'p')
  .map((p) => kids(p, 'r').map((r) => kid(r, 't')?.textContent ?? '').join('')).join(' ').trim();

// Theme: colour scheme + major/minor latin fonts.
function themeOf(themeRoot) {
  const scheme = {};
  const clr = desc(themeRoot, 'clrScheme');
  for (const c of clr ? clr.children : []) {
    const v = kid(c, 'srgbClr') ? attr(kid(c, 'srgbClr'), 'val') : attr(kid(c, 'sysClr'), 'lastClr');
    if (v) scheme[c.localName] = v.toUpperCase();
  }
  const fonts = {
    major: attr(path(desc(themeRoot, 'majorFont'), 'latin'), 'typeface') || undefined,
    minor: attr(path(desc(themeRoot, 'minorFont'), 'latin'), 'typeface') || undefined,
  };
  return { scheme, fonts };
}

/**
 * Import a .pptx (ArrayBuffer / Uint8Array / Blob) into a Stagecraft deck.
 * @returns {Promise<{ deck, warnings: string[] }>} — `deck` is `{ title, author,
 *   theme, sections, slides }` ready for `createDeck`; every slide is a `blank`
 *   slide whose `elements` passed the element gate. `warnings` are de-duplicated,
 *   human-readable notes about content that couldn't be represented.
 */
export async function importPptx(data, { fileName = '' } = {}) {
  let zip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error('Not a valid .pptx file (could not unzip it).'); }
  const pkg = new Pkg(zip);
  const presPart = 'ppt/presentation.xml';
  const pres = await pkg.xml(presPart);
  if (!pres || pres.localName !== 'presentation') throw new Error('Not a PowerPoint presentation (ppt/presentation.xml is missing).');
  const presRels = await pkg.rels(presPart);

  const warnings = new Set();
  const warn = (m) => warnings.add(m);

  const sz = kid(pres, 'sldSz');
  const fit = makeFit(numAttr(sz, 'cx', 12192000), numAttr(sz, 'cy', 6858000));

  const core = await pkg.xml('docProps/core.xml');
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const title = desc(core, 'title')?.textContent?.trim() || baseName || 'Imported presentation';
  const author = desc(core, 'creator')?.textContent?.trim() || '';

  const slideEntries = kids(kid(pres, 'sldIdLst'), 'sldId').map((s) => ({
    sldId: [...s.attributes].find((a) => a.localName === 'id' && !a.prefix)?.value,
    part: presRels[relAttr(s, 'id')]?.target,
  }));

  // A master's parsing context (theme colours/fonts, colour map, text styles);
  // a slide without a layout/master gets the same shape with empty defaults.
  const masterCache = new Map();
  async function masterCtx(masterPart) {
    if (masterCache.has(masterPart)) return masterCache.get(masterPart);
    const root = masterPart ? await pkg.xml(masterPart) : null;
    const rels = masterPart ? await pkg.rels(masterPart) : {};
    const theme = themeOf(await pkg.xml(relOfType(rels, 'theme')));
    const clrMap = { ...DEFAULT_CLR_MAP };
    for (const a of kid(root, 'clrMap')?.attributes ?? []) clrMap[a.localName] = a.value;
    const m = { root, rels, ctx: { fit, scheme: theme.scheme, fonts: theme.fonts, clrMap, txStyles: kid(root, 'txStyles') } };
    masterCache.set(masterPart, m);
    return m;
  }

  const slides = [];
  const bySldId = new Map();
  for (const [i, entry] of slideEntries.entries()) {
    if (!entry.part) continue;
    const root = await pkg.xml(entry.part);
    if (!root) continue;
    const rels = await pkg.rels(entry.part);
    const layoutPart = relOfType(rels, 'slideLayout');
    const layoutRoot = layoutPart ? await pkg.xml(layoutPart) : null;
    const layoutRels = layoutPart ? await pkg.rels(layoutPart) : {};
    const masterPart = relOfType(layoutRels, 'slideMaster');
    const master = await masterCtx(masterPart);
    // A colour-map override on the slide, else on its layout, remaps tx/bg.
    // A slide-level clrMapOvr is authoritative even when it picks masterClrMapping.
    const ovrSrc = kid(root, 'clrMapOvr') ?? kid(layoutRoot, 'clrMapOvr');
    const ovr = desc(ovrSrc, 'overrideClrMapping');
    const ctx = ovr ? { ...master.ctx, clrMap: Object.fromEntries([...ovr.attributes].map((a) => [a.localName, a.value])) } : master.ctx;

    const id = `pptx-${i + 1}`;
    const reader = new SlideReader(pkg, ctx, rels, path(layoutRoot, 'cSld', 'spTree'), path(master.root, 'cSld', 'spTree'), warn);
    const bg = await backgroundOf(pkg, ctx, [
      { root, rels }, { root: layoutRoot, rels: layoutRels }, { root: master.root, rels: master.rels },
    ], warn);
    if (bg.image) reader.push({ type: 'image', x: round2(fit.ox), y: round2(fit.oy), w: round2(fit.w), h: round2(fit.h), src: bg.image, fit: 'stretch' });
    // Non-placeholder art on the layout/master (logos, bars) shows on the slide
    // unless the slide/layout hides master shapes (showMasterSp="0").
    if (boolAttr(root, 'showMasterSp', true)) {
      if (boolAttr(layoutRoot, 'showMasterSp', true)) await furniture(reader, master.root, master.rels);
      await furniture(reader, layoutRoot, layoutRels);
    }
    const ownFrom = reader.out.length; // the slide's own content follows master/layout art
    await reader.walk(path(root, 'cSld', 'spTree'));

    const titleSp = kids(path(root, 'cSld', 'spTree'), 'sp').find((s) => ['title', 'ctrTitle'].includes(phOf(s)?.type));
    const slide = {
      id, layout: 'blank',
      title: (titleSp && plainText(titleSp))
        || reader.out.slice(ownFrom).find((e) => e.type === 'text')?.content.split('\n')[0].trim()
        || `Slide ${i + 1}`,
      bgColor: bg.color || '#FFFFFF',
      elements: reader.out,
    };
    const notes = await notesOf(pkg, rels);
    if (notes) slide.notes = notes;
    const transition = transitionOf(root);
    if (transition) slide.transition = transition;
    if (relOfType(rels, 'comments')) warn('Slide comments were not imported.');
    if (kid(root, 'timing')) warn('Slide animations were not imported (only slide transitions).');
    if (!boolAttr(root, 'show', true)) warn('Hidden slides were imported as normal slides.');
    slides.push(slide);
    bySldId.set(entry.sldId, id);
  }

  // PowerPoint sections (p14:sectionLst) → deck sections; anything unsectioned
  // lands in a trailing/only section so no slide is orphaned.
  const sections = [];
  const placed = new Set();
  const sectionLst = desc(kid(pres, 'extLst'), 'sectionLst');
  for (const [i, sec] of kids(sectionLst, 'section').entries()) {
    const ids = kids(kid(sec, 'sldIdLst'), 'sldId').map((s) => bySldId.get(attr(s, 'id'))).filter((x) => x && !placed.has(x));
    ids.forEach((x) => placed.add(x));
    sections.push({ id: `pptx-sec-${i + 1}`, name: attr(sec, 'name') || `Section ${i + 1}`, slides: ids });
  }
  const rest = slides.map((s) => s.id).filter((x) => !placed.has(x));
  if (rest.length || !sections.length) sections.push({ id: `pptx-sec-${sections.length + 1}`, name: sections.length ? 'Other slides' : 'Slides', slides: rest });

  return { deck: { title, author, theme: 'slate', sections, slides }, warnings: [...warnings] };
}

// Layout/master decoration: every non-placeholder shape on the part, drawn
// beneath the slide's own content (placeholders are templates, not content).
// Their pictures resolve against the part's own relationships.
async function furniture(reader, root, rels) {
  const tree = path(root, 'cSld', 'spTree');
  if (tree) await reader.walk(tree, { rels, only: (n) => !phOf(n) });
}
