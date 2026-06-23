import pptxgen from 'pptxgenjs';
import { chartSpec, CHART_SERIES_HEX } from './chartSpec.js';
import { SEVERITY_HEX } from './riskSpec.js';
import { roadmapModel, ROADMAP_HEX, ROADMAP_LABELS, ROADMAP_STATES } from './roadmapSpec.js';
import { resolveNotes } from '../data/deck.js';
import { flattenDeck } from './deckOrder.js';
import { toHex, isHexColor, mixHex } from './color.js';
import { SLIDE_W, SHADOW_OPACITY, isRenderableShadow, isRenderableGradient, isFinitePoint, dashType, lineSpacingOf } from './elements.js';
import { shapeDef, hasVisibleStroke } from './shapes.js';

// ---- theme colours (fallback to indigo) ----
const THEME_COLORS = {
  indigo:  { accent: '7C5FDC', bg: '0E0E1A', ink: 'FFFFFF' },
  amber:   { accent: 'D4A830', bg: '1A160A', ink: 'FFFFFF' },
  emerald: { accent: '2ECC71', bg: '0A1A10', ink: 'FFFFFF' },
  magenta: { accent: 'CC2E88', bg: '1A0A12', ink: 'FFFFFF' },
  coral:   { accent: 'E05C3A', bg: '1A0E0A', ink: 'FFFFFF' },
  slate:   { accent: '6E7A90', bg: '12151A', ink: 'FFFFFF' },
};

function themeColors(theme) {
  return THEME_COLORS[theme] || THEME_COLORS.indigo;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return { r, g, b };
}

// ---- free-form elements overlay (slide.elements) ----
// The slide is authored in an `SLIDE_W`-wide px space; LAYOUT_16x9 is 10 in
// wide, so both axes scale by the same px/in (derive it from SLIDE_W rather than
// hardcode, so a change to the authoring width rescales the export too). Fonts:
// 72 pt/in.
const SLIDE_IN_W = 10; // LAYOUT_16x9 width in inches
const PX_PER_IN = SLIDE_W / SLIDE_IN_W;
const IN = (px) => +(px / PX_PER_IN).toFixed(4);
const PT = (px) => +((px * 72) / PX_PER_IN).toFixed(2);
const clampPct = (v) => Math.max(0, Math.min(100, v));
// pptxgenjs 3.12 coalesces a falsy shadow field to its OWN default (blur||8,
// offset||4, angle||270, opacity||0.75), so a genuine 0 — a centred glow, a
// rightward shadow, a sharp shadow, a faint element — would export as pptx's
// upward 4pt default. A sub-unit epsilon survives the `||` but rounds back to 0
// in the EMU / 60000ths / 100000ths pptx serialises to, preserving the 0.
const keepZero = (v) => (v === 0 ? 1e-6 : v);
// Coerce to a finite number (default `d`) — the export is a serialization
// boundary: the deck is disk-persisted and may be agent/MCP-authored, so a
// non-finite coord/size would otherwise write NaN into the .pptx and corrupt it.
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
// An element's fill as a bare RRGGBB (pptx wants no '#'); toHex supplies the
// canonical hex + indigo fallback so a bad value can't break the export.
const pxHex = (fill) => toHex(fill).slice(1).toUpperCase();

// Per-field/per-item formatting (slide.fmt, keyed by the renderer's E() path —
// 'title', 'items.0.t', 'rows.1.4', …). Map a fmt record to pptx text-option
// overrides: bold/italic/underline/colour translate 1:1, and only set props
// override (so un-setting returns the field to its template baseline, matching
// the canvas). `fontSize` is intentionally NOT applied — fmt.fontSize is an
// absolute canvas-px size, but the layout builders use a hand-tuned pt scale
// (not PT(px)), so applying it would mis-scale against the unformatted base.
// Keep the prop set in sync with the canvas equivalent `fmtStyle` (slideFmt.js)
// and the `FMT_PROP_OK` gate (deckUtils.js) if a new formatting prop is added.
function fmtOpts(fmt) {
  if (!fmt || typeof fmt !== 'object') return undefined;
  const o = {};
  if (fmt.bold) o.bold = true;
  if (fmt.italic) o.italic = true;
  // Object form, not `true`: pptxgenjs normalizes a boolean underline to
  // {style:'sng'} only on the addText path — table cells (addTable) emit the
  // underline XML only for an object/string, so a boolean would silently drop
  // in exported tables. The object form underlines on both paths.
  if (fmt.underline) o.underline = { style: 'sng' };
  // Only a #hex colour exports faithfully. The patch gate allows any string for
  // fmt.color and the toolbar emits #rrggbb, but an AI patch could set a named/
  // oklch colour toHex can't convert (it would fall back to indigo) — leave the
  // field's own colour rather than export a wrong one.
  if (isHexColor(fmt.color)) o.color = pxHex(fmt.color);
  return o;
}
// The pptx text-option override for a slide field (its `slide.fmt[key]` record,
// if any) — the single accessor used by both addText fields (fmtText) and the
// table-cell builder, so the fmt-map lookup lives in one place.
const fmtFor = (slide, key) => fmtOpts(slide.fmt?.[key]);
// addText with the slide.fmt[key] override (if any) merged over the base options.
function fmtText(sld, slide, key, value, opts) {
  sld.addText(value, { ...opts, ...fmtFor(slide, key) });
}

