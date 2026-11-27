import { describe, expect, it } from 'vitest';
import {
  NATIVE_APPEARANCE_INPUT_MAX_BYTES,
  invalidateNativeLayoutAppearance,
  invalidateNativeObjectAppearance,
  invalidateNativeSlideAppearance,
  isNativeLayoutAppearanceValid,
  isNativeObjectAppearanceValid,
  isNativeSlideAppearanceValid,
  nativeAppearanceContext,
  nativeAutofitEffectiveFit,
  nativeAutofitFitValues,
  nativeLayoutAppearanceInput,
  nativeObjectAppearanceInput,
  nativeSlideAppearanceInput,
  nativeTextFontSlots,
  nativeTextScript,
  nativeTextScripts,
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
        extensions: { pptxEndRunAppearance: { ...resolvedRun } },
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

const completeFit = { fontScale: 77500, lnSpcReduction: 20000 };

function autofitObject(autofit, fit) {
  const object = nativeObject();
  if (autofit !== undefined) object.bodyLayout.autofit = autofit;
  if (fit !== undefined) object.bodyLayout.fit = fit;
  return object;
}

function shrinkObject(fit = completeFit) {
  return autofitObject('shrink', fit);
}

describe('native autofit appearance proofs', () => {
  it.each(['shrink', 'resize'])('binds %s input to text, width, and height but not position or rotation', autofit => {
    const object = autofitObject(autofit, autofit === 'shrink' ? completeFit : undefined);
    const before = nativeObjectAppearanceInput(object);
    for (const mutate of [
      value => { value.text.paragraphs[0].runs[0].text = 'Edited autofit text'; },
      value => { value.geometry.width += 1; },
      value => { value.geometry.height += 1; },
    ]) {
      const changed = structuredClone(object);
      mutate(changed);
      expect(nativeObjectAppearanceInput(changed)).not.toBe(before);
    }
    for (const mutate of [
      value => { value.geometry.x += 1; },
      value => { value.geometry.y += 1; },
      value => { value.geometry.rotation += 1; },
    ]) {
      const changed = structuredClone(object);
      mutate(changed);
      expect(nativeObjectAppearanceInput(changed)).toBe(before);
    }
  });

  it('keeps partial stored fit distinct from policy-approved effective fit', () => {
    const partial = shrinkObject({ fontScale: 77500 });
    const partialInput = JSON.parse(nativeObjectAppearanceInput(partial));
    expect(partialInput.bodyLayout.fit).toEqual({ fontScale: 77500 });
    expect(partialInput).not.toHaveProperty('effectiveFit');
    expect(partialInput.fitBinding).toMatch(/^[0-9a-f]{8}$/);

    const complete = shrinkObject();
    const completeInput = JSON.parse(nativeObjectAppearanceInput(complete));
    expect(completeInput.bodyLayout.fit).toEqual(completeFit);
    expect(completeInput.effectiveFit).toEqual(completeFit);

    const absent = autofitObject('shrink');
    const explicitDefaults = shrinkObject({ fontScale: 100000, lnSpcReduction: 0 });
    expect(JSON.parse(nativeObjectAppearanceInput(absent)).bodyLayout).not.toHaveProperty('fit');
    expect(JSON.parse(nativeObjectAppearanceInput(explicitDefaults)).effectiveFit)
      .toEqual({ fontScale: 100000, lnSpcReduction: 0 });
    expect(nativeObjectAppearanceInput(absent)).not.toBe(nativeObjectAppearanceInput(explicitDefaults));
  });

  it('does not let callers override the internal schema-default policy', () => {
    const object = autofitObject('shrink');
    expect(nativeAutofitEffectiveFit(object, true)).toBeNull();
  });

  it.each([
    ['absent fit', undefined, { fontScale: 100000, lnSpcReduction: 0 }],
    ['empty fit', {}, { fontScale: 100000, lnSpcReduction: 0 }],
    ['fontScale-only fit', { fontScale: 77500 }, { fontScale: 77500, lnSpcReduction: 0 }],
    ['reduction-only fit', { lnSpcReduction: 20000 }, { fontScale: 100000, lnSpcReduction: 20000 }],
    ['complete fit', completeFit, completeFit],
  ])('resolves schema defaults purely for %s', (_name, fit, expected) => {
    const object = autofitObject('shrink', fit);
    expect(nativeAutofitFitValues(fit)).toEqual(expected);
    expect(nativeAutofitEffectiveFit(object))
      .toEqual(fit === completeFit ? completeFit : null);
  });

  it('never resolves effective fit for resize or non-autofit layouts', () => {
    for (const object of [autofitObject('resize', completeFit), autofitObject('none', completeFit), nativeObject()]) {
      expect(nativeAutofitEffectiveFit(object)).toBeNull();
    }
  });

  it.each([
    ['absent fit', undefined],
    ['empty fit', {}],
    ['fontScale-only fit', { fontScale: 77500 }],
    ['reduction-only fit', { lnSpcReduction: 20000 }],
  ])('refuses %s under the strict module policy', (_name, fit) => {
    const object = proveObject(autofitObject('shrink', fit));
    expect(isNativeObjectAppearanceValid(object)).toBe(false);
  });

  it('exercises fit validation independently with valid matching-input controls', () => {
    for (const fit of [completeFit, { fontScale: 1, lnSpcReduction: 0 }, { fontScale: 100000, lnSpcReduction: 100000 }]) {
      const object = proveObject(shrinkObject(fit));
      object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object);
      expect(isNativeObjectAppearanceValid(object)).toBe(true);
    }
  });

  it.each([
    ['null fit', null],
    ['array fit', []],
    ['string fit', '77500'],
    ['extra fit key', { ...completeFit, extra: true }],
    ['zero fontScale', { ...completeFit, fontScale: 0 }],
    ['negative fontScale', { ...completeFit, fontScale: -1 }],
    ['oversized fontScale', { ...completeFit, fontScale: 100001 }],
    ['fractional fontScale', { ...completeFit, fontScale: 77500.5 }],
    ['unsafe fontScale', { ...completeFit, fontScale: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-finite fontScale', { ...completeFit, fontScale: Infinity }],
    ['string fontScale', { ...completeFit, fontScale: '77500' }],
    ['undefined fontScale', { fontScale: undefined, lnSpcReduction: 20000 }],
    ['negative reduction', { ...completeFit, lnSpcReduction: -1 }],
    ['oversized reduction', { ...completeFit, lnSpcReduction: 100001 }],
    ['fractional reduction', { ...completeFit, lnSpcReduction: 1.5 }],
    ['unsafe reduction', { ...completeFit, lnSpcReduction: Number.MAX_SAFE_INTEGER + 1 }],
    ['NaN reduction', { ...completeFit, lnSpcReduction: NaN }],
    ['string reduction', { ...completeFit, lnSpcReduction: '20000' }],
    ['undefined reduction', { fontScale: 77500, lnSpcReduction: undefined }],
  ])('rejects malformed stored fit even with a rebuilt matching input: %s', (_name, fit) => {
    const object = proveObject(shrinkObject(fit));
    object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object);
    expect(isNativeObjectAppearanceValid(object)).toBe(false);
    expect(nativeAutofitFitValues(fit)).toBeNull();
    expect(nativeAutofitEffectiveFit(object)).toBeNull();
  });

  it('rejects stored fit on resize and non-autofit objects with matching inputs', () => {
    for (const autofit of ['resize', 'none', undefined]) {
      const object = proveObject(autofitObject(autofit, completeFit));
      object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object);
      expect(isNativeObjectAppearanceValid(object)).toBe(false);
    }
    for (const autofit of ['resize', 'none', undefined]) {
      const object = proveObject(autofitObject(autofit));
      object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object);
      expect(isNativeObjectAppearanceValid(object)).toBe(true);
    }
  });

  it('rejects proof inputs with a missing or forged fit binding', () => {
    const object = proveObject(shrinkObject());
    const proof = object.extensions.stagecraftNativeAppearance;
    const input = JSON.parse(proof.input);
    expect(input.fitBinding).toMatch(/^[0-9a-f]{8}$/);

    const missing = structuredClone(input);
    delete missing.fitBinding;
    proof.input = JSON.stringify(missing);
    expect(isNativeObjectAppearanceValid(object)).toBe(false);

    proof.input = JSON.stringify({ ...input, fitBinding: input.fitBinding === '00000000' ? '00000001' : '00000000' });
    expect(isNativeObjectAppearanceValid(object)).toBe(false);
  });

  it('hashes large text into a fixed-size binding without inflating the capped input', () => {
    const object = shrinkObject();
    const before = nativeObjectAppearanceInput(object);
    object.text.paragraphs[0].runs[0].text = `autofit-text-marker-${'x'.repeat(64 * 1024)}`;
    const input = nativeObjectAppearanceInput(object);
    expect(input).not.toBe(before);
    expect(input).not.toContain('autofit-text-marker-');
    expect(JSON.parse(input).fitBinding).toMatch(/^[0-9a-f]{8}$/);
    expect(new TextEncoder().encode(input).byteLength).toBeLessThanOrEqual(NATIVE_APPEARANCE_INPUT_MAX_BYTES);
    proveObject(object);
    expect(isNativeObjectAppearanceValid(object)).toBe(true);
  });

  it.each(['shrink', 'resize'])('makes %s proofs stale after direct text or size mutation', autofit => {
    for (const mutate of [
      value => { value.text.paragraphs[0].runs[0].text += ' edited'; },
      value => { value.geometry.width += 1; },
      value => { value.geometry.height += 1; },
    ]) {
      const object = proveObject(autofitObject(autofit, autofit === 'shrink' ? completeFit : undefined));
      expect(isNativeObjectAppearanceValid(object)).toBe(true);
      mutate(object);
      expect(isNativeObjectAppearanceValid(object)).toBe(false);
    }
  });
});

