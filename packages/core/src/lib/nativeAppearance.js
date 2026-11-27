export const NATIVE_APPEARANCE_VERSION = 1;
export const NATIVE_APPEARANCE_INPUT_MAX_BYTES = 16 * 1024;

const NATIVE_AUTOFIT_SCHEMA_DEFAULTS_APPROVED = false;

const TEXT_SCRIPT_PATTERNS = [
  ['Arab', /\p{Script=Arab}/u], ['Hebr', /\p{Script=Hebr}/u], ['Thai', /\p{Script=Thai}/u],
  ['Deva', /\p{Script=Deva}/u], ['Beng', /\p{Script=Beng}/u], ['Taml', /\p{Script=Taml}/u],
  ['Telu', /\p{Script=Telu}/u], ['Knda', /\p{Script=Knda}/u], ['Mlym', /\p{Script=Mlym}/u],
  ['Gujr', /\p{Script=Gujr}/u], ['Guru', /\p{Script=Guru}/u], ['Cyrl', /\p{Script=Cyrillic}/u],
  ['Grek', /\p{Script=Greek}/u], ['Hani', /\p{Script=Han}/u], ['Hang', /\p{Script=Hangul}/u],
  ['Hira', /\p{Script=Hiragana}/u], ['Kana', /\p{Script=Katakana}/u], ['Latn', /\p{Script=Latin}/u],
];
const PAINTER_SCRIPT_PATTERNS = [
  [/\p{Script=Arabic}/u, 'Arab'], [/\p{Script=Hebrew}/u, 'Hebr'], [/\p{Script=Devanagari}/u, 'Deva'],
  [/\p{Script=Thai}/u, 'Thai'], [/\p{Script=Tamil}/u, 'Taml'], [/\p{Script=Telugu}/u, 'Telu'],
  [/\p{Script=Bengali}/u, 'Beng'], [/\p{Script=Gujarati}/u, 'Gujr'], [/\p{Script=Gurmukhi}/u, 'Guru'],
  [/\p{Script=Kannada}/u, 'Knda'], [/\p{Script=Malayalam}/u, 'Mlym'], [/\p{Script=Oriya}/u, 'Orya'],
  [/\p{Script=Sinhala}/u, 'Sinh'], [/\p{Script=Khmer}/u, 'Khmr'], [/\p{Script=Lao}/u, 'Laoo'],
  [/\p{Script=Myanmar}/u, 'Mymr'], [/\p{Script=Tibetan}/u, 'Tibt'], [/\p{Script=Mongolian}/u, 'Mong'],
  [/\p{Script=Syriac}/u, 'Syrc'], [/\p{Script=Thaana}/u, 'Thaa'], [/\p{Script=Ethiopic}/u, 'Ethi'],
  [/\p{Script=Georgian}/u, 'Geor'], [/\p{Script=Armenian}/u, 'Armn'], [/\p{Script=Cherokee}/u, 'Cher'],
  [/\p{Script=Canadian_Aboriginal}/u, 'Cans'], [/\p{Script=Yi}/u, 'Yiii'],
  [/\p{Script=Cyrillic}/u, 'Cyrl'], [/\p{Script=Greek}/u, 'Grek'],
];
const painterScript = (text, language) => {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return 'Jpan';
  if (/\p{Script=Hangul}/u.test(text)) return 'Hang';
  if (/\p{Script=Han}/u.test(text)) return /^ja/i.test(language ?? '') ? 'Jpan'
    : /^ko/i.test(language ?? '') ? 'Hang' : /^zh-(TW|HK|MO|Hant)/i.test(language ?? '') ? 'Hant' : 'Hans';
  return PAINTER_SCRIPT_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] ?? 'Latn';
};
const painterSlot = script => ['Hans', 'Hant', 'Jpan', 'Hang'].includes(script) ? 'eastAsian'
  : ['Latn', 'Cyrl', 'Grek', 'Armn', 'Geor', 'Cher', 'Cans', 'Yiii'].includes(script) ? 'latin' : 'complexScript';

