import { expect, it } from 'vitest';
import {
  nativeTextFontSlots,
  nativeLayoutAppearanceInput,
  nativeObjectAppearanceInput,
  nativeSlideAppearanceInput,
} from '@stagecraft/core/lib/nativeAppearance.js';
import { resolveTextFamily } from '../vendor/officeview/drawing/text-layout.ts';
import { buildCanonicalScene } from './index.js';
import { box, deck } from '../../../../tests/helpers/canonicalScene.js';

const colorMap = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
const pptxSource = (part, path = []) => ({ format: 'pptx', part, path });

function nativeDocument({ objectProof = true, slideProof = true, layoutProof = true, secondObject = false } = {}) {
  const theme = {
    id: 'theme',
    extensions: {
      pptxColorScheme: { dk1: '#000000', lt1: '#FFFFFF' },
      pptxFontScheme: {
        major: { latin: 'Georgia', eastAsian: 'Yu Gothic', complexScript: 'Amiri', supplemental: {} },
        minor: { latin: 'Arial', eastAsian: 'Noto Sans JP', complexScript: 'Amiri', supplemental: {} },
      },
    },
  };
  const master = {
    id: 'master', themeId: theme.id, source: pptxSource('ppt/slideMasters/slideMaster1.xml'),
    objects: [], extensions: { pptxColorMap: colorMap },
  };
  const layout = {
    id: 'layout', masterId: master.id, source: pptxSource('ppt/slideLayouts/slideLayout1.xml'),
    objects: [], extensions: { pptxColorMap: colorMap },
  };
  const shape = (id, index) => ({
    id, type: 'shape', shape: 'rect', geometry: { x: 95250 * index, y: 95250, width: 952500, height: 476250 },
    source: pptxSource('ppt/slides/slide1.xml', [index]), extensions: { pptxColorMap: undefined },
  });
  const objects = [shape('native-shape', 1)];
  if (secondObject) objects.push(shape('second-shape', 2));
  const slide = {
    id: 'native-slide', source: pptxSource('ppt/slides/slide1.xml'), layoutId: layout.id,
    extensions: { pptxColorMap: colorMap }, objects,
  };
  const document = {
    schemaVersion: 1, units: 'emu', size: { width: 9144000, height: 5143500 },
    extensions: { sourceFormat: 'pptx' }, slides: [slide], layouts: [layout], masters: [master], themes: [theme],
  };

  if (layoutProof) {
    for (const entity of [master, layout]) {
      entity.extensions.stagecraftLayoutSummary = {
        version: 1, appearanceResolved: true, input: nativeLayoutAppearanceInput(entity, document),
        background: { kind: 'solid', color: '#FFFFFF' }, artworkCount: 0,
      };
    }
  }
  for (const object of objects) {
    if (!objectProof) continue;
    object.extensions.stagecraftNativeAppearance = {
      version: 1, sourceFormat: 'pptx', appearanceResolved: true,
      input: nativeObjectAppearanceInput(object, { theme, colorMap, document, slide }),
      fill: { kind: 'solid', color: '#123456' },
      stroke: { kind: 'solid', color: '#654321', widthEmu: 19050 },
    };
  }
  if (slideProof) {
    slide.extensions.stagecraftSlideAppearance = {
      version: 1, appearanceResolved: true, input: nativeSlideAppearanceInput(slide, document),
      background: { kind: 'solid', color: '#FFFFFF' }, inheritedArtworkCount: 0,
    };
  }
  return document;
}

it('admits a native slide only from current slide, layout, and object proofs', () => {
  const document = nativeDocument();
  const result = buildCanonicalScene(document, 'native-slide');
  expect(result.status).toBe('ready');
  expect(result.scene.background).toBe('#FFFFFF');
  expect(result.scene.nodes).toHaveLength(1);
  expect(result.scene.nodes[0]).toMatchObject({
    id: 'native-shape', type: 'shape',
    paint: { fill: '#123456', stroke: { kind: 'solid', color: '#654321', widthEmu: 19050 } },
  });
});

