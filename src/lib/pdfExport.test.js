import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// --- Mock the heavy, dynamically-imported deps at the module boundary (jsdom
// can't rasterize; per CLAUDE.md we never invoke real jsPDF/rasterizer output). ---
const addPage = vi.fn();
const addImage = vi.fn();
const save = vi.fn();
const jsPDFCtor = vi.fn(() => ({ addPage, addImage, save }));
vi.mock('jspdf', () => ({ jsPDF: jsPDFCtor }));

const domToPng = vi.fn(async (node) => {
  // record every node we were asked to rasterize (size + rendered slide id +
  // whether a ScaledSlide crept in) so tests can pin geometry, order, and the
  // full-resolution / non-scaled guarantee — not just call counts.
  domToPng.lastNode = node;
  domToPng.lastRect = { w: node.style.width, h: node.style.height };
  // ScaledSlide's signature is an inner `transform: scale(...)`; slide elements
  // only ever use rotate(), so any `scale(` here means a ScaledSlide wrapper crept
  // in. childElementCount>0 proves a real <Slide> painted (catches a broken render).
  const scaled = [...node.querySelectorAll('*')].some(
    (el) => (el.style?.transform || '').includes('scale('),
  );
  domToPng.captures.push({
    w: node.style.width,
    h: node.style.height,
    text: node.textContent,          // test slides use title===id, so text pins order
    hasScaleTransform: scaled,
    renderedChildren: node.childElementCount,
  });
  return 'data:image/png;base64,FAKE';
});
domToPng.captures = [];
vi.mock('modern-screenshot', () => ({ domToPng }));

import { exportToPDF } from './pdfExport.js';

const deck = (n, title = 'My Deck') => {
  const ids = Array.from({ length: n }, (_, i) => `s${i}`);
  return {
    title,
    slides: ids.map((id) => ({ id, layout: 'text', title: id, body: 'x' })),
    sections: [{ id: 'sec', name: 'Sec', slides: ids }],
  };
};

