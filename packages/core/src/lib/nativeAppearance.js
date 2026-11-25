export const NATIVE_APPEARANCE_VERSION = 1;
export const NATIVE_APPEARANCE_INPUT_MAX_BYTES = 16 * 1024;

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
  && !/[\u0000-\u001f\u007f]/.test(value);
const positiveSize = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 4000;
const sourceInput = source => source ? {
  format: source.format,
  part: source.part,
  path: source.path,
} : null;

/** Appearance-determining canonical inputs only: geometry and run text are deliberately excluded. */
export function nativeObjectAppearanceInput(object) {
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
        runs: paragraph.runs.map(run => ({
          id: run.id,
          source: sourceInput(run.source),
          style: run.style,
        })),
      })),
    } : null,
  });
}

export function nativeSlideAppearanceInput(slide) {
  return stableJson({
    source: sourceInput(slide.source),
    background: slide.background,
    layoutId: slide.layoutId,
    masterId: slide.masterId,
    themeId: slide.themeId,
    colorMap: slide.extensions?.pptxColorMap,
  });
}

export function nativeLayoutAppearanceInput(entity) {
  return stableJson({
    source: sourceInput(entity.source),
    masterId: entity.masterId,
    themeId: entity.themeId,
    colorMap: entity.extensions?.pptxColorMap,
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
const validStroke = value => validBackground(value) || exactKeys(value, ['kind', 'color', 'widthEmu'])
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
  ]) || paragraph.id !== canonical.id || !['left', 'center', 'right'].includes(paragraph.alignment)
    || !Array.isArray(paragraph.runIds)
    || paragraph.runIds.length !== canonical.runs.length
    || paragraph.runIds.some((id, index) => id !== canonical.runs[index].id)
    || !validResolvedRun(paragraph.endRun)) return false;
  for (const key of ['spaceBeforePt', 'spaceAfterPt', 'lineSpacingPct']) {
    if (paragraph[key] !== undefined && (typeof paragraph[key] !== 'number' || !Number.isFinite(paragraph[key]) || paragraph[key] < 0)) return false;
  }
  for (const key of ['indentStartEmu', 'indentEndEmu', 'firstLineIndentEmu']) {
    if (paragraph[key] !== undefined && (!Number.isSafeInteger(paragraph[key]) || Math.abs(paragraph[key]) > 10000000)) return false;
  }
  return canonical.runs.every(run => {
    const resolved = run.extensions?.pptxAppearance?.resolved;
    return record(resolved) && validResolvedRun(resolved);
  });
};

export function isNativeObjectAppearanceValid(object) {
  const proof = object?.extensions?.stagecraftNativeAppearance;
  if (!exactKeys(proof, ['version', 'sourceFormat', 'appearanceResolved', 'input', 'fill', 'stroke'], ['adjust', 'text'])
    || proof.version !== NATIVE_APPEARANCE_VERSION
    || proof.sourceFormat !== 'pptx'
    || object.source?.format !== 'pptx'
    || proof.appearanceResolved !== true
    || typeof proof.input !== 'string'
    || inputBytes(proof.input) > NATIVE_APPEARANCE_INPUT_MAX_BYTES
    || proof.input !== nativeObjectAppearanceInput(object)
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

export function isNativeSlideAppearanceValid(slide) {
  const proof = slide?.extensions?.stagecraftSlideAppearance;
  return exactKeys(proof, ['version', 'appearanceResolved', 'input', 'background', 'inheritedArtworkCount'])
    && proof.version === NATIVE_APPEARANCE_VERSION
    && slide.source?.format === 'pptx'
    && proof.appearanceResolved === true
    && typeof proof.input === 'string'
    && inputBytes(proof.input) <= NATIVE_APPEARANCE_INPUT_MAX_BYTES
    && proof.input === nativeSlideAppearanceInput(slide)
    && validBackground(proof.background)
    && proof.inheritedArtworkCount === 0;
}

export function isNativeLayoutAppearanceValid(entity) {
  const proof = entity?.extensions?.stagecraftLayoutSummary;
  return exactKeys(proof, ['version', 'appearanceResolved', 'input', 'background', 'artworkCount'])
    && proof.version === NATIVE_APPEARANCE_VERSION
    && entity.source?.format === 'pptx'
    && proof.appearanceResolved === true
    && typeof proof.input === 'string'
    && inputBytes(proof.input) <= NATIVE_APPEARANCE_INPUT_MAX_BYTES
    && proof.input === nativeLayoutAppearanceInput(entity)
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