describe('native appearance proof helpers', () => {
  it('shares source theme and colour-map traversal semantics', () => {
    const theme = { id: 'theme', extensions: {} };
    const master = { id: 'master', themeId: 'theme', extensions: { pptxColorMap: { tx1: 'lt1', bg1: 'dk1' } } };
    const layout = { id: 'layout', masterId: 'master', extensions: { pptxColorMap: { tx1: 'dk1' } } };
    const slide = { id: 'slide', layoutId: 'layout', extensions: { pptxColorMap: { bg1: 'lt1' } } };
    const document = { themes: [theme], masters: [master], layouts: [layout] };
    expect(nativeAppearanceContext(document, slide)).toEqual({
      theme,
      colorMap: { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' },
    });
    expect(nativeAppearanceContext(document, { id: 'direct', themeId: 'theme' }).theme).toBe(theme);

    slide.extensions.pptxColorMapOverride = 'master';
    expect(nativeAppearanceContext(document, slide).colorMap).toEqual({ bg1: 'dk1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' });
    slide.extensions.pptxColorMapOverride = 'mapping';
    slide.extensions.pptxColorMap.bg1 = 'dk1';
    expect(nativeAppearanceContext(document, slide).colorMap.bg1).toBe('dk1');
    slide.extensions.pptxColorMapOverride = 'unsupported';
    expect(nativeAppearanceContext(document, slide).colorMap).toBeNull();

    slide.extensions = { pptxThemeOverride: true };
    expect(nativeAppearanceContext(document, slide).theme).toBeNull();
    expect(nativeAppearanceContext(document, { id: 'missing', themeId: 'missing' }).theme).toBeNull();
    expect(nativeAppearanceContext({ ...document, themes: [] }, master).theme).toBeNull();
    expect(nativeAppearanceContext(document, { id: 'cycle-a', layoutId: 'cycle-b' })).toBeDefined();
  });

  it('uses the layout override with slide masterClrMapping (CLRMAP-NATIVE-codex.md)', () => {
    const theme = { id: 'theme', extensions: {} };
    const master = { id: 'master', themeId: 'theme', extensions: { pptxColorMap: { bg1: 'lt1' } } };
    const layout = { id: 'layout', masterId: 'master', extensions: { pptxColorMapOverride: 'mapping', pptxColorMap: { bg1: 'dk1' } } };
    const slide = { id: 'slide', layoutId: 'layout', extensions: { pptxColorMapOverride: 'master' } };
    const document = { themes: [theme], masters: [master], layouts: [layout] };
    expect(nativeAppearanceContext(document, slide).colorMap).toEqual({ bg1: 'dk1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' });
  });

  it('detects unsupported letters mixed with known scripts', () => {
    expect(nativeTextScripts('Привет𐍈')).toEqual(['Cyrl', 'Other']);
    expect(nativeTextScript('Привет𐍈')).toBe('Cyrl+Other');
    expect(nativeTextScripts('123 !')).toEqual(['Latn']);
    expect(nativeTextScripts('Native😀')).toEqual(['Latn', 'Other']);
    expect(nativeTextScripts('١٢٣')).toEqual(['Arab']);
    expect(nativeTextScripts('Native١٢٣')).toEqual(['Arab', 'Latn']);
    expect(nativeTextScripts('1️⃣')).toEqual(['Other']);
  });

  it.each([
    ['digits', '123', ['latin']],
    ['CJK punctuation', '漢、', ['eastAsian', 'latin']],
    ['CJK trailing spaces', '漢字  ', ['eastAsian']],
    ['Latin and spaces', 'A B', ['latin']],
    ['Arabic', 'مرحبا', ['complexScript']],
    ['Han plus digits', '漢字123', ['eastAsian', 'latin']],
  ])('computes painter font slots for %s', (_label, text, expected) => {
    expect(nativeTextFontSlots(text)).toEqual(expected);
  });

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

  it.each([
    ['negative spacing', p => { p.spaceBeforePt = -1; }],
    ['non-finite spacing', p => { p.lineSpacingPct = Infinity; }],
    ['fractional indent', p => { p.indentStartEmu = 1.5; }],
    ['oversized indent', p => { p.firstLineIndentEmu = 10000001; }],
    ['invalid alignment', p => { p.alignment = 'justify'; }],
    ['wrong run count', p => { p.runIds = []; }],
    ['invalid end run', p => { p.endRun.bold = 'yes'; }],
  ])('rejects invalid paragraph proof metrics: %s', (_name, mutate) => {
    const object = proveObject(nativeObject());
    mutate(object.extensions.stagecraftNativeAppearance.text.paragraphs[0]);
    expect(isNativeObjectAppearanceValid(object)).toBe(false);
  });

  it.each([
    ['non-integer adjustment', -1],
    ['oversized adjustment', 50001],
  ])('rejects invalid roundRect adjustments: %s', (_name, adj) => {
    const object = proveObject(nativeObject());
    object.type = 'shape';
    object.shape = 'roundRect';
    delete object.text;
    object.extensions.stagecraftNativeAppearance.text = undefined;
    object.extensions.stagecraftNativeAppearance.adjust = { adj };
    object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object);
    expect(isNativeObjectAppearanceValid(object)).toBe(false);
  });

  it('rejects invalid native object types and shape/text combinations', () => {
    const invalidType = proveObject(nativeObject());
    invalidType.type = 'image';
    expect(isNativeObjectAppearanceValid(invalidType)).toBe(false);

    const invalidShape = proveObject(nativeObject());
    invalidShape.type = 'shape';
    invalidShape.shape = 'star5';
    expect(isNativeObjectAppearanceValid(invalidShape)).toBe(false);

    const invalidTextShape = proveObject(nativeObject());
    invalidTextShape.shape = 'ellipse';
    expect(isNativeObjectAppearanceValid(invalidTextShape)).toBe(false);

    const missingTextProof = proveObject(nativeObject());
    delete missingTextProof.extensions.stagecraftNativeAppearance.text;
    expect(isNativeObjectAppearanceValid(missingTextProof)).toBe(false);
  });

  it('handles absent inheritance and optional canonical style defaults', () => {
    const slide = { id: 's1', source: { format: 'pptx' }, extensions: {} };
    const input = nativeSlideAppearanceInput(slide, { layouts: [], masters: [], themes: [] });
    expect(input).toContain('"layout":null');
    expect(input).toContain('"master":null');

    const object = proveObject(nativeObject());
    object.text.paragraphs[0].style = undefined;
    object.extensions.stagecraftNativeAppearance.text.paragraphs[0].alignment = 'left';
    object.extensions.stagecraftNativeAppearance.text.paragraphs[0].lineSpacingPct = 100;
    object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object);
    expect(isNativeObjectAppearanceValid(object)).toBe(true);

    const layout = { id: 'l1', source: { format: 'pptx' }, extensions: {} };
    layout.extensions.stagecraftLayoutSummary = {
      version: 1, appearanceResolved: true, input: nativeLayoutAppearanceInput(layout),
      background: { kind: 'solid', color: '#FFFFFF' }, artworkCount: 0,
    };
    expect(isNativeLayoutAppearanceValid(layout)).toBe(true);
  });

  it('binds proof inputs to colour-map override state and supplemental fonts', () => {
    const slide = { id: 's1', source: { format: 'pptx' }, layoutId: 'l1', extensions: {} };
    const document = {
      layouts: [{ id: 'l1', masterId: 'm1', objects: [], extensions: { pptxColorMap: { tx1: 'dk1' } } }],
      masters: [{ id: 'm1', objects: [], extensions: { pptxColorMap: { tx1: 'lt1' } } }],
      themes: [{ id: 't1', extensions: { pptxFontScheme: { minor: { latin: 'Arial', supplemental: {} } } } }],
    };
    slide.extensions.stagecraftSlideAppearance = {
      version: 1, appearanceResolved: true, input: nativeSlideAppearanceInput(slide, document),
      background: { kind: 'solid', color: '#FFFFFF' }, inheritedArtworkCount: 0,
    };
    expect(isNativeSlideAppearanceValid(slide, document)).toBe(true);
    slide.extensions.pptxColorMapOverride = 'master';
    expect(isNativeSlideAppearanceValid(slide, document)).toBe(false);
    delete slide.extensions.pptxColorMapOverride;
    document.layouts[0].extensions.pptxColorMapOverride = 'master';
    expect(isNativeSlideAppearanceValid(slide, document)).toBe(false);

    const layout = structuredClone(document.layouts[0]);
    layout.source = { format: 'pptx' };
    layout.extensions.stagecraftLayoutSummary = {
      version: 1, appearanceResolved: true, input: nativeLayoutAppearanceInput(layout, document),
      background: { kind: 'solid', color: '#FFFFFF' }, artworkCount: 0,
    };
    expect(isNativeLayoutAppearanceValid(layout, document)).toBe(true);
    document.masters[0].extensions.pptxColorMap.tx1 = 'dk1';
    expect(isNativeLayoutAppearanceValid(layout, document)).toBe(false);

    const object = proveObject(nativeObject());
    const context = { theme: document.themes[0], colorMap: { tx1: 'dk1' } };
    object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, context);
    expect(isNativeObjectAppearanceValid(object, context)).toBe(true);
    context.theme.extensions.pptxFontScheme.minor.supplemental.Arab = 'Noto Naskh Arabic';
    expect(isNativeObjectAppearanceValid(object, context)).toBe(false);
  });

  it('rejects a slide proof that claims no inherited artwork when its layout or master has objects', () => {
    const layoutObject = { id: 'layout-art', type: 'shape' };
    const masterObject = { id: 'master-art', type: 'shape' };
    const layout = { id: 'l1', masterId: 'm1', objects: [layoutObject] };
    const master = { id: 'm1', objects: [masterObject] };
    const slide = { id: 's1', source: { format: 'pptx' }, layoutId: 'l1', objects: [], extensions: {} };
    const document = { layouts: [layout], masters: [master] };
    slide.extensions.stagecraftSlideAppearance = {
      version: 1, appearanceResolved: true, input: nativeSlideAppearanceInput(slide, document),
      background: { kind: 'solid', color: '#FFFFFF' }, inheritedArtworkCount: 0,
    };

    expect(isNativeSlideAppearanceValid(slide, document)).toBe(false);
    layout.objects = [];
    slide.extensions.stagecraftSlideAppearance.input = nativeSlideAppearanceInput(slide, document);
    expect(isNativeSlideAppearanceValid(slide, document)).toBe(false);
  });

  it('binds object proof inputs to resolved theme appearance context', () => {
    const object = proveObject(nativeObject());
    const context = { theme: { id: 't1', extensions: { pptxColorScheme: { dk1: '#000000' }, pptxFillStyles: [], pptxLineStyles: [] } }, colorMap: { tx1: 'dk1' } };
    object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, context);
    expect(isNativeObjectAppearanceValid(object, context)).toBe(true);
    context.theme.extensions.pptxFillStyles.push({ kind: 'solid', color: '#FF0000' });
    expect(isNativeObjectAppearanceValid(object, context)).toBe(false);
  });

  it('binds paragraph proof values to canonical style and end-run appearance', () => {
    const object = proveObject(nativeObject());
    const paragraph = object.text.paragraphs[0];
    paragraph.extensions = { pptxEndRunAppearance: { ...object.extensions.stagecraftNativeAppearance.text.paragraphs[0].endRun } };
    object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object);
    expect(isNativeObjectAppearanceValid(object)).toBe(true);

    for (const mutate of [
      p => { p.alignment = 'right'; },
      p => { p.lineSpacingPct = 1e300; },
      p => { p.endRun.color = '#FFFFFF'; },
    ]) {
      const tampered = structuredClone(object);
      mutate(tampered.extensions.stagecraftNativeAppearance.text.paragraphs[0]);
      expect(isNativeObjectAppearanceValid(tampered)).toBe(false);
    }
  });

  it('binds layout and slide proofs to inherited background changes', () => {
    const layout = { id: 'l1', source: { format: 'pptx' }, background: { type: 'solid', color: '#FFFFFF' }, objects: [], extensions: {} };
    const slide = { id: 's1', source: { format: 'pptx' }, layoutId: 'l1', background: { type: 'solid', color: '#FFFFFF' }, extensions: {} };
    const document = { layouts: [layout], masters: [{ id: 'm1', background: { type: 'solid', color: '#FFFFFF' }, objects: [] }], themes: [] };
    layout.masterId = 'm1';
    layout.extensions.stagecraftLayoutSummary = {
      version: 1, appearanceResolved: true, input: nativeLayoutAppearanceInput(layout, document),
      background: { kind: 'solid', color: '#FFFFFF' }, artworkCount: 0,
    };
    slide.extensions.stagecraftSlideAppearance = {
      version: 1, appearanceResolved: true, input: nativeSlideAppearanceInput(slide, document),
      background: { kind: 'solid', color: '#FFFFFF' }, inheritedArtworkCount: 0,
    };
    expect(isNativeLayoutAppearanceValid(layout, document)).toBe(true);
    expect(isNativeSlideAppearanceValid(slide, document)).toBe(true);
    layout.background.color = '#000000';
    expect(isNativeLayoutAppearanceValid(layout, document)).toBe(false);
    expect(isNativeSlideAppearanceValid(slide, document)).toBe(false);
    layout.background.color = '#FFFFFF';
    document.masters[0].background.color = '#000000';
    expect(isNativeLayoutAppearanceValid(layout, document)).toBe(false);
    expect(isNativeSlideAppearanceValid(slide, document)).toBe(false);
  });

  it('binds slide proof inputs to background style vectors', () => {
    const slide = { id: 's1', source: { format: 'pptx' }, extensions: {} };
    const document = { themes: [{ id: 't1', extensions: { pptxBackgroundFillStyles: [{ kind: 'solid', color: '#FFFFFF' }] } }] };
    slide.extensions.stagecraftSlideAppearance = {
      version: 1, appearanceResolved: true, input: nativeSlideAppearanceInput(slide, document),
      background: { kind: 'solid', color: '#FFFFFF' }, inheritedArtworkCount: 0,
    };
    expect(isNativeSlideAppearanceValid(slide, document)).toBe(true);
    document.themes[0].extensions.pptxBackgroundFillStyles[0].color = '#000000';
    expect(isNativeSlideAppearanceValid(slide, document)).toBe(false);
  });

  it('checks metric bounds after canonical binding and caps summary inputs', () => {
    for (const [key, value] of [['spaceBeforePt', -1], ['lineSpacingPct', 1000001], ['indentStartEmu', 1.5], ['indentEndEmu', 10000001]]) {
      const object = proveObject(nativeObject());
      const canonicalKey = { spaceBeforePt: 'spaceBefore', lineSpacingPct: 'lineSpacing', indentStartEmu: 'indentStart', indentEndEmu: 'indentEnd' }[key];
      object.text.paragraphs[0].style[canonicalKey] = value;
      object.extensions.stagecraftNativeAppearance.text.paragraphs[0][key] = value;
      object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object);
      expect(isNativeObjectAppearanceValid(object)).toBe(false);
    }

    const missing = proveObject(nativeObject());
    delete missing.text.paragraphs[0].runs[0].extensions;
    missing.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(missing);
    expect(isNativeObjectAppearanceValid(missing)).toBe(false);

    const slide = { id: 's1', source: { format: 'pptx' }, background: { type: 'solid', color: '#FFFFFF' }, extensions: {} };
    slide.extensions.stagecraftSlideAppearance = {
      version: 1, appearanceResolved: true, input: 'x'.repeat(16385),
      background: { kind: 'solid', color: '#FFFFFF' }, inheritedArtworkCount: 0,
    };
    expect(isNativeSlideAppearanceValid(slide)).toBe(false);

    const layout = { id: 'l1', source: { format: 'pptx' }, objects: [], extensions: {} };
    layout.extensions.stagecraftLayoutSummary = {
      version: 1, appearanceResolved: true, input: 'x'.repeat(16385),
      background: { kind: 'solid', color: '#FFFFFF' }, artworkCount: 0,
    };
    expect(isNativeLayoutAppearanceValid(layout)).toBe(false);
  });

  it('resolves slide theme references directly and through master or layout', () => {
    for (const refs of [
      { themeId: 't1' },
      { masterId: 'm1' },
      { layoutId: 'l1' },
    ]) {
      const slide = { id: 's1', source: { format: 'pptx' }, ...refs, extensions: { pptxColorMap: { tx1: 'dk1' } } };
      const document = {
        layouts: [{ id: 'l1', masterId: 'm1', themeId: 't1', objects: [], extensions: { pptxColorMap: { bg1: 'lt1' } } }],
        masters: [{ id: 'm1', themeId: 't1', objects: [], extensions: { pptxColorMap: { tx1: 'dk1' } } }],
        themes: [{ id: 't1', extensions: {} }],
      };
      expect(nativeSlideAppearanceInput(slide, document)).toContain('"id":"t1"');
    }
  });

  it('rejects missing sidecars and malformed summary metrics', () => {
    const missingSidecar = proveObject(nativeObject());
    delete missingSidecar.text.paragraphs[0].runs[0].extensions;
    expect(isNativeObjectAppearanceValid(missingSidecar)).toBe(false);

    const slide = { id: 's1', source: { format: 'pptx' }, extensions: {} };
    slide.extensions.stagecraftSlideAppearance = {
      version: 1, appearanceResolved: true, input: nativeSlideAppearanceInput(slide),
      background: { kind: 'solid', color: '#FFFFFF', extra: true }, inheritedArtworkCount: 0,
    };
    expect(isNativeSlideAppearanceValid(slide)).toBe(false);

    for (const artworkCount of [-1, 1.5, 2]) {
      const layout = { id: 'l1', source: { format: 'pptx' }, objects: [], extensions: {} };
      layout.extensions.stagecraftLayoutSummary = {
        version: 1, appearanceResolved: true, input: nativeLayoutAppearanceInput(layout),
        background: { kind: 'solid', color: '#FFFFFF' }, artworkCount,
      };
      expect(isNativeLayoutAppearanceValid(layout)).toBe(false);
    }
  });

  it('binds slide proof inputs to layout, master and theme fallbacks', () => {
    const slide = { id: 's1', source: { format: 'pptx' }, layoutId: 'l1', extensions: {} };
    const document = {
      layouts: [{ id: 'l1', masterId: 'm1', themeId: 't1', objects: [] }],
      masters: [{ id: 'm1', objects: [] }],
      themes: [{ id: 't1', extensions: { pptxColorScheme: { lt1: '#FFFFFF' } } }],
    };
    slide.extensions.stagecraftSlideAppearance = {
      version: 1, appearanceResolved: true, input: nativeSlideAppearanceInput(slide, document),
      background: { kind: 'solid', color: '#FFFFFF' }, inheritedArtworkCount: 0,
    };
    expect(isNativeSlideAppearanceValid(slide, document)).toBe(true);
    document.masters[0].objects.push({ id: 'a', type: 'shape' });
    expect(isNativeSlideAppearanceValid(slide, document)).toBe(false);
  });

  it('covers optional inheritance and invalid native object/layout branches', () => {
    const slide = { id: 's1', source: { format: 'pptx' }, layoutId: 'l1', extensions: {} };
    const layoutOnly = { layouts: [{ id: 'l1' }], masters: [], themes: [] };
    expect(nativeSlideAppearanceInput(slide, layoutOnly)).toContain('"master":null');
    const masterOnly = { layouts: [], masters: [{ id: 'm1' }], themes: [] };
    slide.masterId = 'm1';
    expect(nativeSlideAppearanceInput(slide, masterOnly)).toContain('"layout":null');

    const layout = { id: 'l1', source: { format: 'pptx' }, themeId: 't1', objects: [], extensions: {} };
    const document = { masters: [], themes: [{ id: 't1', extensions: {} }] };
    expect(nativeLayoutAppearanceInput(layout, document)).toContain('"id":"t1"');

    for (const mutate of [
      o => { o.type = 'image'; },
      o => { o.type = 'shape'; o.shape = 'star'; delete o.text; o.extensions.stagecraftNativeAppearance.text = undefined; },
      o => { o.shape = 'ellipse'; },
    ]) {
      const object = proveObject(nativeObject());
      mutate(object);
      object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object);
      expect(isNativeObjectAppearanceValid(object)).toBe(false);
    }

    expect(() => invalidateNativeLayoutAppearance({})).not.toThrow();
    expect(() => invalidateNativeObjectAppearance({})).not.toThrow();
    expect(() => invalidateNativeSlideAppearance({})).not.toThrow();
  });

  it('requires a positive safe width for every solid stroke proof', () => {
    for (const stroke of [{ kind: 'solid', color: '#112233' }, { kind: 'solid', color: '#112233', widthEmu: 0 }, { kind: 'solid', color: '#112233', widthEmu: 1.5 }, { kind: 'none', extra: true }, { kind: 'solid', color: '#112233', widthEmu: 1, extra: true }]) {
      const object = proveObject(nativeObject());
      object.extensions.stagecraftNativeAppearance.stroke = stroke;
      expect(isNativeObjectAppearanceValid(object)).toBe(false);
    }
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