describe('exportToPDF', () => {
  beforeEach(() => {
    addPage.mockClear(); addImage.mockClear(); save.mockClear();
    jsPDFCtor.mockClear(); domToPng.mockClear(); domToPng.captures = [];
    // jsdom lacks a real fonts registry; give it a resolved one.
    if (!document.fonts) document.fonts = { ready: Promise.resolve() };
    else document.fonts.ready = Promise.resolve();
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('assembles one page per slide in flattenDeck order and saves a .pdf [AC-1.1]', async () => {
    await exportToPDF(deck(3));
    // 3 slides → 1 initial page + 2 addPage calls; one image per slide.
    expect(jsPDFCtor).toHaveBeenCalledTimes(1);
    expect(addPage).toHaveBeenCalledTimes(2);
    expect(addImage).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatch(/\.pdf$/);
    expect(save.mock.calls[0][0]).toContain('My Deck');
    // pages follow flattenDeck order — the captured slides render s0, s1, s2 in turn
    expect(domToPng.captures.map((c) => c.text.includes('s0') ? 0 : c.text.includes('s1') ? 1 : 2))
      .toEqual([0, 1, 2]);
  });

  it('pins page geometry: landscape 1920x1080, full-bleed image, addPage per extra slide [AC-1.1]', async () => {
    await exportToPDF(deck(2));
    expect(jsPDFCtor).toHaveBeenCalledWith(expect.objectContaining({
      orientation: 'landscape', unit: 'px', format: [1920, 1080],
    }));
    expect(addPage).toHaveBeenCalledWith([1920, 1080], 'landscape'); // the 2nd slide's page
    // every image is placed full-bleed at the page origin
    for (const call of addImage.mock.calls) {
      expect(call.slice(1)).toEqual(['PNG', 0, 0, 1920, 1080]);
    }
  });

  it('a single-slide deck makes no addPage (uses the initial page) [AC-1.1]', async () => {
    await exportToPDF(deck(1));
    expect(addImage).toHaveBeenCalledTimes(1);
    expect(addPage).not.toHaveBeenCalled();
  });

  it('slices to the inclusive 1-indexed range; null range exports all [AC-1.2]', async () => {
    await exportToPDF(deck(5), { range: { from: 2, to: 4 } });
    expect(addImage).toHaveBeenCalledTimes(3);      // slides 2,3,4
    expect(addPage).toHaveBeenCalledTimes(2);
    addImage.mockClear(); addPage.mockClear();
    await exportToPDF(deck(5));                      // null range → all 5
    expect(addImage).toHaveBeenCalledTimes(5);
  });

  it('awaits document.fonts.ready and rasterizes a raw 1920x1080 node (not ScaledSlide) [AC-1.3]', async () => {
    let fontsResolved = false;
    document.fonts.ready = new Promise((r) => setTimeout(() => { fontsResolved = true; r(); }, 5));
    await exportToPDF(deck(1));
    expect(fontsResolved).toBe(true);               // capture happened AFTER fonts.ready
    const cap = domToPng.captures[0];
    expect({ w: cap.w, h: cap.h }).toEqual({ w: '1920px', h: '1080px' }); // full-res host
    expect(cap.renderedChildren).toBeGreaterThan(0);   // a real <Slide> actually painted
    expect(cap.hasScaleTransform).toBe(false);         // NOT wrapped in a scale()'d ScaledSlide
    expect(domToPng).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: 1920, height: 1080 }));
  });

  it('completes even when document.fonts is absent (optional-chaining branch) [AC-1.3]', async () => {
    const saved = document.fonts;
    delete document.fonts;                          // e.g. a jsdom/older environment
    try {
      await exportToPDF(deck(1));
      expect(save).toHaveBeenCalledTimes(1);        // no throw; export still completes
    } finally { document.fonts = saved; }
  });

  it('dynamically imports jspdf + modern-screenshot (no eager import) [AC-1.4]', () => {
    const src = readFileSync('src/lib/pdfExport.js', 'utf8'); // vitest cwd = project root
    expect(src).toMatch(/import\(\s*['"]jspdf['"]\s*\)/);
    expect(src).toMatch(/import\(\s*['"]modern-screenshot['"]\s*\)/);
    // no top-level static import of the heavy deps
    expect(src).not.toMatch(/^\s*import\s+.*from\s+['"]jspdf['"]/m);
    expect(src).not.toMatch(/^\s*import\s+.*from\s+['"]modern-screenshot['"]/m);
  });

  it('exports nothing (no jsPDF, no save) when the range selects zero slides [AC-1.2]', async () => {
    await exportToPDF(deck(3), { range: { from: 5, to: 6 } }); // out of range → empty slice
    expect(jsPDFCtor).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('exports nothing for a 0-slide deck, and for a reversed range [AC-1.2]', async () => {
    await exportToPDF(deck(0));                       // genuinely empty deck
    expect(jsPDFCtor).not.toHaveBeenCalled();
    await exportToPDF(deck(3), { range: { from: 4, to: 2 } }); // from>to at the lib boundary
    expect(jsPDFCtor).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects (does not silently resolve) when the rasterizer fails [AC-1.5]', async () => {
    domToPng.mockRejectedValueOnce(new Error('raster boom'));
    await expect(exportToPDF(deck(1))).rejects.toThrow(/raster boom/);
    expect(save).not.toHaveBeenCalled();
  });

  it('tears down every off-screen host — no leak — when a mid-loop raster fails [AC-1.5]', async () => {
    const before = document.body.childElementCount;
    domToPng
      .mockResolvedValueOnce('data:image/png;base64,OK')  // slide 1 ok
      .mockRejectedValueOnce(new Error('boom on slide 2')); // slide 2 fails
    await expect(exportToPDF(deck(3))).rejects.toThrow(/boom on slide 2/);
    expect(document.body.childElementCount).toBe(before); // the finally block removed both hosts
  });

  it('sanitises the deck title into a safe filename; empty title → deck.pdf [filename]', async () => {
    await exportToPDF(deck(1, 'Q3/Board\nReview'));   // path sep + control char
    expect(save.mock.calls[0][0]).toBe('Q3-Board Review.pdf');
    save.mockClear();
    await exportToPDF(deck(1, ''));                   // no title → fallback
    expect(save.mock.calls[0][0]).toBe('deck.pdf');
  });
});