function nativeTextDocument(autofit, fit = { fontScale: 62500, lnSpcReduction: 20000 }) {
  const document = nativeDocument();
  const slide = document.slides[0];
  const object = slide.objects[0];
  object.type = 'text';
  delete object.shape;
  object.bodyLayout = {
    autofit,
    fit: autofit === 'shrink' ? fit : undefined,
    anchor: 'top', wrap: 'square',
    insets: { left: 95250, right: 95250, top: 0, bottom: 0 },
  };
  object.text = { paragraphs: [{ id: 'paragraph-1', runs: [{
    id: 'run-1', text: 'Stored fit display', style: { sz: '1800' },
    extensions: { pptxAppearance: { script: 'Latn', resolved: {
      color: '#112233', fontFamily: 'Arial', fontFamilyEastAsia: 'Noto Sans JP',
      fontFamilyComplexScript: 'Amiri', fontSizePt: 18, bold: false, italic: false,
    } } },
  }], extensions: { pptxEndRunAppearance: {
    color: '#112233', fontFamily: 'Arial', fontFamilyEastAsia: 'Noto Sans JP',
    fontFamilyComplexScript: 'Amiri', fontSizePt: 18, bold: false, italic: false,
  } } }] };
  object.extensions.pptxTextMetrics = { supported: true };
  object.extensions.stagecraftNativeAppearance.text = { paragraphs: [{
    id: 'paragraph-1', runIds: ['run-1'], alignment: 'left', spaceBeforePt: 0,
    spaceAfterPt: 0, lineSpacingPct: 100, indentStartEmu: 0, indentEndEmu: 0,
    firstLineIndentEmu: 0, endRun: {
      color: '#112233', fontFamily: 'Arial', fontFamilyEastAsia: 'Noto Sans JP',
      fontFamilyComplexScript: 'Amiri', fontSizePt: 18, bold: false, italic: false,
    },
  }] };
  object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
    theme: document.themes[0], colorMap, document, slide,
  });
  return document;
}

function nativeTextWithFontSize(pt, fit = { fontScale: 25000, lnSpcReduction: 20000 }) {
  const document = nativeTextDocument('shrink', fit);
  const slide = document.slides[0];
  const object = slide.objects[0];
  const paragraph = object.text.paragraphs[0];
  const run = paragraph.runs[0];
  run.style.sz = String(Math.round(pt * 100));
  run.extensions.pptxAppearance.resolved.fontSizePt = pt;
  paragraph.extensions.pptxEndRunAppearance.fontSizePt = pt;
  object.extensions.stagecraftNativeAppearance.text.paragraphs[0].endRun.fontSizePt = pt;
  object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
    theme: document.themes[0], colorMap, document, slide,
  });
  return document;
}

it.each([[8, 6000], [8, 6250], [10, 4000], [12, 5000]])(
  'floors native shrink run and end sizes after whole-point snapping (%spt at %s)', (fontSize, fontScale) => {
    const result = buildCanonicalScene(nativeTextWithFontSize(fontSize, { fontScale, lnSpcReduction: 20000 }), 'native-slide');
    expect(result.status).toBe('ready');
    const paragraph = result.scene.nodes[0].paint.text.body.paragraphs[0];
    expect(paragraph.runs[0].fontSizePt).toBe(1);
    expect(paragraph.endProperties.fontSizePt).toBe(1);
  },
);

it('admits native shrink when a half-point tie snaps to one point', () => {
  const result = buildCanonicalScene(nativeTextWithFontSize(2), 'native-slide');
  expect(result.status).toBe('ready');
  const body = result.scene.nodes[0].paint.text.body;
  expect(body.paragraphs[0].runs[0].fontSizePt).toBe(1);
  expect(body.paragraphs[0].endProperties.fontSizePt).toBe(1);
});

