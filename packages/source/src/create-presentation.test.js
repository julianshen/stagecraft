import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { validateDocument } from '@stagecraft/core/document';
import { writePptx } from '@stagecraft/pptx';
import { writeOdp } from '@stagecraft/odp';
import { buildCanonicalScene } from '@stagecraft/renderer/canonical';
import { createPresentation, openPresentation } from './index.js';
import { withoutDisplayProof } from './authoring.js';

const legacyDeck = {
  title: 'Custom Parity Deck',
  sections: [{ id: 'section', name: 'Slides', slides: ['slide'] }],
  slides: [{ id: 'slide', layout: 'blank', elements: [] }],
};

describe('createPresentation', () => {
  it.each(['pptx', 'odp'])('matches legacy New %s parity and round-trips through export and reopen', async format => {
    const legacyBytes = await (format === 'pptx' ? writePptx(legacyDeck) : writeOdp(legacyDeck));
    const legacySession = await openPresentation(legacyBytes, { format });
    const createdSession = await createPresentation({ format, title: 'Custom Parity Deck' });

    try {
      const legacyDoc = legacySession.document;
      const createdDoc = createdSession.document;

      expect(() => validateDocument(createdDoc)).not.toThrow();
      expect(createdDoc.size).toEqual(legacyDoc.size);
      expect(createdDoc.slides).toHaveLength(legacyDoc.slides.length);
      expect(createdDoc.slides[0].name).toBe(legacyDoc.slides[0].name);
      expect(createdDoc.slides[0].objects).toEqual([]);
      expect(createdDoc.slides[0].notes).toBeUndefined();
      expect(createdDoc.masters.map(m => ({ objs: m.objects?.length ?? 0, bg: m.background, ext: withoutDisplayProof(m.extensions) })))
        .toEqual(legacyDoc.masters.map(m => ({ objs: m.objects?.length ?? 0, bg: m.background, ext: withoutDisplayProof(m.extensions) })));
      expect(createdDoc.layouts.map(l => ({ objs: l.objects?.length ?? 0, bg: l.background, ext: withoutDisplayProof(l.extensions) })))
        .toEqual(legacyDoc.layouts.map(l => ({ objs: l.objects?.length ?? 0, bg: l.background, ext: withoutDisplayProof(l.extensions) })));
      expect(createdDoc.themes.map(t => ({
        major: t.extensions?.pptxFontScheme?.major,
        minor: t.extensions?.pptxFontScheme?.minor,
        objDefaults: t.extensions?.pptxObjectDefaults,
      }))).toEqual(legacyDoc.themes.map(t => ({
        major: t.extensions?.pptxFontScheme?.major,
        minor: t.extensions?.pptxFontScheme?.minor,
        objDefaults: t.extensions?.pptxObjectDefaults,
      })));
      expect(withoutDisplayProof(createdDoc.extensions)).toEqual(withoutDisplayProof(legacyDoc.extensions));
      expect(createdSession.capabilities).toEqual(legacySession.capabilities);
      expect(createdSession.diagnostics).toEqual(legacySession.diagnostics);

      if (format === 'pptx') {
        expect(createdDoc.slides[0].background).toBeUndefined();
        const nativeBlankScene = buildCanonicalScene(createdDoc, createdDoc.slides[0].id);
        expect(nativeBlankScene.status).toBe('ready');
        expect(nativeBlankScene.scene.background).toBe('#FFFFFF');

        // Blank slide + Use a white background becomes eligible for K2b canvas view
        const withBlankSlide = structuredClone(createdDoc);
        withBlankSlide.slides.push({
          id: 'blank-2',
          extensions: { stagecraftAuthored: true },
          background: { type: 'solid', color: '#ffffff' },
          objects: [],
        });
        expect(buildCanonicalScene(withBlankSlide, 'blank-2').status).toBe('ready');
      }

      // Untouched exact export + reopen
      const untouchedLegacy = await legacySession.export(legacyDoc);
      const untouchedCreated = await createdSession.export(createdDoc);
      expect(untouchedLegacy.dirtyParts).toEqual([]);
      expect(untouchedCreated.dirtyParts).toEqual([]);
      const reopenedUntouched = await openPresentation(untouchedCreated.bytes, { format });
      try {
        expect(reopenedUntouched.document.slides).toHaveLength(1);
        expect(reopenedUntouched.document.size).toEqual(createdDoc.size);
      } finally {
        reopenedUntouched.dispose();
      }

      // Edited export (add slide) + reopen
      const editedDoc = structuredClone(createdDoc);
      editedDoc.slides.push({
        id: 'slide-2',
        name: 'Slide 2',
        ...(format === 'pptx' ? { background: { type: 'solid', color: '#ffffff' } } : {}),
        extensions: { stagecraftAuthored: true },
        objects: [],
      });
      const exportedEdited = await createdSession.export(editedDoc);
      const reopenedEdited = await openPresentation(exportedEdited.bytes, { format });
      try {
        expect(reopenedEdited.document.slides).toHaveLength(2);
      } finally {
        reopenedEdited.dispose();
      }
    } finally {
      legacySession.dispose();
      createdSession.dispose();
    }
  });

  it('omits personal metadata from PPTX core.xml and honors AbortSignal and invalid format', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createPresentation({ format: 'pptx', signal: controller.signal })).rejects.toThrow();
    await expect(createPresentation({ format: 'pdf' })).rejects.toThrow();

    // Deferred abort during async ZIP generation
    const deferredController = new AbortController();
    const pending = createPresentation({ format: 'pptx', signal: deferredController.signal });
    deferredController.abort();
    await expect(pending).rejects.toThrow();

    const session = await createPresentation({ format: 'pptx', title: 'Untitled' });
    try {
      const exported = await session.export(session.document);
      const zip = await JSZip.loadAsync(exported.bytes);
      const coreXml = await zip.file('docProps/core.xml')?.async('string');
      expect(coreXml).toBeTruthy();
      expect(coreXml).toContain('<dc:title>Untitled</dc:title>');
      expect(coreXml).toContain('<dc:creator>Stagecraft</dc:creator>');
    } finally {
      session.dispose();
    }
  });

  it('includes a complete ECMA-376 fmtScheme (>=3 entries per list) matching legacy theme1.xml', async () => {
    const legacyBytes = await writePptx(legacyDeck);
    const legacyZip = await JSZip.loadAsync(legacyBytes);
    const legacyTheme = new DOMParser().parseFromString(await legacyZip.file('ppt/theme/theme1.xml').async('string'), 'application/xml');

    const session = await createPresentation({ format: 'pptx', title: 'Custom Parity Deck' });
    try {
      const exported = await session.export(session.document);
      const createdZip = await JSZip.loadAsync(exported.bytes);
      const createdTheme = new DOMParser().parseFromString(await createdZip.file('ppt/theme/theme1.xml').async('string'), 'application/xml');

      for (const listTag of ['fillStyleLst', 'lnStyleLst', 'effectStyleLst', 'bgFillStyleLst']) {
        const listEl = createdTheme.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', listTag)[0];
        expect(listEl, `${listTag} missing`).toBeTruthy();
        expect(listEl.children.length).toBeGreaterThanOrEqual(3);
      }

      const normalize = doc => new XMLSerializer().serializeToString(doc).replace(/>\s+</g, '><').trim();
      expect(normalize(createdTheme)).toBe(normalize(legacyTheme));
    } finally {
      session.dispose();
    }
  });

  it.each(['pptx', 'odp'])('preserves a custom title in %s through create -> export -> reopen', async format => {
    const title = 'Quarterly Review & Plan';
    const session = await createPresentation({ format, title });
    try {
      const exported = await session.export(session.document);
      const zip = await JSZip.loadAsync(exported.bytes);
      if (format === 'pptx') {
        const coreXml = await zip.file('docProps/core.xml')?.async('string');
        expect(coreXml).toContain('<dc:title>Quarterly Review &amp; Plan</dc:title>');
      } else {
        const manifestXml = await zip.file('META-INF/manifest.xml')?.async('string');
        expect(manifestXml).toContain('manifest:full-path="meta.xml"');
        const metaXml = await zip.file('meta.xml')?.async('string');
        expect(metaXml).toContain('<dc:title>Quarterly Review &amp; Plan</dc:title>');
      }
      const reopened = await openPresentation(exported.bytes, { format });
      try {
        expect(reopened.document.slides).toHaveLength(1);
        const reExported = await reopened.export(reopened.document);
        const reZip = await JSZip.loadAsync(reExported.bytes);
        if (format === 'pptx') {
          expect(await reZip.file('docProps/core.xml')?.async('string')).toContain('<dc:title>Quarterly Review &amp; Plan</dc:title>');
        } else {
          expect(await reZip.file('meta.xml')?.async('string')).toContain('<dc:title>Quarterly Review &amp; Plan</dc:title>');
        }
      } finally {
        reopened.dispose();
      }
    } finally {
      session.dispose();
    }
  });
});