function elementGeo(el) {
  const g = { x: IN(num(el.x)), y: IN(num(el.y)), w: IN(num(el.w)), h: IN(num(el.h)) };
  const rot = num(el.rot);
  if (rot) g.rotate = rot; // pptx rotates about the shape centre, like the canvas
  return g;
}

// Draw a slide's free-form elements over whatever the layout builder produced,
// so anything placed on the canvas survives export. Geometry/rotation/opacity
// map 1:1; image objectFit and text auto-fit aren't reproduced exactly.
function addElements(pptx, sld, slide) {
  const ST = pptx.ShapeType;
  // The deck is persisted/agent-authorable, so tolerate a non-array or null entries.
  const elements = (Array.isArray(slide.elements) ? slide.elements : []).filter(Boolean);
  for (const el of elements) {
    const geo = elementGeo(el);
    const transparency = Number.isFinite(el.opacity) ? clampPct(100 - el.opacity) : undefined;
    const withOpacity = transparency != null ? { transparency } : {};
    // A drop shadow (any element type) → a pptx outer shadow. x/y px offset →
    // polar offset/angle; blur px → pt. Its opacity is the shared soft alpha
    // dimmed by the element opacity, since the canvas opacity dims the whole
    // element (shadow included) — matching the fill/line transparency. pptxgen
    // 3.12 emits the shape shadow with a hardcoded rotWithShape="0" (an ABSOLUTE
    // angle; the `rotateWithShape` option is ignored), so el.rot is baked into
    // the angle — on the canvas the drop-shadow filter and the rotate transform
    // share one node, so the offset turns with the shape.
    const op = clampPct(Number.isFinite(el.opacity) ? el.opacity : 100) / 100;
    const withShadow = isRenderableShadow(el.shadow) ? { shadow: {
      type: 'outer',
      color: pxHex(el.shadow.color),
      opacity: keepZero(Math.round(SHADOW_OPACITY * op * 100) / 100), // round half-up (toFixed has a float artifact at .175)
      blur: keepZero(PT(el.shadow.blur)),
      offset: keepZero(PT(Math.hypot(el.shadow.x, el.shadow.y))),
      // Local offset direction (atan2, y-down so it reads clockwise like pptx
      // dir) + el.rot, normalised to [0,360). The rotation is baked in because
      // pptxgen 3.12 emits rotWithShape="0" — an absolute angle.
      angle: keepZero(Math.round(((Math.atan2(el.shadow.y, el.shadow.x) * 180 / Math.PI + num(el.rot)) % 360 + 360) % 360)),
    } } : {};
    if (el.type === 'text') {
      sld.addText(el.content || '', {
        ...geo, fontSize: PT(num(el.fontSize, 48)), bold: !!el.bold, italic: !!el.italic,
        underline: !!el.underline, align: el.align || 'left', valign: 'middle', lineSpacingMultiple: lineSpacingOf(el),
        // Match ElementView's `var(--ink, #15171C)` text default (not the deck
        // theme's white ink) so a fill-less text element isn't invisible.
        color: pxHex(el.fill || '#15171C'), fontFace: el.fontFamily || 'Inter', ...withOpacity, ...withShadow,
      });
      continue;
    }
    if (el.type === 'image') {
      if (el.src) sld.addImage({ ...geo, data: el.src, ...withOpacity, ...withShadow });
      continue;
    }
    if (el.type === 'path') {
      // A freehand pen stroke → pptxgen custom geometry: the 0..1 points scaled
      // into the box's inch dims (pptxgen converts each to EMU within the path's
      // w/h, keying the first/moveTo vs the rest/lnTo), drawn as a line (stroke)
      // with no fill — matching the canvas SVG polyline.
      const pts = (Array.isArray(el.points) ? el.points : []).filter(isFinitePoint).map(([nx, ny], i) => ({
        x: nx * geo.w, y: ny * geo.h, ...(i === 0 ? { moveTo: true } : {}),
      }));
      if (pts.length < 2) continue; // a 0/1-point path is degenerate (a corrupt custGeom); the canvas draws nothing either
      const lw = PT(num(el.strokeWidth, 2));
      const dt = dashType(el.strokeDash);
      // No `fill` key → pptxgen emits <a:noFill/> (pptxgen.cjs.js:5471), i.e. an
      // open stroke matching the canvas polyline ({type:'none'} would instead emit
      // an empty fill and inherit a theme fill). A 0/negative width draws no line —
      // pptxgen would otherwise emit <a:ln> + colour (a default ~0.75pt line) that
      // the canvas's zero-width stroke does not draw.
      sld.addShape(ST.custGeom, {
        ...geo, points: pts,
        ...(lw > 0 ? { line: { color: pxHex(el.stroke || '#15171C'), width: lw, ...withOpacity, ...(dt ? { dashType: dt } : {}) } } : {}),
        ...withShadow,
      });
      continue;
    }
    // Shapes (incl. line) carry a colour fill; the registry drives the mapping.
    // A line maps to a rect at its real geometry — its height IS its thickness,
    // so the generic shape path covers it (def.pptx === 'rect').
    const def = shapeDef(el.type);
    // A gradient fill has no pptx shape equivalent, so it exports as the midpoint
    // blend of its two stops — the solid that sits between the canvas gradient.
    // A malformed gradient falls back to the solid `fill`, matching the canvas.
    const fillColor = isRenderableGradient(el.gradient) ? mixHex(el.gradient.from, el.gradient.to) : (el.fill || '#15171C');
    const fill = { color: pxHex(fillColor), ...withOpacity };
    const opts = { ...geo, fill, ...withShadow };
    // A box shape's stroke → a pptx line (colour + pt width), matching the
    // canvas CSS border. Only the box shapes carry it (clip shapes don't stroke
    // on the canvas, so they don't here either — parity). See isStrokeableShape.
    if (hasVisibleStroke(el)) {
      // ...withOpacity so a translucent shape's outline matches its canvas border
      // (the canvas applies the element opacity to the whole div, border included).
      const dt = dashType(el.strokeDash);
      opts.line = { color: pxHex(el.stroke), width: PT(el.strokeWidth), ...withOpacity, ...(dt ? { dashType: dt } : {}) };
    }
    sld.addShape(ST[def?.pptx] || ST.rect, opts);
  }
}