it.each([
  [{ fontScale: 100000, lnSpcReduction: 0 }, 18, 1.2, 120],
  [{ fontScale: 85000, lnSpcReduction: 10000 }, 15, 1.1, 120],
  [{ fontScale: 62500, lnSpcReduction: 20000 }, 11, 0.8, 100],
  [{ fontScale: 25000, lnSpcReduction: 20000 }, 5, 0.8, 100],
])('paints native shrink from stored values %# without changing canonical data', (fit, expectedSize, expectedSpacing, authoredSpacing) => {
  const document = nativeTextDocument('shrink', fit);
  if (authoredSpacing !== 100) {
    const object = document.slides[0].objects[0];
    object.text.paragraphs[0].style = { lineSpacing: authoredSpacing };
    object.extensions.stagecraftNativeAppearance.text.paragraphs[0].lineSpacingPct = authoredSpacing;
    object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
      theme: document.themes[0], colorMap, document, slide: document.slides[0],
    });
  }
  const original = structuredClone(document);
  const result = buildCanonicalScene(document, 'native-slide');
  expect(result.status).toBe('ready');
  const body = result.scene.nodes[0].paint.text.body;
  expect(body.paragraphs[0].runs[0].fontSizePt).toBeCloseTo(expectedSize, 12);
  expect(body.paragraphs[0].endProperties.fontSizePt).toBeCloseTo(expectedSize, 12);
  expect(body.paragraphs[0].lineSpacing.kind).toBe('percent');
  expect(body.paragraphs[0].lineSpacing.value).toBeCloseTo(expectedSpacing, 12);
  expect(document).toEqual(original);
});

it('keeps authored shrink text unscaled in the canonical scene', () => {
  const authored = box({ bodyLayout: { autofit: 'shrink' } });
  const result = buildCanonicalScene(deck([authored]), 's');
  expect(result.status).toBe('ready');
  const run = result.scene.nodes[0].paint.text.body.paragraphs[0].runs[0];
  expect(run.fontSizePt).toBe(18);
});

it('refuses native text when the resolved face is unavailable, without affecting authored text', () => {
  const unavailable = { isAvailable: () => false };
  expect(buildCanonicalScene(nativeTextDocument('shrink'), 'native-slide', { fontAvailability: unavailable })).toMatchObject({
    status: 'unsupported', reason: 'fonts-unavailable',
    diagnostics: [{ code: 'native-font-face-unavailable', objectId: 'native-shape' }],
  });
  expect(buildCanonicalScene(nativeDocument(), 'native-slide', { fontAvailability: unavailable }).status).toBe('ready');
  expect(buildCanonicalScene(deck([box()]), 's', { fontAvailability: unavailable }).status).toBe('ready');
});

it('admits native text when the shared probe reports the face available', () => {
  const available = { isAvailable: () => true };
  expect(buildCanonicalScene(nativeTextDocument('shrink'), 'native-slide', { fontAvailability: available }).status).toBe('ready');
});

it.each([
  [{}, 18, 1.2, 120],
  [{ fontScale: 62500 }, 11, 1.2, 120],
  [{ lnSpcReduction: 20000 }, 18, 0.8, 100],
])('paints schema defaults for partial native shrink values %# without changing canonical data', (fit, expectedSize, expectedSpacing, authoredSpacing) => {
  const document = nativeTextDocument('shrink', fit);
  if (authoredSpacing !== 100) {
    const object = document.slides[0].objects[0];
    object.text.paragraphs[0].style = { lineSpacing: authoredSpacing };
    object.extensions.stagecraftNativeAppearance.text.paragraphs[0].lineSpacingPct = authoredSpacing;
    object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
      theme: document.themes[0], colorMap, document, slide: document.slides[0],
    });
  }
  const original = structuredClone(document);
  const result = buildCanonicalScene(document, 'native-slide');
  expect(result.status).toBe('ready');
  const body = result.scene.nodes[0].paint.text.body;
  expect(body.paragraphs[0].runs[0].fontSizePt).toBeCloseTo(expectedSize, 12);
  expect(body.paragraphs[0].endProperties.fontSizePt).toBeCloseTo(expectedSize, 12);
  expect(body.paragraphs[0].lineSpacing).toEqual({ kind: 'percent', value: expectedSpacing });
  expect(document).toEqual(original);
});

