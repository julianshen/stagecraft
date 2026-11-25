import { describe, expect, it } from 'vitest';
import {
  NATIVE_APPEARANCE_INPUT_MAX_BYTES,
  invalidateNativeLayoutAppearance,
  invalidateNativeObjectAppearance,
  invalidateNativeSlideAppearance,
  isNativeLayoutAppearanceValid,
  isNativeObjectAppearanceValid,
  isNativeSlideAppearanceValid,
  nativeLayoutAppearanceInput,
  nativeObjectAppearanceInput,
  nativeSlideAppearanceInput,
} from './nativeAppearance.js';

const resolvedRun = {
  color: '#112233',
  fontFamily: 'Arial',
  fontFamilyEastAsia: 'Yu Gothic',
  fontFamilyComplexScript: 'Amiri',
  fontSizePt: 18,
  bold: false,
  italic: true,
};

function nativeObject() {
  return {
    id: 'o1',
    type: 'text',
    source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: ['p:cSld', 'p:spTree', 0] },
    geometry: { x: 100, y: 200, width: 300, height: 400, rotation: 12 },
    bodyLayout: { insets: { left: 91440, top: 45720 }, wrap: 'square', anchor: 'top' },
    extensions: { pptxTextMetrics: { fontRef: 'minor', supported: true } },
    text: {
      paragraphs: [{
        id: 'p1',
        source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: ['a:txBody', 0] },
        style: { alignment: 'left', lineSpacing: 115 },
        runs: [{
          id: 'r1',
          text: 'Native text',
          editable: true,
          source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: ['a:txBody', 0, 0] },
          style: { sz: '1800', typeface: 'Arial', color: '#112233' },
          extensions: { pptxAppearance: { resolved: { ...resolvedRun } } },
        }],
      }],
    },
  };
}

function proveObject(object) {
  object.extensions.stagecraftNativeAppearance = {
    version: 1,
    sourceFormat: 'pptx',
    appearanceResolved: true,
    input: nativeObjectAppearanceInput(object),
    fill: { kind: 'none' },
    stroke: { kind: 'none' },
    text: {
      paragraphs: [{
        id: 'p1',
        runIds: ['r1'],
        alignment: 'left',
        spaceBeforePt: 0,
        spaceAfterPt: 0,
        lineSpacingPct: 115,
        indentStartEmu: 0,
        indentEndEmu: 0,
        firstLineIndentEmu: 0,
        endRun: { ...resolvedRun },
      }],
    },
  };
  return object;
}

describe('native appearance proof helpers', () => {
  it('excludes geometry and run text from the appearance input', () => {
    const object = nativeObject();
    const before = nativeObjectAppearanceInput(object);
    object.geometry = { x: 900, y: 800, width: 700, height: 600, rotation: 44 };
    object.text.paragraphs[0].runs[0].text = 'Edited text keeps the proof';
    expect(nativeObjectAppearanceInput(object)).toBe(before);

    object.text.paragraphs[0].runs[0].style.color = '#445566';
    expect(nativeObjectAppearanceInput(object)).not.toBe(before);
  });

  it('invalidates when run/paragraph id structure or body layout changes', () => {
    const object = nativeObject();
    const before = nativeObjectAppearanceInput(object);
    object.text.paragraphs[0].runs[0].id = 'r2';
    expect(nativeObjectAppearanceInput(object)).not.toBe(before);
    object.text.paragraphs[0].runs[0].id = 'r1';
    object.bodyLayout.insets.left = 0;
    expect(nativeObjectAppearanceInput(object)).not.toBe(before);
  });

  it('validates a complete object proof and rejects stale or partial proofs', () => {
    const object = proveObject(nativeObject());
    expect(isNativeObjectAppearanceValid(object)).toBe(true);

    object.geometry.x += 1;
    object.text.paragraphs[0].runs[0].text += ' edited';
    expect(isNativeObjectAppearanceValid(object)).toBe(true);

    object.text.paragraphs[0].runs[0].style.color = '#445566';
    expect(isNativeObjectAppearanceValid(object)).toBe(false);

    const partial = proveObject(nativeObject());
    delete partial.extensions.stagecraftNativeAppearance.text.paragraphs[0].endRun.fontFamily;
    expect(isNativeObjectAppearanceValid(partial)).toBe(false);
  });

  it('requires exact run ids and resolved run sidecars', () => {
    const object = proveObject(nativeObject());
    object.extensions.stagecraftNativeAppearance.text.paragraphs[0].runIds = ['missing'];
    expect(isNativeObjectAppearanceValid(object)).toBe(false);

    const sidecar = proveObject(nativeObject());
    sidecar.text.paragraphs[0].runs[0].extensions.pptxAppearance.resolved.fontSizePt = 0;
    expect(isNativeObjectAppearanceValid(sidecar)).toBe(false);
  });

  it('caps the serialized appearance input at 16 KiB', () => {
    const object = nativeObject();
    object.text.paragraphs[0].runs = Array.from({ length: 400 }, (_, index) => ({
      ...nativeObject().text.paragraphs[0].runs[0],
      id: `r-${index}`,
      style: { sz: '1800', typeface: 'Arial', color: '#112233', padding: 'x'.repeat(80) },
    }));
    expect(new TextEncoder().encode(nativeObjectAppearanceInput(object)).byteLength).toBeGreaterThan(NATIVE_APPEARANCE_INPUT_MAX_BYTES);
    proveObject(object);
    expect(isNativeObjectAppearanceValid(object)).toBe(false);
  });

  it('validates slide and layout summaries and invalidates them without touching other extensions', () => {
    const slide = {
      id: 's1',
      source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [] },
      background: { type: 'solid', color: '#ffffff' },
      layoutId: 'l1',
      extensions: { keep: true },
    };
    slide.extensions.stagecraftSlideAppearance = {
      version: 1,
      appearanceResolved: true,
      input: nativeSlideAppearanceInput(slide),
      background: { kind: 'solid', color: '#FFFFFF' },
      inheritedArtworkCount: 0,
    };
    expect(isNativeSlideAppearanceValid(slide)).toBe(true);
    slide.background.color = '#000000';
    expect(isNativeSlideAppearanceValid(slide)).toBe(false);
    invalidateNativeSlideAppearance(slide);
    expect(slide.extensions).toEqual({ keep: true });

    const layout = {
      id: 'l1',
      source: { format: 'pptx', part: 'ppt/slideLayouts/slideLayout1.xml', path: [] },
      masterId: 'm1',
      objects: [],
      extensions: { keep: true },
    };
    layout.extensions.stagecraftLayoutSummary = {
      version: 1,
      appearanceResolved: true,
      input: nativeLayoutAppearanceInput(layout),
      background: { kind: 'solid', color: '#FFFFFF' },
      artworkCount: 0,
    };
    expect(isNativeLayoutAppearanceValid(layout)).toBe(true);
    layout.objects.push({ id: 'art', type: 'shape' });
    expect(isNativeLayoutAppearanceValid(layout)).toBe(false);
    invalidateNativeLayoutAppearance(layout);
    expect(layout.extensions).toEqual({ keep: true });

    const object = proveObject(nativeObject());
    object.extensions.keep = true;
    invalidateNativeObjectAppearance(object);
    expect(object.extensions.keep).toBe(true);
    expect(object.extensions.stagecraftNativeAppearance).toBeUndefined();
  });
});
