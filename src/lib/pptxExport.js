import pptxgen from 'pptxgenjs';

// ---- theme colours (fallback to indigo) ----
const THEME_COLORS = {
  indigo:  { accent: '7C5FDC', bg: '0E0E1A', ink: 'FFFFFF' },
  amber:   { accent: 'D4A830', bg: '1A160A', ink: 'FFFFFF' },
  emerald: { accent: '2ECC71', bg: '0A1A10', ink: 'FFFFFF' },
  magenta: { accent: 'CC2E88', bg: '1A0A12', ink: 'FFFFFF' },
  coral:   { accent: 'E05C3A', bg: '1A0E0A', ink: 'FFFFFF' },
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
}

function addRisksSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  sld.addText(slide.title || '', {
    x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 22, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  const sevColor = { high: 'E74C3C', med: 'F39C12', low: '2ECC71' };
  const items = slide.items || [];
  items.forEach((it, i) => {
    const y = 1.1 + i * 1.3;
    sld.addText('●', { x: 0.5, y: y + 0.05, w: 0.4, h: 0.4, fontSize: 16, color: sevColor[it.sev] || 'AAAAAA' });
    sld.addText(it.t, { x: 1.0, y, w: 8.5, h: 0.45, fontSize: 15, bold: true, color: tc.ink, fontFace: 'Inter' });
    sld.addText(it.d, { x: 1.0, y: y + 0.45, w: 8.5, h: 0.5, fontSize: 12, color: 'AAAAAA', fontFace: 'Inter', wrap: true });
  });
}

function addRoadmapSlide(pptx, slide, tc) {
  const sld = pptx.addSlide();
  sld.background = { color: tc.bg };
  sld.addText(slide.title || 'Roadmap', {
    x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 22, bold: true, color: tc.ink, fontFace: 'Inter',
  });
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  quarters.forEach((q, i) => {
    const x = 0.5 + i * 2.3;
    sld.addText(q, { x, y: 1.0, w: 2, h: 0.4, fontSize: 12, color: tc.accent, fontFace: 'Courier New' });
    sld.addShape(pptx.ShapeType.rect, { x, y: 1.5, w: 2, h: 3.5, fill: { color: '1A1A2E' }, line: { color: '333355', width: 1 } });
  });
  sld.addText('Roadmap details coming soon', {
    x: 0.5, y: 3.2, w: 9, h: 0.4, fontSize: 12, color: '555577', align: 'center', fontFace: 'Inter',
  });
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
}

// ---- main export function ----
/**
 * Export a deck object to a .pptx file using pptxgenjs.
 * @param {Object} deck — SAMPLE_DECK-shaped object
 */
export async function exportToPPTX(deck) {
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
    switch (slide.layout) {
      case 'cover':    addCoverSlide(pptx, slide, tc);   break;
      case 'agenda':   addAgendaSlide(pptx, slide, tc);  break;
      case 'divider':  addDividerSlide(pptx, slide, tc); break;
      case 'kpi':      addKpiSlide(pptx, slide, tc);     break;
      case 'text':     addTextSlide(pptx, slide, tc);    break;
      case 'list':     addListSlide(pptx, slide, tc);    break;
      case 'table':    addTableSlide(pptx, slide, tc);   break;
      case 'split':    addSplitSlide(pptx, slide, tc);   break;
      case 'risks':    addRisksSlide(pptx, slide, tc);   break;
      case 'roadmap':  addRoadmapSlide(pptx, slide, tc); break;
      case 'thanks':   addThanksSlide(pptx, slide, tc);  break;
      case 'chart':    addGenericSlide(pptx, slide, tc); break;
      default:         addGenericSlide(pptx, slide, tc); break;
    }
  }

  const fileName = `${(deck.title || 'presentation').replace(/[^a-z0-9]/gi, '_')}.pptx`;
  await pptx.writeFile({ fileName });
  return fileName;
}