it('refuses native shrink when the core effective fit is malformed', () => {
  const document = nativeTextDocument('shrink', { fontScale: '62500' });
  const result = buildCanonicalScene(document, 'native-slide');
  expect(result).toMatchObject({ status: 'unsupported', reason: 'unresolved-appearance' });
});

it.each([
  ['spaceBefore', 12, 'spaceBeforePt'],
  ['spaceAfter', 8, 'spaceAfterPt'],
])('refuses native shrink with non-default paragraph %s', (field, value, proofField) => {
  const document = nativeTextDocument('shrink');
  const object = document.slides[0].objects[0];
  object.text.paragraphs[0].style = { [field]: value };
  object.extensions.stagecraftNativeAppearance.text.paragraphs[0][proofField] = value;
  object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
    theme: document.themes[0], colorMap, document, slide: document.slides[0],
  });

  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'native-appearance-proof-invalid', objectId: object.id }],
  });
});

it.each([
  [90, 10000, 0.8],
  [120, 10000, 1.1],
  [150, 20000, 1.3],
  [150, 0, 1.5],
])('uses subtractive native line spacing for %s%% and reduction %s', (lineSpacing, lnSpcReduction, expected) => {
  const document = nativeTextDocument('shrink', { fontScale: 100000, lnSpcReduction });
  const object = document.slides[0].objects[0];
  object.text.paragraphs[0].style = { lineSpacing };
  object.extensions.stagecraftNativeAppearance.text.paragraphs[0].lineSpacingPct = lineSpacing;
  object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
    theme: document.themes[0], colorMap, document, slide: document.slides[0],
  });

  const result = buildCanonicalScene(document, 'native-slide');
  expect(result.status).toBe('ready');
  expect(result.scene.nodes[0].paint.text.body.paragraphs[0].lineSpacing.value).toBeCloseTo(expected, 12);
});

it('refuses native shrink spacing at the PowerPoint-unmatched effective 70% ratio', () => {
  const effective = 0.7;
  const document = nativeTextDocument('shrink', { fontScale: 100000, lnSpcReduction: 0 });
  const object = document.slides[0].objects[0];
  object.text.paragraphs[0].style = { lineSpacing: effective * 100 };
  object.extensions.stagecraftNativeAppearance.text.paragraphs[0].lineSpacingPct = effective * 100;
  object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
    theme: document.themes[0], colorMap, document, slide: document.slides[0],
  });

  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'native-appearance-proof-invalid', objectId: object.id }],
  });
});

it('refuses 90% source spacing with zero reduction', () => {
  const document = nativeTextDocument('shrink', { fontScale: 100000, lnSpcReduction: 0 });
  const object = document.slides[0].objects[0];
  object.text.paragraphs[0].style = { lineSpacing: 90 };
  object.extensions.stagecraftNativeAppearance.text.paragraphs[0].lineSpacingPct = 90;
  object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
    theme: document.themes[0], colorMap, document, slide: document.slides[0],
  });

  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'native-appearance-proof-invalid', objectId: object.id }],
  });
});

it('keeps plain 100% native shrink admitted with no line-spacing reduction', () => {
  const document = nativeTextDocument('shrink', { fontScale: 100000, lnSpcReduction: 0 });
  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({ status: 'ready' });
});

it('preserves prior admission for default 100% spacing with stored 10000 reduction', () => {
  const document = nativeTextDocument('shrink', { fontScale: 85000, lnSpcReduction: 10000 });
  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({ status: 'ready' });
});

