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
  // record the node we were asked to rasterize so the test can inspect its size
  domToPng.lastNode = node;
  domToPng.lastRect = { w: node.style.width, h: node.style.height };
  return 'data:image/png;base64,FAKE';
});
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
    jsPDFCtor.mockClear(); domToPng.mockClear();
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
    // the rasterized host is exactly 1920x1080 and is NOT a .scaled-slide wrapper
    expect(domToPng.lastRect).toEqual({ w: '1920px', h: '1080px' });
    expect(domToPng.lastNode.className || '').not.toContain('scaled');
    expect(domToPng).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: 1920, height: 1080 }));
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

  it('rejects (does not silently resolve) when the rasterizer fails [AC-1.5]', async () => {
    domToPng.mockRejectedValueOnce(new Error('raster boom'));
    await expect(exportToPDF(deck(1))).rejects.toThrow(/raster boom/);
    expect(save).not.toHaveBeenCalled();
  });
});
