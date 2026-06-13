import pptxgen from 'pptxgenjs';
import { chartSpec, CHART_SERIES_HEX } from './chartSpec.js';
import { SEVERITY_HEX } from './riskSpec.js';
import { roadmapModel, ROADMAP_HEX, ROADMAP_LABELS, ROADMAP_STATES } from './roadmapSpec.js';
import { resolveNotes } from '../data/deck.js';

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

// ---- per-layout slide builders ----
function addCoverSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: slide.bg === 'accent' ? tc.accent : tc.bg };
  sld.addText(slide.title || 'Untitled', {
    x: 0.5, y: 2.5, w: 9, h: 1.2,
    fontSize: 44, bold: true, color: tc.ink,
    fontFace: 'Inter', align: 'left',
  });
  if (slide.subtitle) {
    sld.addText(slide.subtitle, {
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
  sld.addText(slide.title || 'Agenda', {
    x: 0.5, y: 0.4, w: 9, h: 0.6,
    fontSize: 22, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  const items = slide.items || [];
  items.forEach((it, i) => {
    const y = 1.3 + i * 0.9;
    sld.addText(it.n, { x: 0.5, y, w: 0.5, h: 0.4, fontSize: 12, color: tc.accent, fontFace: 'Courier New' });
    sld.addText(it.t, { x: 1.1, y, w: 5, h: 0.4, fontSize: 15, bold: true, color: tc.ink, fontFace: 'Inter' });
    sld.addText(it.d, { x: 1.1, y: y + 0.38, w: 7, h: 0.35, fontSize: 11, color: 'AAAAAA', fontFace: 'Inter' });
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
  sld.addText(slide.title || '', {
    x: 0.5, y: 3.0, w: 9, h: 0.8,
    fontSize: 36, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  return sld;
}

function addKpiSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  sld.addText(slide.title || '', {
    x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  const kpis = slide.kpis || [];
  const cols = 3;
  kpis.forEach((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 0.5 + col * 3.2;
    const y = 1.1 + row * 1.8;
    sld.addShape(pptx.ShapeType.rect, { x, y, w: 3, h: 1.5, fill: { color: '1A1A2E' }, line: { color: '333355', width: 1 } });
    sld.addText(k.val, { x, y: y + 0.2, w: 3, h: 0.6, fontSize: 28, bold: true, color: tc.ink, align: 'center', fontFace: 'Inter' });
    sld.addText(k.label, { x, y: y + 0.85, w: 3, h: 0.3, fontSize: 11, color: 'AAAAAA', align: 'center', fontFace: 'Inter' });
    const deltaColor = k.good === true ? '2ECC71' : k.good === false ? 'E74C3C' : 'AAAAAA';
    sld.addText(k.delta || '', { x, y: y + 1.15, w: 3, h: 0.25, fontSize: 10, color: deltaColor, align: 'center', fontFace: 'Courier New' });
  });
  return sld;
}

function addTextSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  if (slide.title) {
    sld.addText(slide.title, {
      x: 0.5, y: 0.4, w: 9, h: 0.7, fontSize: 26, bold: true, color: tc.ink, fontFace: 'Inter',
    });
  }
  if (slide.body) {
    sld.addText(slide.body, {
      x: 0.5, y: 1.3, w: 9, h: 4, fontSize: 15, color: 'CCCCCC', fontFace: 'Inter', valign: 'top',
      wrap: true,
    });
  }
  return sld;
}

function addListSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  sld.addText(slide.title || '', {
    x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  const items = slide.items || [];
  items.forEach((item, i) => {
    sld.addText(`• ${item}`, {
      x: 0.7, y: 1.2 + i * 0.65, w: 8.5, h: 0.55,
      fontSize: 14, color: 'DDDDDD', fontFace: 'Inter',
    });
  });
  return sld;
}

function addTableSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  sld.addText(slide.title || '', {
    x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  const cols = slide.columns || [];
  const rows = slide.rows || [];
  if (cols.length && rows.length) {
    const tableRows = [
      cols.map(c => ({ text: c, options: { bold: true, color: tc.accent, fontSize: 11, fontFace: 'Courier New', fill: { color: '1A1A2E' } } })),
      ...rows.map(row => row.map(cell => ({ text: cell, options: { color: 'DDDDDD', fontSize: 11, fontFace: 'Inter' } }))),
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
  sld.addText(slide.title || 'Chart', {
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
  sld.addText(slide.title || '', {
    x: 0.5, y: 0.4, w: 5.5, h: 0.8, fontSize: 26, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  if (slide.body) {
    sld.addText(slide.body, {
      x: 0.5, y: 1.4, w: 5.5, h: 3.5, fontSize: 14, color: 'CCCCCC', fontFace: 'Inter', wrap: true, valign: 'top',
    });
  }
  const stats = slide.stats || [];
  stats.forEach((s, i) => {
    const y = 1.0 + i * 1.4;
    sld.addText(s.val, { x: 6.5, y, w: 3, h: 0.7, fontSize: 32, bold: true, color: tc.accent, align: 'center', fontFace: 'Inter' });
    sld.addText(s.lbl, { x: 6.5, y: y + 0.65, w: 3, h: 0.4, fontSize: 12, color: 'AAAAAA', align: 'center', fontFace: 'Inter' });
  });
  return sld;
}

function addRisksSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  sld.addText(slide.title || '', {
    x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 22, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  // Drop falsy items like the canvas renderer does, so a malformed deck can't
  // crash the export on it.sev/it.t.
  const items = (Array.isArray(slide.items) ? slide.items : []).filter(Boolean);
  items.forEach((it, i) => {
    const y = 1.1 + i * 1.3;
    // Severity colours come from the shared palette (exact sRGB of the canvas
    // oklch), so the export matches the on-screen severity colour. Spell the
    // severity out next to the dot too: in the export the colour is the only
    // severity cue (the canvas also shows a "{sev} RISK" label), and a
    // traffic-light red/green ramp is the classic red-green colour-blind case —
    // the word keeps severity legible without relying on colour.
    const sevLabel = it.sev ? `● ${String(it.sev).toUpperCase()}` : '●';
    // wrap:false — the gutter box is only wide enough for one line; without it
    // PptxGenJS would wrap "● HIGH" onto two lines once PowerPoint's text inset
    // eats into the 0.6" width.
    sld.addText(sevLabel, { x: 0.4, y: y + 0.05, w: 0.6, h: 0.4, fontSize: 13, bold: true, color: SEVERITY_HEX[it.sev] || SEVERITY_HEX.fallback, fontFace: 'Inter', wrap: false });
    sld.addText(it.t || '', { x: 1.1, y, w: 8.4, h: 0.45, fontSize: 15, bold: true, color: tc.ink, fontFace: 'Inter' });
    sld.addText(it.d || '', { x: 1.1, y: y + 0.45, w: 8.4, h: 0.5, fontSize: 12, color: 'AAAAAA', fontFace: 'Inter', wrap: true });
  });
  return sld;
}

// Native, data-driven roadmap timeline (mirrors the canvas RoadmapGraphic via
// the shared roadmapModel): a month axis, optional TODAY marker, one row per
// lane with status-coloured bars, and a status legend.
function addRoadmapSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  sld.addText(slide.title || 'Roadmap', {
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
  sld.addText(slide.title || 'Thank you', {
    x: 0.5, y: 2.2, w: 9, h: 1.2, fontSize: 52, bold: true, color: tc.ink, align: 'center', fontFace: 'Inter',
  });
  if (slide.subtitle) {
    sld.addText(slide.subtitle, {
      x: 0.5, y: 3.6, w: 9, h: 0.5, fontSize: 15, color: 'AAAAAA', align: 'center', fontFace: 'Inter',
    });
  }
  return sld;
}

function addGenericSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  sld.addText(slide.title || slide.layout || '', {
    x: 0.5, y: 0.4, w: 9, h: 0.7, fontSize: 24, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  if (slide.body || slide.subtitle) {
    sld.addText(slide.body || slide.subtitle, {
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
export async function exportToPPTX(deck, { includeNotes = true } = {}) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = deck.title || 'Stagecraft Presentation';
  pptx.subject = deck.subtitle || '';
  pptx.author = deck.author || 'Stagecraft';

  const tc = themeColors(deck.theme);

  // Flatten slides in section order
  const flat = [];
  (deck.sections || []).forEach(sec => {
    sec.slides.forEach(sid => {
      const s = (deck.slides || []).find(x => x.id === sid);
      if (s) flat.push(s);
    });
  });

  for (const slide of flat) {
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
    // Each builder returns the slide it created, so notes attach at the call
    // boundary the dispatch already owns — no reaching into the pptx instance.
    if (includeNotes) {
      const n = resolveNotes(slide);
      if (n) sld.addNotes(n);
    }
  }

  const fileName = `${(deck.title || 'presentation').replace(/[^a-z0-9]/gi, '_')}.pptx`;
  await pptx.writeFile({ fileName });
  return fileName;
}