it('preserves master admission for explicit 100% spacing with any stored reduction', () => {
  const document = nativeTextDocument('shrink', { fontScale: 85000, lnSpcReduction: 30000 });
  const object = document.slides[0].objects[0];
  object.text.paragraphs[0].style = { lineSpacing: 100 };
  object.extensions.stagecraftNativeAppearance.text.paragraphs[0].lineSpacingPct = 100;
  object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
    theme: document.themes[0], colorMap, document, slide: document.slides[0],
  });
  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({ status: 'ready' });
});

it('refuses native shrink whose source proof has non-finite line spacing', () => {
  // Core proof validation rejects this source value before the renderer display guard runs.
  const document = nativeTextDocument('shrink', { fontScale: 100000, lnSpcReduction: 0 });
  const object = document.slides[0].objects[0];
  object.text.paragraphs[0].style = { lineSpacing: Infinity };
  object.extensions.stagecraftNativeAppearance.text.paragraphs[0].lineSpacingPct = Infinity;
  object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
    theme: document.themes[0], colorMap, document, slide: document.slides[0],
  });

  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'native-appearance-proof-invalid', objectId: object.id }],
  });
});

it('refuses default-spacing native shrink when stored reduction produces zero spacing', () => {
  const document = nativeTextDocument('shrink', { fontScale: 100000, lnSpcReduction: 100000 });
  const object = document.slides[0].objects[0];

  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'native-appearance-proof-invalid', objectId: object.id }],
  });
});

it('refuses native shrink when subtractive line spacing is non-positive', () => {
  const document = nativeTextDocument('shrink', { fontScale: 100000, lnSpcReduction: 20000 });
  const object = document.slides[0].objects[0];
  object.text.paragraphs[0].style = { lineSpacing: 20 };
  object.extensions.stagecraftNativeAppearance.text.paragraphs[0].lineSpacingPct = 20;
  object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
    theme: document.themes[0], colorMap, document, slide: document.slides[0],
  });

  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'native-appearance-proof-invalid', objectId: 'native-shape' }],
  });
});

it.each(['text', 'width', 'height'])('refuses a native shrink proof made stale by %s changes', field => {
  const document = nativeTextDocument('shrink');
  const object = document.slides[0].objects[0];
  if (field === 'text') object.text.paragraphs[0].runs[0].text += ' changed';
  else object.geometry[field] += 95250;
  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'native-appearance-stale', objectId: object.id }],
  });
});

it.each(['text', 'width', 'height'])('refuses native resize when its stored-frame proof is stale after %s changes', field => {
  const document = nativeTextDocument('resize');
  const object = document.slides[0].objects[0];
  if (field === 'text') object.text.paragraphs[0].runs[0].text += ' changed';
  else object.geometry[field] += 95250;
  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'native-appearance-stale', objectId: object.id }],
  });
});

it.each(['shrink', 'resize'])('preserves a native %s proof across x/y/rotation-only edits', autofit => {
  const document = nativeTextDocument(autofit);
  const object = document.slides[0].objects[0];
  object.geometry.x += 95250;
  object.geometry.y += 190500;
  object.geometry.rotation = 15;
  const result = buildCanonicalScene(document, 'native-slide');
  expect(result.status).toBe('ready');
  expect(result.scene.nodes[0].geometry).toEqual(object.geometry);
  expect(result.scene.nodes[0].frame).toMatchObject({
    x: object.geometry.x / 9525, y: object.geometry.y / 9525, rotation: 15,
  });
});

it('keeps native resize text and stored geometry unchanged', () => {
  const document = nativeTextDocument('resize');
  const result = buildCanonicalScene(document, 'native-slide');
  expect(result.status).toBe('ready');
  expect(result.scene.nodes[0].geometry).toEqual(document.slides[0].objects[0].geometry);
  expect(result.scene.nodes[0].paint.text.body.paragraphs[0].runs[0].fontSizePt).toBe(18);
});

