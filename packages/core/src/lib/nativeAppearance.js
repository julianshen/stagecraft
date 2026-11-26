export const NATIVE_APPEARANCE_VERSION = 1;
export const NATIVE_APPEARANCE_INPUT_MAX_BYTES = 16 * 1024;

const TEXT_SCRIPT_PATTERNS = [
  ['Arab', /\p{Script=Arab}/u], ['Hebr', /\p{Script=Hebr}/u], ['Thai', /\p{Script=Thai}/u],
  ['Deva', /\p{Script=Deva}/u], ['Beng', /\p{Script=Beng}/u], ['Taml', /\p{Script=Taml}/u],
  ['Telu', /\p{Script=Telu}/u], ['Knda', /\p{Script=Knda}/u], ['Mlym', /\p{Script=Mlym}/u],
  ['Gujr', /\p{Script=Gujr}/u], ['Guru', /\p{Script=Guru}/u], ['Cyrl', /\p{Script=Cyrillic}/u],
  ['Grek', /\p{Script=Greek}/u], ['Hani', /\p{Script=Han}/u], ['Hang', /\p{Script=Hangul}/u],
  ['Hira', /\p{Script=Hiragana}/u], ['Kana', /\p{Script=Katakana}/u], ['Latn', /\p{Script=Latin}/u],
];
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

/** Appearance-determining canonical inputs only: geometry and run text are deliberately excluded. */
export function nativeObjectAppearanceInput(object, context) {
  return stableJson({
    type: object.type,
    shape: object.shape,
    fill: object.fill,
    source: sourceInput(object.source),
    metrics: object.extensions?.pptxTextMetrics,
    bodyLayout: object.bodyLayout,
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
      layout: layout ? { id: layout.id, objects: (layout.objects ?? []).map(object => ({ id: object.id, type: object.type })), colorMap: layout.extensions?.pptxColorMap, colorMapOverride: layout.extensions?.pptxColorMapOverride } : null,
      master: master ? { id: master.id, objects: (master.objects ?? []).map(object => ({ id: object.id, type: object.type })), colorMap: master.extensions?.pptxColorMap, colorMapOverride: master.extensions?.pptxColorMapOverride } : null,
      theme: themeAppearanceInput(theme),
    } : undefined,
  });
}

export function nativeLayoutAppearanceInput(entity, document) {
  const master = document?.masters?.find(item => item.id === entity.masterId);
  const theme = document?.themes?.find(item => item.id === (entity.themeId ?? master?.themeId)) ?? document?.themes?.[0];
  return stableJson({
    source: sourceInput(entity.source),
    masterId: entity.masterId,
    themeId: entity.themeId,
    colorMap: entity.extensions?.pptxColorMap,
    colorMapOverride: entity.extensions?.pptxColorMapOverride,
    inheritedColorMap: master ? { ...(entity.extensions?.pptxColorMapOverride === 'master' ? {} : entity.extensions?.pptxColorMap), ...master.extensions?.pptxColorMap } : entity.extensions?.pptxColorMap,
    theme: document ? themeAppearanceInput(theme, entity.extensions?.pptxColorMap) : undefined,
    objects: (entity.objects ?? []).map(object => ({
      id: object.id,
      type: object.type,
      source: sourceInput(object.source),
    })),
  });
}

const validBackground = value => record(value) && (value.kind === 'none'
  ? Object.keys(value).length === 1
  : value.kind === 'solid' && exactKeys(value, ['kind', 'color']) && solidColor(value.color));
const validFill = value => validBackground(value);
const validStroke = value => value?.kind === 'none' && validBackground(value)
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
    return record(resolved) && validResolvedRun(resolved);
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
  if (!object.text) return proof.text === undefined;
  if (!exactKeys(proof.text, ['paragraphs']) || !Array.isArray(proof.text.paragraphs)
    || proof.text.paragraphs.length !== object.text.paragraphs.length) return false;
  return proof.text.paragraphs.every((paragraph, index) => validParagraphProof(paragraph, object.text.paragraphs[index]));
}

export function isNativeSlideAppearanceValid(slide, document) {
  const proof = slide?.extensions?.stagecraftSlideAppearance;
  return exactKeys(proof, ['version', 'appearanceResolved', 'input', 'background', 'inheritedArtworkCount'])
    && proof.version === NATIVE_APPEARANCE_VERSION
    && slide.source?.format === 'pptx'
    && proof.appearanceResolved === true
    && typeof proof.input === 'string'
    && inputBytes(proof.input) <= NATIVE_APPEARANCE_INPUT_MAX_BYTES
    && proof.input === nativeSlideAppearanceInput(slide, document)
    && validBackground(proof.background)
    && proof.inheritedArtworkCount === 0;
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
    && validBackground(proof.background)
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