/** Font slots used by OfficeView's per-grapheme resolver; spaces inherit the prior piece. */
export function nativeTextFontSlots(text, language) {
  const Segmenter = Intl.Segmenter;
  let segments;
  if (Segmenter) segments = [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(item => item.segment);
  else {
    segments = [];
    let joined = false, regionalCount = 0;
    for (const character of text) {
      const regional = /\p{Regional_Indicator}/u.test(character);
      if (segments.length && (joined || character === '\u200d' || /[\p{M}\p{Emoji_Modifier}\u{E0020}-\u{E007F}]/u.test(character) || regional && regionalCount % 2 === 1)) {
        segments[segments.length - 1] += character;
      } else segments.push(character);
      joined = character === '\u200d';
      regionalCount = regional ? regionalCount + 1 : 0;
    }
  }
  const slots = new Set();
  let previousSlot = null;
  for (const grapheme of segments) {
    const slot = /^\s+$/u.test(grapheme) && previousSlot
      ? previousSlot : painterSlot(painterScript(grapheme, language));
    slots.add(slot);
    previousSlot = slot;
  }
  return slots.size ? [...slots] : ['latin'];
}

export function nativeTextScripts(text) {
  const scripts = new Set();
  if (/[\ufe0e\ufe0f\u20e3]/.test(text)) scripts.add('Other');
  for (const character of text) {
    const letter = /\p{L}/u.test(character);
    const number = /\p{N}/u.test(character);
    if (!letter && !number) {
      if (/[\p{S}\p{Extended_Pictographic}]/u.test(character)) scripts.add('Other');
      continue;
    }
    const match = TEXT_SCRIPT_PATTERNS.find(([, pattern]) => pattern.test(character));
    if (match) scripts.add(match[0]);
    else if (letter || !/[0-9]/.test(character)) scripts.add('Other');
  }
  return scripts.size ? [...scripts].sort() : ['Latn'];
}

export function nativeTextScript(text) {
  return nativeTextScripts(text).join('+');
}

const DEFAULT_NATIVE_COLOR_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };

/** Resolve the same effective theme and colour map for source projection and renderer proof checks. */
export function nativeAppearanceContext(document, entity) {
  let theme = null;
  let current = entity;
  const themeSeen = new Set();
  while (current && !themeSeen.has(current.id)) {
    themeSeen.add(current.id);
    if (current.extensions?.pptxThemeOverride) { theme = null; break; }
    if (current.themeId) {
      theme = document?.themes?.find(item => item.id === current.themeId) ?? null;
      break;
    }
    current = current.layoutId ? document?.layouts?.find(item => item.id === current.layoutId)
      : current.masterId ? document?.masters?.find(item => item.id === current.masterId) : null;
  }

  const chain = [];
  const mapSeen = new Set();
  let unsupportedMap = false;
  current = entity;
  while (current && !mapSeen.has(current.id)) {
    if (current.extensions?.pptxColorMapOverride === 'unsupported') { unsupportedMap = true; break; }
    mapSeen.add(current.id);
    if (current.extensions?.pptxColorMapOverride === 'master') {
      current = current.layoutId ? document?.layouts?.find(item => item.id === current.layoutId)
        : current.masterId ? document?.masters?.find(item => item.id === current.masterId) : null;
      continue;
    }
    chain.unshift(current);
    current = current.layoutId ? document?.layouts?.find(item => item.id === current.layoutId)
      : current.masterId ? document?.masters?.find(item => item.id === current.masterId) : null;
  }
  const colorMap = unsupportedMap ? null : Object.assign({ ...DEFAULT_NATIVE_COLOR_MAP }, ...chain.map(item => item.extensions?.pptxColorMap));
  return { theme, colorMap };
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, required, optional = []) => record(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const stableJson = value => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const inputBytes = value => new TextEncoder().encode(value).byteLength;
const solidColor = value => typeof value === 'string' && /^#[0-9A-F]{6}$/.test(value);
const fontFamily = value => typeof value === 'string' && value.length > 0 && value.length <= 64
  && !value.startsWith('+') && !/[\u0000-\u001f\u007f]/.test(value);
const positiveSize = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 4000;
const sourceInput = source => source ? {
  format: source.format,
  part: source.part,
  path: source.path,
} : null;

const stableHash = value => {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(stableJson(value))) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const validNativeAutofitFit = value => exactKeys(value, [], ['fontScale', 'lnSpcReduction'])
  && ['fontScale', 'lnSpcReduction'].every(key => !Object.hasOwn(value, key)
    || (Number.isSafeInteger(value[key]) && value[key] >= (key === 'fontScale' ? 1 : 0) && value[key] <= 100000));

/** Resolve stored shrink values, optionally applying schema defaults for pure evidence checks. */
export function nativeAutofitEffectiveFit(object, resolveDefaults = NATIVE_AUTOFIT_SCHEMA_DEFAULTS_APPROVED) {
  if (object?.bodyLayout?.autofit !== 'shrink') return null;
  const fit = object.bodyLayout.fit === undefined ? {} : object.bodyLayout.fit;
  if (!validNativeAutofitFit(fit)) return null;
  const hasFontScale = Object.hasOwn(fit, 'fontScale');
  const hasReduction = Object.hasOwn(fit, 'lnSpcReduction');
  if (!resolveDefaults && (!hasFontScale || !hasReduction)) return null;
  return {
    fontScale: hasFontScale ? fit.fontScale : 100000,
    lnSpcReduction: hasReduction ? fit.lnSpcReduction : 0,
  };
}

const nativeAutofitFitBinding = object => stableHash({
  paragraphs: (object.text?.paragraphs ?? []).map(paragraph => (paragraph.runs ?? []).map(run => run.text)),
  width: object.geometry?.width,
  height: object.geometry?.height,
});
const fontSchemeInput = fonts => fonts && Object.fromEntries(['major', 'minor'].map(group => [group, {
  latin: fonts[group]?.latin, eastAsian: fonts[group]?.eastAsian, complexScript: fonts[group]?.complexScript,
  supplementalHash: stableHash(fonts[group]?.supplemental ?? {}),
}]));
const themeAppearanceInput = (theme, colorMap) => theme ? {
  id: theme.id,
  colors: theme.extensions?.pptxColorScheme,
  fills: theme.extensions?.pptxFillStyles,
  lines: theme.extensions?.pptxLineStyles,
  backgrounds: theme.extensions?.pptxBackgroundFillStyles,
  backgroundDefinitions: theme.extensions?.pptxBackgroundFillDefinitions,
  fonts: fontSchemeInput(theme.extensions?.pptxFontScheme),
  colorMap,
} : null;

const inheritedAppearanceInput = context => {
  const document = context?.document;
  const slide = context?.slide;
  const layout = document?.layouts?.find(item => item.id === slide?.layoutId);
  const master = document?.masters?.find(item => item.id === (slide?.masterId ?? layout?.masterId));
  return context ? {
    objectDefaults: context.theme?.extensions?.pptxObjectDefaults,
    defaults: document?.extensions?.pptxDefaultTextStyle,
    master: master?.extensions?.pptxOtherTextStyle,
    layout: layout?.extensions?.pptxOtherTextStyle,
    masterColorMapOverride: master?.extensions?.pptxColorMapOverride,
    layoutColorMapOverride: layout?.extensions?.pptxColorMapOverride,
  } : undefined;
};

/** Appearance-determining canonical inputs only; autofit adds a fixed-size text/frame-size binding. */
export function nativeObjectAppearanceInput(object, context) {
  const effectiveFit = object.bodyLayout?.autofit === 'shrink' ? nativeAutofitEffectiveFit(object) : null;
  const hasFitBinding = ['shrink', 'resize'].includes(object.bodyLayout?.autofit);
  return stableJson({
    type: object.type,
    shape: object.shape,
    fill: object.fill,
    source: sourceInput(object.source),
    metrics: object.extensions?.pptxTextMetrics,
    bodyLayout: object.bodyLayout,
    ...(effectiveFit ? { effectiveFit } : {}),
    ...(hasFitBinding ? { fitBinding: nativeAutofitFitBinding(object) } : {}),
    text: object.text ? {
      paragraphs: object.text.paragraphs.map(paragraph => ({
        id: paragraph.id,
        source: sourceInput(paragraph.source),
        style: paragraph.style,
        endRun: paragraph.extensions?.pptxEndRunAppearance,
        runs: paragraph.runs.map(run => ({
          id: run.id,
          source: sourceInput(run.source),
          style: run.style,
          appearance: run.extensions?.pptxAppearance,
        })),
      })),
    } : null,
    theme: context ? themeAppearanceInput(context.theme, context.colorMap) : undefined,
    inherited: inheritedAppearanceInput(context),
  });
}

export function nativeSlideAppearanceInput(slide, document) {
  const layout = document?.layouts?.find(item => item.id === slide.layoutId);
  const master = document?.masters?.find(item => item.id === (slide.masterId ?? layout?.masterId));
  const theme = document?.themes?.find(item => item.id === (slide.themeId ?? master?.themeId ?? layout?.themeId)) ?? document?.themes?.[0];
  return stableJson({
    source: sourceInput(slide.source),
    background: slide.background,
    layoutId: slide.layoutId,
    masterId: slide.masterId,
    themeId: slide.themeId,
    colorMap: slide.extensions?.pptxColorMap,
    colorMapOverride: slide.extensions?.pptxColorMapOverride,
    inherited: document ? {
      layout: layout ? { id: layout.id, background: layout.background, objects: (layout.objects ?? []).map(object => ({ id: object.id, type: object.type })), colorMap: layout.extensions?.pptxColorMap, colorMapOverride: layout.extensions?.pptxColorMapOverride } : null,
      master: master ? { id: master.id, background: master.background, objects: (master.objects ?? []).map(object => ({ id: object.id, type: object.type })), colorMap: master.extensions?.pptxColorMap, colorMapOverride: master.extensions?.pptxColorMapOverride } : null,
      theme: themeAppearanceInput(theme),
    } : undefined,
  });
}

export function nativeLayoutAppearanceInput(entity, document) {
  const master = document?.masters?.find(item => item.id === entity.masterId);
  const theme = document?.themes?.find(item => item.id === (entity.themeId ?? master?.themeId)) ?? document?.themes?.[0];
  return stableJson({
    source: sourceInput(entity.source),
    background: entity.background,
    masterId: entity.masterId,
    themeId: entity.themeId,
    colorMap: entity.extensions?.pptxColorMap,
    colorMapOverride: entity.extensions?.pptxColorMapOverride,
    inheritedColorMap: master ? { ...(entity.extensions?.pptxColorMapOverride === 'master' ? {} : entity.extensions?.pptxColorMap), ...master.extensions?.pptxColorMap } : entity.extensions?.pptxColorMap,
    inheritedBackground: master?.background,
    theme: document ? themeAppearanceInput(theme, entity.extensions?.pptxColorMap) : undefined,
    objects: (entity.objects ?? []).map(object => ({
      id: object.id,
      type: object.type,
      source: sourceInput(object.source),
    })),
  });
}

export const isNativeAppearanceBackgroundValid = value => record(value) && (value.kind === 'none'
  ? Object.keys(value).length === 1
  : value.kind === 'solid' && exactKeys(value, ['kind', 'color']) && solidColor(value.color));
const validFill = value => isNativeAppearanceBackgroundValid(value);
const validStroke = value => value?.kind === 'none' && isNativeAppearanceBackgroundValid(value)
  || exactKeys(value, ['kind', 'color', 'widthEmu'])
  && value.kind === 'solid' && solidColor(value.color)
  && Number.isSafeInteger(value.widthEmu) && value.widthEmu > 0;
const validResolvedRun = value => exactKeys(value, [
  'color', 'fontFamily', 'fontFamilyEastAsia', 'fontFamilyComplexScript', 'fontSizePt', 'bold', 'italic',
]) && solidColor(value.color)
  && [value.fontFamily, value.fontFamilyEastAsia, value.fontFamilyComplexScript].every(fontFamily)
  && positiveSize(value.fontSizePt) && typeof value.bold === 'boolean' && typeof value.italic === 'boolean';
const validParagraphProof = (paragraph, canonical) => {
  if (!exactKeys(paragraph, ['id', 'runIds', 'alignment', 'endRun'], [
    'spaceBeforePt', 'spaceAfterPt', 'lineSpacingPct', 'indentStartEmu', 'indentEndEmu', 'firstLineIndentEmu',
  ]) || paragraph.id !== canonical.id || !['left', 'center', 'right', 'justify'].includes(paragraph.alignment)
    || paragraph.alignment !== (canonical.style?.alignment ?? 'left')
    || paragraph.spaceBeforePt !== (canonical.style?.spaceBefore ?? 0)
    || paragraph.spaceAfterPt !== (canonical.style?.spaceAfter ?? 0)
    || paragraph.lineSpacingPct !== (canonical.style?.lineSpacing ?? 100)
    || paragraph.indentStartEmu !== (canonical.style?.indentStart ?? 0)
    || paragraph.indentEndEmu !== (canonical.style?.indentEnd ?? 0)
    || paragraph.firstLineIndentEmu !== (canonical.style?.firstLineIndent ?? 0)
    || !Array.isArray(paragraph.runIds)
    || paragraph.runIds.length !== canonical.runs.length
    || paragraph.runIds.some((id, index) => id !== canonical.runs[index].id)
    || !validResolvedRun(paragraph.endRun)
    || stableJson(paragraph.endRun) !== stableJson(canonical.extensions?.pptxEndRunAppearance)) return false;
  for (const key of ['spaceBeforePt', 'spaceAfterPt', 'lineSpacingPct']) {
    if (paragraph[key] !== undefined && (typeof paragraph[key] !== 'number' || !Number.isFinite(paragraph[key]) || paragraph[key] < 0 || paragraph[key] > 1000000)) return false;
  }
  for (const key of ['indentStartEmu', 'indentEndEmu', 'firstLineIndentEmu']) {
    if (paragraph[key] !== undefined && (!Number.isSafeInteger(paragraph[key]) || Math.abs(paragraph[key]) > 10000000)) return false;
  }
  return canonical.runs.every(run => {
    const resolved = run.extensions?.pptxAppearance?.resolved;
    return nativeTextFontSlots(run.text).length === 1 && record(resolved) && validResolvedRun(resolved);
  });
};

export function isNativeObjectAppearanceValid(object, context) {
  const proof = object?.extensions?.stagecraftNativeAppearance;
  if (!exactKeys(proof, ['version', 'sourceFormat', 'appearanceResolved', 'input', 'fill', 'stroke'], ['adjust', 'text'])
    || proof.version !== NATIVE_APPEARANCE_VERSION
    || proof.sourceFormat !== 'pptx'
    || object.source?.format !== 'pptx'
    || proof.appearanceResolved !== true
    || typeof proof.input !== 'string'
    || inputBytes(proof.input) > NATIVE_APPEARANCE_INPUT_MAX_BYTES
    || proof.input !== nativeObjectAppearanceInput(object, context)
    || !validFill(proof.fill)
    || !validStroke(proof.stroke)) return false;
  if (proof.adjust !== undefined && (!exactKeys(proof.adjust, ['adj'])
    || !Number.isInteger(proof.adjust.adj) || proof.adjust.adj < 0 || proof.adjust.adj > 50000)) return false;
  if (!['shape', 'text'].includes(object.type)) return false;
  if (object.type === 'shape' && !['rect', 'ellipse', 'roundRect'].includes(object.shape)) return false;
  if (object.type === 'text' && object.shape !== undefined && object.shape !== 'rect') return false;
  if (object.bodyLayout?.autofit === 'shrink' && !nativeAutofitEffectiveFit(object)) return false;
  if (object.bodyLayout?.autofit !== 'shrink' && object.bodyLayout?.fit !== undefined) return false;
  if (!object.text) return proof.text === undefined;
  if (!exactKeys(proof.text, ['paragraphs']) || !Array.isArray(proof.text.paragraphs)
    || proof.text.paragraphs.length !== object.text.paragraphs.length) return false;
  return proof.text.paragraphs.every((paragraph, index) => validParagraphProof(paragraph, object.text.paragraphs[index]));
}

export function isNativeSlideAppearanceValid(slide, document) {
  const proof = slide?.extensions?.stagecraftSlideAppearance;
  const layout = document?.layouts?.find(item => item.id === slide?.layoutId);
  const master = document?.masters?.find(item => item.id === (slide?.masterId ?? layout?.masterId));
  const inheritedArtworkCount = (layout?.objects?.length ?? 0) + (master?.objects?.length ?? 0);
  return exactKeys(proof, ['version', 'appearanceResolved', 'input', 'background', 'inheritedArtworkCount'])
    && proof.version === NATIVE_APPEARANCE_VERSION
    && slide.source?.format === 'pptx'
    && proof.appearanceResolved === true
    && typeof proof.input === 'string'
    && inputBytes(proof.input) <= NATIVE_APPEARANCE_INPUT_MAX_BYTES
    && proof.input === nativeSlideAppearanceInput(slide, document)
    && isNativeAppearanceBackgroundValid(proof.background)
    && proof.inheritedArtworkCount === inheritedArtworkCount
    && inheritedArtworkCount === 0;
}

export function isNativeLayoutAppearanceValid(entity, document) {
  const proof = entity?.extensions?.stagecraftLayoutSummary;
  return exactKeys(proof, ['version', 'appearanceResolved', 'input', 'background', 'artworkCount'])
    && proof.version === NATIVE_APPEARANCE_VERSION
    && entity.source?.format === 'pptx'
    && proof.appearanceResolved === true
    && typeof proof.input === 'string'
    && inputBytes(proof.input) <= NATIVE_APPEARANCE_INPUT_MAX_BYTES
    && proof.input === nativeLayoutAppearanceInput(entity, document)
    && isNativeAppearanceBackgroundValid(proof.background)
    && Number.isSafeInteger(proof.artworkCount)
    && proof.artworkCount >= 0
    && proof.artworkCount === (entity.objects?.length ?? 0);
}

export function invalidateNativeObjectAppearance(object) {
  if (object?.extensions) delete object.extensions.stagecraftNativeAppearance;
}

export function invalidateNativeSlideAppearance(slide) {
  if (slide?.extensions) delete slide.extensions.stagecraftSlideAppearance;
}

export function invalidateNativeLayoutAppearance(entity) {
  if (entity?.extensions) delete entity.extensions.stagecraftLayoutSummary;
}