it('admits a native slide proof without requiring layout or master summaries', () => {
  const document = nativeDocument({ layoutProof: false });
  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({ status: 'ready' });
});

it('refuses native inherited artwork even when the slide proof claims none', () => {
  const document = nativeDocument();
  document.layouts[0].objects.push({ id: 'layout-art', type: 'shape' });
  document.slides[0].extensions.stagecraftSlideAppearance.input = nativeSlideAppearanceInput(
    document.slides[0], document,
  );

  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'inherited-appearance',
    diagnostics: [{ code: 'inherited-artwork' }],
  });
});

it('classifies non-string native proof inputs as invalid rather than stale', () => {
  const document = nativeDocument();
  document.slides[0].extensions.stagecraftSlideAppearance.input = { malformed: true };

  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'native-appearance-proof-invalid' }],
  });
});

it('matches painter font slots for digits, CJK punctuation and spaces, Latin, and Arabic', () => {
  const theme = { fonts: { minor: { latin: 'Latin Face', eastAsian: 'EA Face', complexScript: 'CS Face', supplemental: {} } } };
  const cases = [
    ['123', ['latin']],
    ['漢、', ['eastAsian', 'latin']],
    ['漢字  ', ['eastAsian']],
    ['A B', ['latin']],
    ['مرحبا', ['complexScript']],
    ['漢字123', ['eastAsian', 'latin']],
  ];
  for (const [text, expected] of cases) {
    const resolvedSlots = new Set();
    let previous = null;
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      let family;
      if (/^\s+$/u.test(segment) && previous) family = previous;
      else family = resolveTextFamily({ text: segment }, theme);
      previous = family;
      resolvedSlots.add(({ 'Latin Face': 'latin', 'EA Face': 'eastAsian', 'CS Face': 'complexScript' })[family]);
    }
    expect(nativeTextFontSlots(text)).toEqual(expected);
    expect(new Set(nativeTextFontSlots(text))).toEqual(resolvedSlots);
  }
});

it('refuses a forged single-slot proof when the painter uses EA and Latin fonts in one run', () => {
  const document = nativeDocument();
  const slide = document.slides[0];
  const object = slide.objects[0];
  const runAppearance = {
    color: '#112233', fontFamily: 'Georgia', fontFamilyEastAsia: 'Yu Gothic',
    fontFamilyComplexScript: 'Amiri', fontSizePt: 18, bold: false, italic: false,
  };
  object.type = 'text';
  object.text = { paragraphs: [{
    id: 'paragraph-1',
    runs: [{ id: 'run-1', text: '漢字123', style: { sz: '1800' }, extensions: {
      pptxAppearance: { script: 'Hani', resolved: { ...runAppearance } },
    } }],
    extensions: { pptxEndRunAppearance: { ...runAppearance } },
  }] };
  object.extensions.stagecraftNativeAppearance.text = { paragraphs: [{
    id: 'paragraph-1', runIds: ['run-1'], alignment: 'left', endRun: { ...runAppearance },
  }] };
  object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object, {
    theme: document.themes[0], colorMap, document, slide,
  });

  expect(buildCanonicalScene(document, slide.id)).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'text-appearance-unresolved', objectId: object.id }],
  });
});

it('distinguishes a missing native slide proof from missing layout summaries', () => {
  const document = nativeDocument({ layoutProof: false, slideProof: false });
  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'native-appearance-proof-missing' }],
  });
});

it('refuses the whole native slide with a missing object proof diagnostic', () => {
  const document = nativeDocument({ secondObject: true });
  delete document.slides[0].objects[1].extensions.stagecraftNativeAppearance;
  expect(buildCanonicalScene(document, 'native-slide')).toMatchObject({
    status: 'unsupported', reason: 'unresolved-appearance',
    diagnostics: [{ code: 'native-appearance-proof-missing', objectId: 'second-shape' }],
  });
});