// ---- per-layout slide builders ----
function addCoverSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: slide.bg === 'accent' ? tc.accent : tc.bg };
  fmtText(sld, slide, 'title', slide.title || 'Untitled', {
    x: 0.5, y: 2.5, w: 9, h: 1.2,
    fontSize: 44, bold: true, color: tc.ink,
    fontFace: 'Inter', align: 'left',
  });
  if (slide.subtitle) {
    fmtText(sld, slide, 'subtitle', slide.subtitle, {
      x: 0.5, y: 3.9, w: 9, h: 0.5,
      fontSize: 16, color: 'AAAAAA',
      fontFace: 'Inter', align: 'left',
    });
  }
  return sld;
}

function addAgendaSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  fmtText(sld, slide, 'title', slide.title || 'Agenda', {
    x: 0.5, y: 0.4, w: 9, h: 0.6,
    fontSize: 22, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  const items = slide.items || [];
  let row = 0; // gap-free layout position; `i` stays the true index for the fmt key
  items.forEach((it, i) => {
    if (!it) return; // null item — skip like the canvas, keep `i` the true fmt index
    const y = 1.3 + row * 0.9;
    row += 1;
    fmtText(sld, slide, `items.${i}.n`, it.n, { x: 0.5, y, w: 0.5, h: 0.4, fontSize: 12, color: tc.accent, fontFace: 'Courier New' });
    fmtText(sld, slide, `items.${i}.t`, it.t, { x: 1.1, y, w: 5, h: 0.4, fontSize: 15, bold: true, color: tc.ink, fontFace: 'Inter' });
    fmtText(sld, slide, `items.${i}.d`, it.d, { x: 1.1, y: y + 0.38, w: 7, h: 0.35, fontSize: 11, color: 'AAAAAA', fontFace: 'Inter' });
  });
  return sld;
}

function addDividerSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: slide.bg === 'accent' ? tc.accent : tc.bg };
  if (slide.chapter) {
    sld.addText(slide.chapter, {
      x: 0.5, y: 2.0, w: 2, h: 0.6,
      fontSize: 48, bold: true, color: slide.bg === 'accent' ? tc.bg : tc.accent,
      fontFace: 'Courier New',
    });
  }
  fmtText(sld, slide, 'title', slide.title || '', {
    x: 0.5, y: 3.0, w: 9, h: 0.8,
    fontSize: 36, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  return sld;
}

function addKpiSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  fmtText(sld, slide, 'title', slide.title || '', {
    x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  const kpis = slide.kpis || [];
  const cols = 3;
  let n = 0; // grid position of rendered cards (gap-free); `i` stays the true fmt index
  kpis.forEach((k, i) => {
    if (!k) return; // null KPI — skip like the canvas, keep `i` the true fmt index
    const col = n % cols;
    const row = Math.floor(n / cols);
    n += 1;
    const x = 0.5 + col * 3.2;
    const y = 1.1 + row * 1.8;
    sld.addShape(pptx.ShapeType.rect, { x, y, w: 3, h: 1.5, fill: { color: '1A1A2E' }, line: { color: '333355', width: 1 } });
    fmtText(sld, slide, `kpis.${i}.val`, k.val, { x, y: y + 0.2, w: 3, h: 0.6, fontSize: 28, bold: true, color: tc.ink, align: 'center', fontFace: 'Inter' });
    fmtText(sld, slide, `kpis.${i}.label`, k.label, { x, y: y + 0.85, w: 3, h: 0.3, fontSize: 11, color: 'AAAAAA', align: 'center', fontFace: 'Inter' });
    const deltaColor = k.good === true ? '2ECC71' : k.good === false ? 'E74C3C' : 'AAAAAA';
    fmtText(sld, slide, `kpis.${i}.delta`, k.delta || '', { x, y: y + 1.15, w: 3, h: 0.25, fontSize: 10, color: deltaColor, align: 'center', fontFace: 'Courier New' });
  });
  return sld;
}

function addTextSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  if (slide.title) {
    fmtText(sld, slide, 'title', slide.title, {
      x: 0.5, y: 0.4, w: 9, h: 0.7, fontSize: 26, bold: true, color: tc.ink, fontFace: 'Inter',
    });
  }
  if (slide.body) {
    fmtText(sld, slide, 'body', slide.body, {
      x: 0.5, y: 1.3, w: 9, h: 4, fontSize: 15, color: 'CCCCCC', fontFace: 'Inter', valign: 'top',
      wrap: true,
    });
  }
  return sld;
}

function addListSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  fmtText(sld, slide, 'title', slide.title || '', {
    x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  const items = slide.items || [];
  let row = 0; // gap-free position; `i` stays the true index for the fmt key
  items.forEach((item, i) => {
    if (item == null) return; // nullish bullet — skip like the canvas (no "• null"), keep `i` the true index
    fmtText(sld, slide, `items.${i}`, `• ${item}`, {
      x: 0.7, y: 1.2 + row * 0.65, w: 8.5, h: 0.55,
      fontSize: 14, color: 'DDDDDD', fontFace: 'Inter',
    });
    row += 1;
  });
  return sld;
}

function addTableSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  fmtText(sld, slide, 'title', slide.title || '', {
    x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  const cols = slide.columns || [];
  const rows = slide.rows || [];
  if (cols.length && rows.length) {
    const tableRows = [
      cols.map((c, ci) => ({ text: c, options: { bold: true, color: tc.accent, fontSize: 11, fontFace: 'Courier New', fill: { color: '1A1A2E' }, ...fmtFor(slide, `columns.${ci}`) } })),
      ...rows.map((row, ri) => row.map((cell, ci) => ({ text: cell, options: { color: 'DDDDDD', fontSize: 11, fontFace: 'Inter', ...fmtFor(slide, `rows.${ri}.${ci}`) } }))),
    ];
    sld.addTable(tableRows, {
      x: 0.5, y: 1.0, w: 9, colW: Array(cols.length).fill(9 / cols.length),
      border: { type: 'solid', color: '333355', pt: 1 },
    });
  }
  return sld;
}

// Real, editable PPTX chart (native pptxgenjs chart) instead of a text placeholder.
function addChartSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  fmtText(sld, slide, 'title', slide.title || 'Chart', {
    x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  const { type, barDir, data } = chartSpec(slide);
  sld.addChart(type, data, {
    x: 0.5, y: 1.0, w: 9, h: 4.0,
    chartColors: [...CHART_SERIES_HEX], // same palette the canvas uses; copy so pptxgenjs can't mutate the frozen source
    // A doughnut has no category axis, so its slices are only identifiable via
    // the legend + on-slice percentages — always show those for doughnut/pie.
    showLegend: data.length > 1 || type === 'doughnut', legendPos: 'b', legendColor: 'AAAAAA', legendFontFace: 'Inter',
    showTitle: false,
    catAxisLabelColor: '888888', valAxisLabelColor: '888888',
    catAxisLabelFontFace: 'Inter', valAxisLabelFontFace: 'Inter',
    ...(barDir ? { barDir } : {}),
    ...(type === 'doughnut' ? { holeSize: 60, showPercent: true, dataLabelColor: 'FFFFFF', dataLabelFontFace: 'Inter' } : {}),
  });
  return sld;
}

function addSplitSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  fmtText(sld, slide, 'title', slide.title || '', {
    x: 0.5, y: 0.4, w: 5.5, h: 0.8, fontSize: 26, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  if (slide.body) {
    fmtText(sld, slide, 'body', slide.body, {
      x: 0.5, y: 1.4, w: 5.5, h: 3.5, fontSize: 14, color: 'CCCCCC', fontFace: 'Inter', wrap: true, valign: 'top',
    });
  }
  const stats = slide.stats || [];
  let srow = 0; // gap-free position; `i` stays the true index for the fmt key
  stats.forEach((s, i) => {
    if (!s) return; // null stat — skip like the canvas, keep `i` the true fmt index
    const y = 1.0 + srow * 1.4;
    srow += 1;
    fmtText(sld, slide, `stats.${i}.val`, s.val, { x: 6.5, y, w: 3, h: 0.7, fontSize: 32, bold: true, color: tc.accent, align: 'center', fontFace: 'Inter' });
    fmtText(sld, slide, `stats.${i}.lbl`, s.lbl, { x: 6.5, y: y + 0.65, w: 3, h: 0.4, fontSize: 12, color: 'AAAAAA', align: 'center', fontFace: 'Inter' });
  });
  return sld;
}

function addRisksSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  fmtText(sld, slide, 'title', slide.title || '', {
    x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 22, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  // Iterate the raw array with its true index `i` (so a fmt key like `items.2.t`
  // matches the renderer, which keys per-item fmt by the original index), but
  // drop falsy items like the canvas does and lay survivors out gap-free via a
  // separate `row` counter — mirroring the renderer's flex column.
  const items = Array.isArray(slide.items) ? slide.items : [];
  let row = 0;
  items.forEach((it, i) => {
    if (!it) return; // malformed item — skip (matches the canvas), keep `i` the true index
    const y = 1.1 + row * 1.3;
    row += 1;
    // Severity colours come from the shared palette (exact sRGB of the canvas
    // oklch), so the export matches the on-screen severity colour. Spell the
    // severity out next to the dot too: in the export the colour is the only
    // severity cue (the canvas also shows a "{sev} RISK" label), and a
    // traffic-light red/green ramp is the classic red-green colour-blind case —
    // the word keeps severity legible without relying on colour.
    const sevLabel = it.sev ? `● ${String(it.sev).toUpperCase()}` : '●';
    // wrap:false — the gutter box is only wide enough for one line; without it
    // PptxGenJS would wrap "● HIGH" onto two lines once PowerPoint's text inset
    // eats into the 0.6" width. (Severity isn't a formattable field — no fmt.)
    sld.addText(sevLabel, { x: 0.4, y: y + 0.05, w: 0.6, h: 0.4, fontSize: 13, bold: true, color: SEVERITY_HEX[it.sev] || SEVERITY_HEX.fallback, fontFace: 'Inter', wrap: false });
    fmtText(sld, slide, `items.${i}.t`, it.t || '', { x: 1.1, y, w: 8.4, h: 0.45, fontSize: 15, bold: true, color: tc.ink, fontFace: 'Inter' });
    fmtText(sld, slide, `items.${i}.d`, it.d || '', { x: 1.1, y: y + 0.45, w: 8.4, h: 0.5, fontSize: 12, color: 'AAAAAA', fontFace: 'Inter', wrap: true });
  });
  return sld;
}

// Native, data-driven roadmap timeline (mirrors the canvas RoadmapGraphic via
// the shared roadmapModel): a month axis, optional TODAY marker, one row per
// lane with status-coloured bars, and a status legend.
function addRoadmapSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  fmtText(sld, slide, 'title', slide.title || 'Roadmap', {
    x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 22, bold: true, color: tc.ink, fontFace: 'Inter',
  });

  const { months, lanes, todayIndex } = roadmapModel(slide);
  const left = 0.5, labelW = 1.3, axisX = left + labelW;
  const axisW = 9.5 - axisX;
  const monthW = axisW / months.length;
  const top = 1.2, bottom = 4.6;
  const laneH = lanes.length ? (bottom - top) / lanes.length : 0;

  // Month axis: label + faint gridline per month.
  months.forEach((m, i) => {
    const x = axisX + i * monthW;
    sld.addText(String(m), { x, y: top - 0.34, w: monthW + 0.3, h: 0.3, fontSize: 8, color: '888888', fontFace: 'Courier New' });
    sld.addShape(pptx.ShapeType.line, { x, y: top, w: 0, h: bottom - top, line: { color: '333355', width: 0.5 } });
  });

  // TODAY marker (dashed) when the model supplies one.
  if (todayIndex != null) {
    const x = axisX + todayIndex * monthW;
    sld.addShape(pptx.ShapeType.line, { x, y: top, w: 0, h: bottom - top, line: { color: 'E0533A', width: 1, dashType: 'dash' } });
    sld.addText('TODAY', { x: x + 0.03, y: top - 0.04, w: 1, h: 0.24, fontSize: 8, bold: true, color: 'E0533A', fontFace: 'Courier New' });
  }

  // Lanes: name + status-coloured bars.
  const barH = Math.min(0.34, laneH * 0.5);
  lanes.forEach((lane, li) => {
    const y = top + li * laneH;
    sld.addText(lane.name, { x: left, y: y + laneH / 2 - 0.15, w: labelW - 0.1, h: 0.3, fontSize: 11, bold: true, color: tc.ink, fontFace: 'Inter' });
    lane.items.forEach((it) => {
      const bx = axisX + it.t * monthW;
      const bw = Math.max(0.12, it.d * monthW - 0.05);
      sld.addShape(pptx.ShapeType.roundRect, {
        x: bx, y: y + laneH / 2 - barH / 2, w: bw, h: barH, rectRadius: 0.04,
        fill: { color: ROADMAP_HEX[it.state] }, line: { type: 'none' },
      });
      if (it.lbl) {
        // Keep the label box inside the bar so short bars don't spill their text
        // onto the dark slide background (where 'planned' dark text would vanish).
        sld.addText(it.lbl, {
          x: bx + 0.06, y: y + laneH / 2 - barH / 2, w: Math.max(0.05, bw - 0.12), h: barH,
          fontSize: 8, color: it.state === 'planned' ? '333333' : 'FFFFFF', fontFace: 'Inter', valign: 'middle',
        });
      }
    });
  });

  // Status legend along the bottom.
  const legendY = bottom + 0.2;
  ROADMAP_STATES.forEach((st, i) => {
    const lx = axisX + i * 1.6;
    sld.addShape(pptx.ShapeType.rect, { x: lx, y: legendY + 0.02, w: 0.16, h: 0.16, fill: { color: ROADMAP_HEX[st] }, line: { type: 'none' } });
    sld.addText(ROADMAP_LABELS[st], { x: lx + 0.22, y: legendY - 0.02, w: 1.3, h: 0.25, fontSize: 9, color: 'AAAAAA', fontFace: 'Inter' });
  });
  return sld;
}

function addThanksSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  fmtText(sld, slide, 'title', slide.title || 'Thank you', {
    x: 0.5, y: 2.2, w: 9, h: 1.2, fontSize: 52, bold: true, color: tc.ink, align: 'center', fontFace: 'Inter',
  });
  if (slide.subtitle) {
    fmtText(sld, slide, 'subtitle', slide.subtitle, {
      x: 0.5, y: 3.6, w: 9, h: 0.5, fontSize: 15, color: 'AAAAAA', align: 'center', fontFace: 'Inter',
    });
  }
  return sld;
}

function addGenericSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  fmtText(sld, slide, 'title', slide.title || slide.layout || '', {
    x: 0.5, y: 0.4, w: 9, h: 0.7, fontSize: 24, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  if (slide.body || slide.subtitle) {
    fmtText(sld, slide, slide.body ? 'body' : 'subtitle', slide.body || slide.subtitle, {
      x: 0.5, y: 1.3, w: 9, h: 4, fontSize: 14, color: 'CCCCCC', fontFace: 'Inter', wrap: true, valign: 'top',
    });
  }
  return sld;
}

// ---- main export function ----
/**
 * Export a deck object to a .pptx file using pptxgenjs.
 * @param {Object} deck — SAMPLE_DECK-shaped object
 */
export async function exportToPPTX(deck, { includeNotes = true, range = null } = {}) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = deck.title || 'Stagecraft Presentation';
  pptx.subject = deck.subtitle || '';
  pptx.author = deck.author || 'Stagecraft';

  const tc = themeColors(deck.theme);

  // Flatten slides in section order (the same order the canvas/sorter render +
  // the export-modal range is measured against — single-sourced via flattenDeck).
  const flat = flattenDeck(deck);
  // An optional 1-indexed inclusive slide range selects a contiguous subset. Clamp
  // both bounds into [1, len] and normalise (swap if inverted) so ANY caller — not
  // just the modal, which already clamps — gets a sane slice rather than a silently
  // empty/truncated deck; an absent range exports the full flattened order.
  let slides = flat;
  if (range) {
    const len = flat.length;
    const clampIdx = (n, dflt) => Math.max(1, Math.min(len, Number.isFinite(n) ? n : dflt));
    const a = clampIdx(range.from, 1), b = clampIdx(range.to, len);
    slides = flat.slice(Math.min(a, b) - 1, Math.max(a, b));
  }

  for (const slide of slides) {
    let sld;
    switch (slide.layout) {
      case 'cover':    sld = addCoverSlide(pptx, slide, tc);   break;
      case 'agenda':   sld = addAgendaSlide(pptx, slide, tc);  break;
      case 'divider':  sld = addDividerSlide(pptx, slide, tc); break;
      case 'kpi':      sld = addKpiSlide(pptx, slide, tc);     break;
      case 'text':     sld = addTextSlide(pptx, slide, tc);    break;
      case 'list':     sld = addListSlide(pptx, slide, tc);    break;
      case 'table':    sld = addTableSlide(pptx, slide, tc);   break;
      case 'split':    sld = addSplitSlide(pptx, slide, tc);   break;
      case 'risks':    sld = addRisksSlide(pptx, slide, tc);   break;
      case 'roadmap':  sld = addRoadmapSlide(pptx, slide, tc); break;
      case 'thanks':   sld = addThanksSlide(pptx, slide, tc);  break;
      case 'chart':    sld = addChartSlide(pptx, slide, tc);   break;
      default:         sld = addGenericSlide(pptx, slide, tc); break;
    }
    // Overlay the free-form elements layer (any layout may carry it).
    if (sld) addElements(pptx, sld, slide);
    // Each builder returns the slide it created, so notes attach at the call
    // boundary the dispatch already owns — no reaching into the pptx instance.
    // `&& sld` guards the return-contract: a future builder that forgot to
    // return its slide degrades to no-notes rather than crashing the export.
    if (includeNotes && sld) {
      const n = resolveNotes(slide);
      if (n) sld.addNotes(n);
    }
  }

  const fileName = `${(deck.title || 'presentation').replace(/[^a-z0-9]/gi, '_')}.pptx`;
  await pptx.writeFile({ fileName });
  return fileName;
}
