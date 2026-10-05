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
  return { hex: `#${rgb.map(hex2).join('')}`, alpha };
}

const PRESET_COLORS = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080' };
const DEFAULT_CLR_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
// A scheme slot (through the colour map) as an opaque colour, or null.
const schemeHex = (ctx, key) => ctx.scheme[ctx.clrMap[key] || key] || null;
const schemeColor = (ctx, key) => {
  const v = schemeHex(ctx, key);
  return v ? { hex: `#${v}`, alpha: 1 } : null;
};

// Resolve a colour-choice element (srgbClr / schemeClr / sysClr / prstClr) to
// { hex: '#RRGGBB', alpha } — or null when it can't be resolved (phClr etc.).
function colorOf(clrEl, ctx) {
  if (!clrEl) return null;
  let base = null;
  switch (clrEl.localName) {
    case 'srgbClr': base = attr(clrEl, 'val'); break;
    case 'sysClr': base = attr(clrEl, 'lastClr') || (attr(clrEl, 'val') === 'window' ? 'FFFFFF' : '000000'); break;
    case 'prstClr': base = PRESET_COLORS[attr(clrEl, 'val')] || null; break;
    case 'schemeClr': base = schemeHex(ctx, attr(clrEl, 'val')); break;
    default: return null;
  }
  if (!base || !/^[0-9a-f]{6}$/i.test(base)) return null;
  return applyMods(base.toUpperCase(), clrEl);
}
// The colour inside a fill-ish parent (solidFill / bgRef / fontRef / …).
const COLOR_TAGS = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr'];
const colorIn = (parent, ctx) => {
  const c = parent && [...parent.children].find((x) => COLOR_TAGS.includes(x.localName));
  return c ? colorOf(c, ctx) : null;
};

// A shape-properties fill → { kind: 'none' } | { kind: 'solid', color } |
// { kind: 'grad', color, from, to, angle } | null (unspecified → inherit/style).
// `color` is the fill's representative solid (a gradient's first stop).
function fillOf(props, ctx) {
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
    // OOXML lin ang is clockwise from →, in 60000ths; CSS 0deg is ↑ → +90.
    const ang = numAttr(kid(grad, 'lin'), 'ang', 0) / 60000;
    return { kind: 'grad', color: stops[0].color, from: stops[0].color, to: stops[stops.length - 1].color, angle: Math.round((ang + 90) % 360) };
  }
  return null;
}

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
    if (!t.trim()) { lines.push(t); continue; }
    const pPr = kid(p, 'pPr');
    // Bullets: the nearest buNone / buChar / buAutoNum in the chain decides.
    const bullet = firstOf([pPr, ...localFor(p), masterFor(p)], (el) => (kid(el, 'buNone') ? 'none'
      : kid(el, 'buChar') ? (attr(kid(el, 'buChar'), 'char') || '•')
        : kid(el, 'buAutoNum') ? '•' : null));
    const indent = '  '.repeat(numAttr(pPr, 'lvl', 0));
    lines.push(bullet && bullet !== 'none' ? `${indent}${bullet} ${t}` : t);
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
  const fontScale = firstOf(bodyPrs, (bp) => numAttr(kid(bp, 'normAutofit'), 'fontScale')) ?? 100000;
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
    ...(color.alpha < 1 ? { opacity: Math.round(color.alpha * 100) } : {}),
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
    const ph = phOf(sp);
    const lay = ph ? findPh(this.layoutTree, ph) : null;
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

  shape(sp, groupT, groupId) {
    const inh = this.inherit(sp);
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
    const pairUp = () => { gid = gid || (text ? this.id('grp') : undefined); return gid; };
    if (type) {
      const fill = fillOf(spPr, this.ctx) || firstOf(inh.spPrs, (p) => fillOf(p, this.ctx))
        || (styleFill ? { kind: 'solid', color: styleFill } : { kind: 'none' });
      const stroke = ln ? {
        stroke: ln.color.hex, strokeWidth: Math.max(1, round2(ln.w * this.ctx.fit.k)),
        ...(ln.dash ? { strokeDash: ln.dash } : {}),
      } : {};
      if (fill.color) {
        this.push({
          type, ...geo, fill: fill.color.hex, ...stroke,
          ...(fill.color.alpha < 1 ? { opacity: Math.round(fill.color.alpha * 100) } : {}),
          ...(fill.kind === 'grad' ? { gradient: { from: fill.from.hex, to: fill.to.hex, angle: fill.angle } } : {}),
        }, pairUp());
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
    const alpha = ln.color.alpha < 1 ? { opacity: Math.round(ln.color.alpha * 100) } : {};
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
      ...(ln.color.alpha < 1 ? { opacity: Math.round(ln.color.alpha * 100) } : {}),
    }, groupId);
  }

  async picture(pic, groupT, groupId, rels) {
    const inh = this.inherit(pic);
    const box = xfrmBox(inh.xfrm, groupT);
    if (!box) return;
    if (box.flipH || box.flipV) this.warn(FLIP_WARNING);
    const srcRect = path(pic, 'blipFill', 'srcRect');
    if (srcRect && [...srcRect.attributes].some((a) => Number(a.value))) this.warn('Cropped pictures import uncropped (stretched to their frame).');
    const rId = blipRel(path(pic, 'blipFill', 'blip'));
    const src = await imageData(this.pkg, rels[rId], this.warn);
    // PowerPoint stretches a picture to its frame (a:stretch) — keep that, not cover.
    if (src) this.push({ type: 'image', ...toPx(box, this.ctx.fit), src, fit: 'stretch' }, groupId);
  }

  frame(gf, groupT, groupId) {
    const box = xfrmBox(kid(gf, 'xfrm'), groupT);
    const data = path(gf, 'graphic', 'graphicData');
    const tbl = kid(data, 'tbl');
    if (box && tbl) { this.table(tbl, box, groupId); return; }
    const uri = attr(data, 'uri') || '';
    const what = uri.includes('chart') ? 'chart' : uri.includes('diagram') ? 'SmartArt graphic' : 'embedded object';
    this.warn(`A ${what} can't be imported yet — a labelled placeholder was added.`);
    if (box) {
      const geo = toPx(box, this.ctx.fit);
      this.push({ type: 'rect', ...geo, fill: '#F2F2F2', stroke: '#BFBFBF', strokeWidth: 2, strokeDash: 'dashed' }, groupId);
      this.push({ type: 'text', ...geo, content: `[${what} — not imported]`, fill: '#7F7F7F',
        fontSize: 24, align: 'center', valign: 'middle' }, groupId);
    }
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
          const fill = fillOf(kid(tc, 'tcPr'), this.ctx);
          // An explicitly transparent cell keeps only its grid outline; an
          // unspecified one (table style decides) falls back to white.
          if (fill?.kind === 'none') {
            this.push({ type: 'path', ...geo, points: outlinePoints('rect'), stroke: '#BFBFBF', strokeWidth: 1 }, gid);
          } else {
            this.push({ type: 'rect', ...geo, fill: fill?.color ? fill.color.hex : '#FFFFFF', stroke: '#BFBFBF', strokeWidth: 1 }, gid);
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
async function backgroundOf(pkg, ctx, parts, warn) {
  for (const { root, rels } of parts) {
    const bg = path(root, 'cSld', 'bg');
    if (!bg) continue;
    const bgPr = kid(bg, 'bgPr');
    if (bgPr) {
      const blip = path(bgPr, 'blipFill', 'blip');
      if (blip) {
        const src = await imageData(pkg, rels[blipRel(blip)], warn);
        if (src) return { image: src };
      }
      const f = fillOf(bgPr, ctx);
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
