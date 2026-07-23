import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { flattenDeck } from './deckOrder.js';
import { Slide } from '../components/slides/SlideRenderer.jsx';

// Slides are authored in a fixed 1920×1080 coordinate space; a PDF page is that,
// full-bleed and 16:9. We capture the RAW slide node at this size — never the
// ScaledSlide (which applies transform: scale()) — so the raster is full-res.
const PAGE_W = 1920;
const PAGE_H = 1080;

/**
 * Export a deck to a multi-page PDF, one 16:9 page per slide, entirely
 * client-side (mirrors `exportToPPTX`'s contract, minus notes — a PDF is a
 * visual artifact).
 *
 * Rendering fidelity: each slide is rendered off-screen at true 1920×1080 and
 * rasterized via `modern-screenshot` (SVG `<foreignObject>` → the browser's own
 * paint engine), so gradients / clip-path shapes / drop-shadows / inline SVG
 * reproduce natively — the reason this beats html2canvas for this content.
 *
 * The heavy deps (`jspdf`, `modern-screenshot`) are **dynamically imported** so
 * they stay out of the eager bundle and only load when a PDF export runs
 * (`pptxgenjs` is eagerly imported and is the >500KB chunk the build warns about
 * — we deliberately do not repeat that here).
 *
 * @param {object} deck
 * @param {{ range?: { from: number, to: number } | null }} [opts]
 *   `range` is inclusive and 1-indexed over the flattened slide order.
 * @returns {Promise<void>} resolves after the download is triggered; rejects if
 *   rendering/rasterization/assembly fails (never resolves on a silent failure).
 */
export async function exportToPDF(deck, { range = null } = {}) {
  let slides = flattenDeck(deck);
  if (range) slides = slides.slice(range.from - 1, range.to); // inclusive, 1-indexed
  if (!slides.length) return;

  // Fonts must be loaded before capture or the raster falls back to system
  // fonts — the #1 fidelity gotcha of DOM rasterization.
  await document.fonts?.ready;

  const [{ jsPDF }, { domToPng }] = await Promise.all([
    import('jspdf'),
    import('modern-screenshot'),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [PAGE_W, PAGE_H] });

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    // Off-screen but in-document (fonts/layout/SVG only resolve for an attached
    // node), sized to the true slide dimensions.
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-99999px;top:0;width:${PAGE_W}px;height:${PAGE_H}px;`;
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      flushSync(() => {
        root.render(createElement(Slide, {
          slide,
          deck,
          sectionName: slide.sectionName,
          num: i + 1,
          total: slides.length,
        }));
      });
      const dataUrl = await domToPng(host, { width: PAGE_W, height: PAGE_H });
      if (i > 0) doc.addPage([PAGE_W, PAGE_H], 'landscape');
      doc.addImage(dataUrl, 'PNG', 0, 0, PAGE_W, PAGE_H);
    } finally {
      root.unmount();
      host.remove();
    }
  }

  doc.save(`${deck?.title || 'deck'}.pdf`);
}
