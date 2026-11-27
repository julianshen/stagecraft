import {
  NATIVE_APPEARANCE_INPUT_MAX_BYTES,
  nativeLayoutAppearanceInput,
  nativeObjectAppearanceInput,
  nativeSlideAppearanceInput,
  nativeTextScripts,
} from '@stagecraft/core/lib/nativeAppearance.js';
import { attrs, child, children, is, locate, xmlPart } from './xml.js';
import { readPptxColorMap, readPptxColorScheme, resolvePptxColor, resolvePptxSchemeColor } from './pptxColor.js';

const FILL_TAGS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];
const DEFAULT_COLOR_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
const UNSUPPORTED_BACKGROUND = Symbol('unsupported-background');
const NO_COLOR_OVERRIDE = Symbol('no-color-override');
const inputFits = value => new TextEncoder().encode(value).byteLength <= NATIVE_APPEARANCE_INPUT_MAX_BYTES;
const paragraphRuns = paragraph => children(paragraph).filter(node => !is(node, 'a', 'pPr') && !is(node, 'a', 'endParaRPr'));
const styleIndex = value => /^\d+$/.test(value ?? '') ? Number(value) - 1001 : -1;
const none = () => ({ kind: 'none' });
const onOff = value => value === '1' || value === 'true' ? true : value === '0' || value === 'false' ? false : null;
const SUPPLEMENTAL_SCRIPTS = { ar: 'Arab', fa: 'Arab', ur: 'Arab', he: 'Hebr', th: 'Thai', hi: 'Deva', mr: 'Deva', ne: 'Deva', bn: 'Beng', ta: 'Taml', te: 'Telu', kn: 'Knda', ml: 'Mlym', gu: 'Gujr', pa: 'Guru' };
const NON_SUPPLEMENTAL_LANGUAGES = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv', 'da', 'no', 'fi', 'pl', 'cs', 'sk', 'hu', 'ro', 'bg', 'ru', 'uk', 'tr', 'el', 'ja', 'ko', 'zh', 'id', 'ms', 'vi']);
const schemeHex = (palette, colorMap, slot) => palette?.[colorMap?.[slot] ?? slot] ?? null;

function themeFor(document, entity) {
  let current = entity;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.extensions?.pptxThemeOverride) return null;
    if (current.themeId) return document.themes.find(theme => theme.id === current.themeId) ?? null;
    const layout = current.layoutId ? document.layouts.find(item => item.id === current.layoutId) : null;
    current = layout ?? (current.masterId ? document.masters.find(item => item.id === current.masterId) : null);
  }
  return null;
}

function colorMapFor(document, entity) {
  const chain = [];
  const seen = new Set();
  let current = entity;
  while (current && !seen.has(current.id)) {
    if (current.extensions?.pptxColorMapOverride === 'unsupported') return null;
    seen.add(current.id);
    if (current.extensions?.pptxColorMapOverride === 'master') {
      const layout = current.layoutId ? document.layouts.find(item => item.id === current.layoutId) : null;
      current = layout ?? (current.masterId ? document.masters.find(master => master.id === current.masterId) : null);
      continue;
    }
    chain.unshift(current);
    if (current.layoutId) current = document.layouts.find(layout => layout.id === current.layoutId);
    else current = current.masterId ? document.masters.find(master => master.id === current.masterId) : null;
  }
  const map = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  for (const item of chain) Object.assign(map, item.extensions?.pptxColorMap);
  return map;
}

function simpleFill(parent, theme, colorMap, allowPlaceholder = false) {
  const fills = FILL_TAGS.includes(parent.localName) ? [parent] : children(parent).filter(node => FILL_TAGS.includes(node.localName));
  if (fills.length > 1) return null;
  if (!fills.length) return none();
  if (is(fills[0], 'a', 'noFill')) return none();
  if (!is(fills[0], 'a', 'solidFill') || children(fills[0]).length !== 1) return null;
  const colorNode = children(fills[0])[0];
  if (allowPlaceholder && is(colorNode, 'a', 'phClr')) return { kind: 'placeholder' };
  const color = resolvePptxColor(colorNode, theme?.extensions?.pptxColorScheme, colorMap);
  return color ? { kind: 'solid', color } : null;
}

function fillFromStyle(styles, index) {
  if (index < 0 || index >= (styles?.length ?? 0)) return null;
  const value = styles[index];
  return value && ['none', 'solid', 'placeholder'].includes(value.kind) ? { ...value } : null;
}

function simpleStroke(node, theme = {}, colorMap = {}, allowPlaceholder = false) {
  if (!node) return none();
  if (node.hasAttribute('cmpd') && node.getAttribute('cmpd') !== 'sng') return null;
  if (node.hasAttribute('algn') && node.getAttribute('algn') !== 'ctr') return null;
  for (const item of children(node)) {
    if (['solidFill', 'noFill', 'prstDash'].includes(item.localName)) continue;
    return null;
  }
  const dash = child(node, 'a', 'prstDash');
  if (dash && dash.getAttribute('val') !== 'solid') return null;
  const fill = simpleFill(node, theme, colorMap, allowPlaceholder);
  if (!fill) return null;
  if (fill.kind === 'none') return none();
  const width = node.getAttribute('w');
  if (!/^\d+$/.test(width ?? '') || !Number.isSafeInteger(Number(width)) || Number(width) <= 0) return null;
  if (fill.kind === 'placeholder') return { kind: 'placeholder', widthEmu: Number(width) };
  return { kind: 'solid', color: fill.color, widthEmu: Number(width) };
}

function strokeFromStyle(styles, index) {
  if (index < 0 || index >= (styles?.length ?? 0)) return null;
  const value = styles[index];
  return value && ['none', 'solid', 'placeholder'].includes(value.kind) ? { ...value } : null;
}

function referenceColor(node, theme, colorMap) {
  if (!node || children(node).length === 0) return NO_COLOR_OVERRIDE;
  if (children(node).length !== 1) return null;
  return resolvePptxColor(children(node)[0], theme?.extensions?.pptxColorScheme, colorMap);
}

function projectedAdjust(geometry) {
  const childrenOfGeometry = children(geometry);
  if (childrenOfGeometry.length !== 1 || childrenOfGeometry.some(node => !is(node, 'a', 'avLst'))) return null;
  const adjustments = childrenOfGeometry.flatMap(node => children(node));
  const result = {};
  for (const adjustment of adjustments) {
    if (!is(adjustment, 'a', 'gd') || adjustment.getAttribute('name') !== 'adj') return null;
    const match = /^val\s+(\d+)$/.exec(adjustment.getAttribute('fmla') ?? '');
    if (!match || !Number.isInteger(Number(match[1])) || Number(match[1]) < 0 || Number(match[1]) > 50000) return null;
    result.adj = Number(match[1]);
  }
  return result;
}

async function projectTheme(document, load) {
  for (const theme of document.themes) {
    if (!theme.source?.part) continue;
    const root = (await load(theme.source.part)).documentElement;
    const palette = readPptxColorScheme(root);
    const format = child(child(root, 'a', 'themeElements'), 'a', 'fmtScheme');
    const projectStyles = (tag, stroke = false) => children(child(format, 'a', tag)).map(node => {
      if (stroke) return simpleStroke(node, { extensions: { pptxColorScheme: palette } }, DEFAULT_COLOR_MAP, true);
      if (is(node, 'a', 'noFill')) return none();
      if (!is(node, 'a', 'solidFill') || children(node).length !== 1) return null;
      const color = resolvePptxColor(children(node)[0], palette, DEFAULT_COLOR_MAP);
      return color ? { kind: 'solid', color } : null;
    });
    theme.extensions = {
      ...theme.extensions,
      pptxColorScheme: palette,
      pptxFillStyles: projectStyles('fillStyleLst'),
      pptxLineStyles: projectStyles('lnStyleLst', true),
      pptxBackgroundFillStyles: projectStyles('bgFillStyleLst'),
    };
  }
}

async function themeStyleVectors(theme, colorMap, load) {
  if (!theme?.source?.part || !colorMap) return null;
  const root = (await load(theme.source.part)).documentElement;
  const format = child(child(root, 'a', 'themeElements'), 'a', 'fmtScheme');
  const fills = children(child(format, 'a', 'fillStyleLst')).map(node => simpleFill(node, theme, colorMap, true));
  const lines = children(child(format, 'a', 'lnStyleLst')).map(node => simpleStroke(node, theme, colorMap, true));
  const backgrounds = children(child(format, 'a', 'bgFillStyleLst')).map(node => simpleFill(node, theme, colorMap, true));
  return { fills, lines, backgrounds };
}

async function projectEntityBackgrounds(document, load) {
  const own = new Map();
  const presentationPart = document.relationships.find(item => item.type.endsWith('/officeDocument'))?.target;
  if (presentationPart) {
    try {
      const root = (await load(presentationPart)).documentElement;
      const theme = document.themes[0] ?? null;
      document.extensions.pptxDefaultTextStyle = inheritedTextStyle(child(root, 'p', 'defaultTextStyle'), theme, colorMapFor(document, null));
    } catch { document.extensions.pptxDefaultTextStyle = null; }
  }
  for (const entity of [...document.masters, ...document.layouts, ...document.slides]) {
    if (!entity.source?.part) continue;
    const root = (await load(entity.source.part)).documentElement;
    const colorMap = readPptxColorMap(child(root, 'p', 'clrMap'));
    const colorOverride = child(root, 'p', 'clrMapOvr');
    const overrideMapping = colorOverride ? child(colorOverride, 'a', 'overrideClrMapping') : null;
    const masterMapping = colorOverride ? child(colorOverride, 'a', 'masterClrMapping') : null;
    const unsupportedMapping = colorOverride && !overrideMapping && !masterMapping;
    entity.extensions = {
      ...entity.extensions,
      ...(Object.keys(colorMap).length ? { pptxColorMap: colorMap } : {}),
      ...(overrideMapping ? { pptxColorMap: readPptxColorMap(overrideMapping), pptxColorMapOverride: 'mapping' } : {}),
      ...(masterMapping ? { pptxColorMapOverride: 'master' } : {}),
      ...(unsupportedMapping ? { pptxColorMapOverride: 'unsupported' } : {}),
    };
    if (unsupportedMapping) {
      own.set(entity.id, UNSUPPORTED_BACKGROUND);
      continue;
    }
    const entityColorMap = colorMapFor(document, entity);
    if (entity.kind !== 'slides') {
      const theme = themeFor(document, entity);
      entity.extensions.pptxOtherTextStyle = inheritedTextStyle(child(child(root, 'p', 'txStyles'), 'p', 'otherStyle'), theme, entityColorMap);
    }
    const theme = themeFor(document, entity);
    const bg = child(child(root, 'p', 'cSld'), 'p', 'bg');
    let value;
    if (bg) {
      const ref = child(bg, 'p', 'bgRef');
      if (ref) {
        const vectors = await themeStyleVectors(theme, entityColorMap, load);
        value = vectors ? (fillFromStyle(vectors.backgrounds, styleIndex(ref.getAttribute('idx'))) ?? UNSUPPORTED_BACKGROUND) : UNSUPPORTED_BACKGROUND;
      } else {
        const bgPr = child(bg, 'p', 'bgPr');
        value = bgPr && children(bgPr).every(item => FILL_TAGS.includes(item.localName))
          ? (simpleFill(bgPr, theme, entityColorMap) ?? UNSUPPORTED_BACKGROUND) : UNSUPPORTED_BACKGROUND;
      }
    }
    own.set(entity.id, value);
  }
  return own;
}

function effectiveBackground(document, entity, own, fallback = null, seen = new Set()) {
  if (seen.has(entity.id)) return null;
  seen.add(entity.id);
  if (own.has(entity.id)) {
    const value = own.get(entity.id);
    if (value === UNSUPPORTED_BACKGROUND) return null;
    if (value !== undefined) return value;
  }
  if (entity.extensions?.pptxColorMapOverride) return null;
  const layout = entity.layoutId ? document.layouts.find(item => item.id === entity.layoutId) : null;
  if (layout) return effectiveBackground(document, layout, own, fallback, seen);
  if (entity.masterId) {
    const master = document.masters.find(item => item.id === entity.masterId);
    if (master) return effectiveBackground(document, master, own, fallback, seen);
  }
  if (fallback) return fallback;
  const theme = themeFor(document, entity);
  const colorMap = colorMapFor(document, entity);
  const color = schemeHex(theme?.extensions?.pptxColorScheme, colorMap, 'bg1');
  return color ? { kind: 'solid', color } : null;
}

const normalizeFont = value => {
  const font = typeof value === 'string' ? value.trim() : '';
  return font && font.length <= 64 && !font.startsWith('+') && !/[\u0000-\u001f\u007f]/.test(font) ? font : null;
};

const resolveFontAlias = (value, theme, script = null) => {
  const font = typeof value === 'string' ? value.trim() : '';
  const alias = /^\+(mj|mn)-(lt|ea|cs)$/.exec(font);
  if (!alias) return normalizeFont(font);
  const fonts = theme?.extensions?.pptxFontScheme;
  const group = alias[1] === 'mj' ? 'major' : 'minor';
  const target = alias[2] === 'lt' ? 'latin' : alias[2] === 'ea' ? 'eastAsian' : 'complexScript';
  const selected = fonts?.[group]?.[target];
  if (target === 'eastAsian' && !selected) {
    const supplemental = fonts?.[group]?.supplemental ?? {};
    if (['Jpan', 'Hang', 'Hani'].some(script => supplemental[script])) return null;
  }
  if (target === 'complexScript' && !selected && script) {
    const supplemental = fonts?.[group]?.supplemental?.[script];
    if (supplemental) return normalizeFont(supplemental);
  }
  return normalizeFont(selected || fonts?.[group]?.latin);
};

function resolveFont(direct, theme, fontRef, slot, inheritedFont = null, script = null) {
  const fonts = theme?.extensions?.pptxFontScheme;
  const value = direct?.getAttribute('typeface');
  if (value) return resolveFontAlias(value, theme, script);
  if (inheritedFont) return resolveFontAlias(inheritedFont, theme, script);
  if (slot === 'eastAsian' && !fonts?.[fontRef]?.eastAsian) {
    const supplemental = fonts?.[fontRef]?.supplemental ?? {};
    if (['Jpan', 'Hang', 'Hani'].some(script => supplemental[script])) return null;
  }
  return normalizeFont(fonts?.[fontRef]?.[slot] || fonts?.[fontRef]?.latin);
}

function projectRunOverrides(properties, theme, colorMap) {
  if (!properties) return {};
  if (Object.keys(attrs(properties)).some(key => !['lang', 'altLang', 'sz', 'b', 'i', 'dirty', 'smtClean', 'u', 'kern'].includes(key))) return null;
  if (properties.hasAttribute('u') && properties.getAttribute('u') !== 'none') return null;
  if (properties.hasAttribute('kern') && properties.getAttribute('kern') !== '1200') return null;
  const out = {};
  if (properties.hasAttribute('lang')) out.language = properties.getAttribute('lang');
  const size = properties.getAttribute('sz');
  if (size !== null) {
    if (!/^\d+$/.test(size) || !Number.isInteger(Number(size)) || Number(size) < 100 || Number(size) > 400000) return null;
    out.fontSizePt = Number(size) / 100;
  }
  if (properties.hasAttribute('b')) {
    const bold = onOff(properties.getAttribute('b'));
    if (bold === null) return null;
    out.bold = bold;
  }
  if (properties.hasAttribute('i')) {
    const italic = onOff(properties.getAttribute('i'));
    if (italic === null) return null;
    out.italic = italic;
  }
  for (const item of children(properties)) {
    if (is(item, 'a', 'solidFill')) {
      if (children(item).length !== 1) return null;
      const colorNode = children(item)[0];
      if (is(colorNode, 'a', 'schemeClr')) {
        if (colorNode.getAttribute('val') === 'phClr') return null;
        const transforms = children(colorNode).map(transform => ({ name: transform.localName, raw: transform.getAttribute('val') }));
        if (transforms.some(transform => !['lumMod', 'lumOff'].includes(transform.name)
          || !/^\d+$/.test(transform.raw ?? '') || !Number.isSafeInteger(Number(transform.raw)))) return null;
        out.colorDefinition = { scheme: colorNode.getAttribute('val'), transforms };
      } else {
        const color = resolvePptxColor(colorNode, theme?.extensions?.pptxColorScheme, colorMap);
        if (!color) return null;
        out.color = color;
      }
    } else if (['latin', 'ea', 'cs'].includes(item.localName)) {
      const slot = item.localName === 'latin' ? 'latin' : item.localName === 'ea' ? 'eastAsian' : 'complexScript';
      const key = slot === 'latin' ? 'fontFamily' : slot === 'eastAsian' ? 'fontFamilyEastAsia' : 'fontFamilyComplexScript';
      const rawFont = item.getAttribute('typeface')?.trim();
      if (rawFont?.startsWith('+') && !/^\+(mj|mn)-(lt|ea|cs)$/.test(rawFont)) return null;
      const font = rawFont?.startsWith('+') ? rawFont : normalizeFont(rawFont);
      if (!font) return null;
      out[key] = font;
    } else return null;
  }
  return out;
}

function mergeInheritedStyles(...styles) {
  const merged = {};
  for (const style of styles) {
    if (!style) continue;
    if (Object.hasOwn(style, 'color') || Object.hasOwn(style, 'colorDefinition')) {
      delete merged.color;
      delete merged.colorDefinition;
    }
    Object.assign(merged, style);
  }
  return merged;
}

function inheritedTextStyle(styleRoot, theme, colorMap) {
  if (!styleRoot) return {};
  const defaults = { marL: '0', algn: 'l', defTabSz: '914400', rtl: '0', eaLnBrk: '1', latinLnBrk: '0', hangingPunct: '1' };
  const base = child(styleRoot, 'a', 'defPPr');
  const level = child(styleRoot, 'a', 'lvl1pPr');
  for (const properties of [base, level]) {
    if (!properties) continue;
    if (Object.entries(attrs(properties)).some(([key, value]) => defaults[key] !== value)) return null;
    if (children(properties).some(item => !['defRPr', 'buNone'].includes(item.localName))) return null;
  }
  const baseStyle = projectRunOverrides(base ? child(base, 'a', 'defRPr') : null, theme, colorMap);
  const levelStyle = projectRunOverrides(level ? child(level, 'a', 'defRPr') : null, theme, colorMap);
  if (baseStyle === null || levelStyle === null) return null;
  return mergeInheritedStyles(baseStyle, levelStyle);
}

function resolveRunFont(runProperties, fallbackProperties, theme, fontRef, slot, inheritedFont, script = null) {
  const direct = (runProperties ? child(runProperties, 'a', slot) : null)
    ?? (fallbackProperties ? child(fallbackProperties, 'a', slot) : null);
  const themeSlot = slot === 'ea' ? 'eastAsian' : slot === 'cs' ? 'complexScript' : slot;
  return resolveFont(direct, theme, fontRef, themeSlot, inheritedFont, script);
}

function resolvedRun(runProperties, fallbackProperties, theme, colorMap, fontRef, baseColor = null, inherited = {}, text = '') {
  const rawSize = runProperties?.getAttribute('sz') ?? fallbackProperties?.getAttribute('sz');
  const size = rawSize ?? (inherited.fontSizePt === undefined ? null : String(Math.round(inherited.fontSizePt * 100)));
  if (!/^\d+$/.test(size ?? '') || !Number.isInteger(Number(size)) || Number(size) < 100 || Number(size) > 400000) return null;
  for (const properties of [runProperties, fallbackProperties]) {
    if (!properties) continue;
    if (Object.keys(attrs(properties)).some(key => !['lang', 'altLang', 'sz', 'b', 'i', 'dirty', 'smtClean', 'u', 'kern'].includes(key))) return null;
    for (const node of children(properties)) {
      if (!['latin', 'ea', 'cs', 'solidFill'].includes(node.localName)) return null;
    }
    if (properties.hasAttribute('u') && properties.getAttribute('u') !== 'none') return null;
    if (properties.hasAttribute('kern') && properties.getAttribute('kern') !== '1200') return null;
  }
  const directFill = runProperties ? child(runProperties, 'a', 'solidFill') : null;
  const fallbackFill = fallbackProperties ? child(fallbackProperties, 'a', 'solidFill') : null;
  const colorNode = directFill ? children(directFill)[0] : fallbackFill ? children(fallbackFill)[0] : null;
  const inheritedColor = inherited.colorDefinition
    ? resolvePptxSchemeColor(inherited.colorDefinition.scheme, inherited.colorDefinition.transforms, theme?.extensions?.pptxColorScheme, colorMap)
    : inherited.color;
  const color = colorNode ? resolvePptxColor(colorNode, theme?.extensions?.pptxColorScheme, colorMap)
    : baseColor ?? (Object.hasOwn(inherited, 'colorDefinition') ? inheritedColor : inherited.color ?? schemeHex(theme?.extensions?.pptxColorScheme, colorMap, 'tx1'));
  const rawBold = runProperties?.getAttribute('b') ?? fallbackProperties?.getAttribute('b');
  const rawItalic = runProperties?.getAttribute('i') ?? fallbackProperties?.getAttribute('i');
  const bold = rawBold == null ? inherited.bold ?? false : onOff(rawBold);
  const italic = rawItalic == null ? inherited.italic ?? false : onOff(rawItalic);
  if (bold === null || italic === null) return null;
  const language = runProperties?.getAttribute('lang') ?? fallbackProperties?.getAttribute('lang') ?? inherited.language;
  const primary = language?.toLowerCase().split('-')[0];
  const detectedScripts = nativeTextScripts(text);
  if (detectedScripts.length !== 1 || detectedScripts[0] === 'Other') return null;
  const detectedScript = detectedScripts[0];
  const supplementalScript = detectedScript === 'Latn' ? null : detectedScript;
  if (primary && !SUPPLEMENTAL_SCRIPTS[primary] && !NON_SUPPLEMENTAL_LANGUAGES.has(primary)) return null;
  const fontFamily = resolveRunFont(runProperties, fallbackProperties, theme, fontRef, 'latin', inherited.fontFamily, detectedScript);
  const fontFamilyEastAsia = resolveRunFont(runProperties, fallbackProperties, theme, fontRef, 'ea', inherited.fontFamilyEastAsia, detectedScript);
  const fontFamilyComplexScript = resolveRunFont(runProperties, fallbackProperties, theme, fontRef, 'cs', inherited.fontFamilyComplexScript, detectedScript);
  const supplementalFont = supplementalScript ? theme.extensions.pptxFontScheme?.[fontRef]?.supplemental?.[supplementalScript] : null;
  const explicitComplexScript = child(runProperties, 'a', 'cs') || child(fallbackProperties, 'a', 'cs') || inherited.fontFamilyComplexScript;
  const resolvedComplexScript = !explicitComplexScript && supplementalFont ? normalizeFont(supplementalFont) : fontFamilyComplexScript;
  if (!color || !fontFamily || !fontFamilyEastAsia || !resolvedComplexScript) return null;
  return {
    color,
    fontFamily,
    fontFamilyEastAsia,
    fontFamilyComplexScript: resolvedComplexScript,
    fontSizePt: Number(size) / 100,
    bold,
    italic,
  };
}

function supportedTextXml(node, body, theme) {
  const txBox = ['1', 'true'].includes(child(child(node, 'p', 'nvSpPr'), 'p', 'cNvSpPr')?.getAttribute('txBox'));
  if (theme?.extensions?.pptxObjectDefaults?.[txBox ? 'txDef' : 'spDef']) return false;
  const bodyPr = child(body, 'a', 'bodyPr');
  const anchor = bodyPr?.getAttribute('anchor');
  const insetAttributes = ['lIns', 'rIns', 'tIns', 'bIns'];
  if (!bodyPr || anchor !== null && !['t', 'ctr', 'b'].includes(anchor)
    || insetAttributes.some(name => bodyPr?.hasAttribute(name) && !/^\d+$/.test(bodyPr.getAttribute(name)))
    || Object.keys(attrs(bodyPr)).some(attribute => !['wrap', 'anchor', ...insetAttributes].includes(attribute))
    || children(bodyPr).some(item => !is(item, 'a', 'noAutofit'))) return false;
  for (const paragraph of children(body).filter(item => is(item, 'a', 'p'))) {
    if (children(paragraph).some(item => !is(item, 'a', 'pPr') && !is(item, 'a', 'r') && !is(item, 'a', 'endParaRPr'))) return false;
    const properties = child(paragraph, 'a', 'pPr');
    if (properties) {
      if (Object.keys(attrs(properties)).some(attribute => !['algn', 'lvl', 'marL', 'marR', 'indent'].includes(attribute))) return false;
      if (properties.hasAttribute('algn') && !['l', 'ctr', 'r', 'just'].includes(properties.getAttribute('algn'))) return false;
      if (properties.hasAttribute('lvl') && properties.getAttribute('lvl') !== '0') return false;
      for (const item of children(properties)) {
        if (['lnSpc', 'spcBef', 'spcAft'].includes(item.localName)) {
          const expected = { lnSpc: 'spcPct', spcBef: 'spcPts', spcAft: 'spcPts' }[item.localName];
          if (children(item).length !== 1 || !is(children(item)[0], 'a', expected)) return false;
        } else if (!['buNone', 'defRPr'].includes(item.localName)) return false;
      }
    }
    const end = child(paragraph, 'a', 'endParaRPr');
    if (end && (Object.keys(attrs(end)).some(attribute => !['lang', 'dirty', 'sz', 'b', 'i'].includes(attribute))
      || children(end).some(item => !['latin', 'ea', 'cs', 'solidFill'].includes(item.localName)))) return false;
    for (const run of paragraphRuns(paragraph)) {
      const runProperties = child(run, 'a', 'rPr');
      if (runProperties && (Object.keys(attrs(runProperties)).some(attribute => !['lang', 'altLang', 'sz', 'b', 'i', 'dirty', 'smtClean', 'u'].includes(attribute))
        || children(runProperties).some(item => !['latin', 'ea', 'cs', 'solidFill'].includes(item.localName)))) return false;
      if (children(run).some(item => !is(item, 'a', 'rPr') && !is(item, 'a', 't') && !is(item, 'a', 'br'))) return false;
    }
  }
  return true;
}

function projectText(document, object, node, slide, theme, colorMap) {
  const body = child(node, 'p', 'txBody');
  if (!body || !colorMap) return null;
  const layout = slide.layoutId ? document.layouts.find(item => item.id === slide.layoutId) : null;
  const master = layout?.masterId ? document.masters.find(item => item.id === layout.masterId) : null;
  if (document.extensions.pptxDefaultTextStyle === null || layout?.extensions.pptxOtherTextStyle === null || master?.extensions.pptxOtherTextStyle === null) return null;
  const inherited = mergeInheritedStyles(
    document.extensions.pptxDefaultTextStyle,
    master?.extensions.pptxOtherTextStyle,
    layout?.extensions.pptxOtherTextStyle,
  );
  if (object.bodyLayout?.autofit === 'shrink' || object.bodyLayout?.autofit === 'resize') return null;
  if (!supportedTextXml(node, body, theme) || allPlaceholdersOrLists(node)) return null;
  let fontRef = object.extensions.pptxTextMetrics.fontRef;
  const styleNode = child(node, 'p', 'style');
  const fontRefNode = styleNode ? child(styleNode, 'a', 'fontRef') : null;
  if (fontRefNode) {
    const raw = fontRefNode.getAttribute('idx');
    const index = raw === 'major' ? 0 : raw === 'minor' ? 1 : styleIndex(raw);
    if (index !== 0 && index !== 1) return null;
    fontRef = index === 0 ? 'major' : 'minor';
  }
  const fontRefColor = referenceColor(fontRefNode, theme, colorMap);
  if (fontRefColor === null) return null;
  const baseColor = fontRefColor === NO_COLOR_OVERRIDE ? null : fontRefColor;
  const paragraphs = [];
  for (const [index, paragraph] of object.text.paragraphs.entries()) {
    const xmlParagraph = children(body).filter(item => is(item, 'a', 'p'))[index];
    if (!xmlParagraph) return null;
    const properties = child(xmlParagraph, 'a', 'pPr');
    const defaults = properties ? child(properties, 'a', 'defRPr') : null;
    const end = child(xmlParagraph, 'a', 'endParaRPr');
    const style = paragraph.style ?? {};
    for (const [runIndex, run] of paragraph.runs.entries()) {
      const xmlRun = children(xmlParagraph).filter(item => is(item, 'a', 'r'))[runIndex];
      const runProperties = xmlRun ? child(xmlRun, 'a', 'rPr') : null;
      const scripts = nativeTextScripts(run.text);
      if (scripts.length !== 1 || scripts[0] === 'Other') return null;
      const script = scripts[0];
      const value = resolvedRun(runProperties, defaults, theme, colorMap, fontRef, baseColor, inherited, run.text);
      if (!value) return null;
      run.extensions = { ...run.extensions, pptxAppearance: { ...run.extensions?.pptxAppearance, resolved: value, script } };
    }
    const lastRun = paragraph.runs.at(-1);
    const lastXmlRun = children(xmlParagraph).filter(item => is(item, 'a', 'r')).at(-1);
    const endValue = resolvedRun(end ?? (lastXmlRun ? child(lastXmlRun, 'a', 'rPr') : null), defaults, theme, colorMap, fontRef, baseColor, inherited, lastRun?.text ?? '');
    if (!endValue) return null;
    paragraphs.push({
      id: paragraph.id,
      runIds: paragraph.runs.map(run => run.id),
      alignment: style.alignment ?? 'left',
      spaceBeforePt: style.spaceBefore ?? 0,
      spaceAfterPt: style.spaceAfter ?? 0,
      lineSpacingPct: style.lineSpacing ?? 100,
      indentStartEmu: style.indentStart ?? 0,
      indentEndEmu: style.indentEnd ?? 0,
      firstLineIndentEmu: style.firstLineIndent ?? 0,
      endRun: { ...endValue },
    });
    paragraph.extensions = { ...paragraph.extensions, pptxEndRunAppearance: { ...endValue } };
  }
  return { paragraphs };
}

function allPlaceholdersOrLists(node) {
  if (Array.from(node.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'ph')).length) return true;
  return Array.from(node.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'lstStyle'))
    .some(item => item.children.length > 0);
}

async function projectObject(document, object, slide, load) {
  if (!object.source?.part || !['shape', 'text'].includes(object.type)) return;
  const node = locate(await load(object.source.part), object.source.path);
  if (!is(node, 'p', 'sp') || allPlaceholdersOrLists(node)) return;
  const hidden = child(child(node, 'p', 'nvSpPr'), 'p', 'cNvPr')?.getAttribute('hidden');
  if (hidden !== null && hidden !== undefined && onOff(hidden) !== false) return;
  const props = child(node, 'p', 'spPr');
  const xfrm = child(props, 'a', 'xfrm');
  if (!props || !xfrm || ['flipH', 'flipV'].some(name => xfrm.hasAttribute(name) && onOff(xfrm.getAttribute(name)) !== false)) return;
  if (['effectLst', 'effectDag', 'scene3d', 'sp3d'].some(tag => child(props, 'a', tag))) return;
  const geometries = children(props).filter(item => is(item, 'a', 'prstGeom') || is(item, 'a', 'custGeom'));
  if (geometries.length !== 1 || !is(geometries[0], 'a', 'prstGeom')) return;
  const preset = geometries[0].getAttribute('prst');
  if (!['rect', 'ellipse', 'roundRect'].includes(preset)) return;
  const adjust = projectedAdjust(geometries[0]);
  if (!adjust || (preset !== 'roundRect' && Object.keys(adjust).length)) return;
  const body = child(node, 'p', 'txBody');
  if (body && preset !== 'rect') return;
  const style = child(node, 'p', 'style');
  if (style && children(style).some(item => !['fillRef', 'lnRef', 'fontRef'].includes(item.localName))) return;
  const theme = themeFor(document, slide);
  if (!theme || theme.extensions.pptxObjectDefaults?.spDef) return;
  const colorMap = colorMapFor(document, slide);
  if (!colorMap) return;
  const vectors = await themeStyleVectors(theme, colorMap, load);
  if (!vectors) return;
  const hasDirectFill = children(props).some(item => FILL_TAGS.includes(item.localName));
  const fillRef = style ? child(style, 'a', 'fillRef') : null;
  const fillOverride = referenceColor(fillRef, theme, colorMap);
  if (fillOverride === null) return;
  let fill;
  if (hasDirectFill) fill = simpleFill(props, theme, colorMap);
  else if (fillRef) {
    const base = fillFromStyle(vectors.fills, styleIndex(fillRef.getAttribute('idx')));
    if (!base || base.kind === 'placeholder' && fillOverride === NO_COLOR_OVERRIDE) return;
    if (fillOverride !== NO_COLOR_OVERRIDE && base.kind !== 'placeholder') return;
    fill = fillOverride === NO_COLOR_OVERRIDE ? base : { kind: 'solid', color: fillOverride };
  } else fill = none();
  if (!fill) return;
  const line = child(props, 'a', 'ln');
  const lineRef = style ? child(style, 'a', 'lnRef') : null;
  const lineOverride = referenceColor(lineRef, theme, colorMap);
  if (lineOverride === null) return;
  let stroke;
  if (line) {
    if (lineRef && !children(line).some(item => FILL_TAGS.includes(item.localName))) return;
    stroke = simpleStroke(line, theme, colorMap);
  } else if (lineRef) {
    const base = strokeFromStyle(vectors.lines, styleIndex(lineRef.getAttribute('idx')));
    if (!base || base.kind === 'placeholder' && lineOverride === NO_COLOR_OVERRIDE) return;
    if (lineOverride !== NO_COLOR_OVERRIDE && base.kind !== 'placeholder') return;
    stroke = lineOverride === NO_COLOR_OVERRIDE ? base : { kind: 'solid', color: lineOverride, widthEmu: base.widthEmu };
  } else stroke = none();
  if (!stroke) return;
  const text = body ? projectText(document, object, node, slide, theme, colorMap) : null;
  if (body && !text) return;
  if (!body) {
    object.type = 'shape';
    object.shape = preset;
  }
  const appearance = {
    version: 1,
    sourceFormat: 'pptx',
    appearanceResolved: true,
    input: nativeObjectAppearanceInput(object, { theme, colorMap, document, slide }),
    fill,
    stroke,
    ...(Object.keys(adjust).length ? { adjust } : {}),
    ...(text ? { text } : {}),
  };
  if (inputFits(appearance.input)) object.extensions = { ...object.extensions, stagecraftNativeAppearance: appearance };
}

export async function projectNativeAppearance(document, zip, xml) {
  if (document.extensions?.sourceFormat !== 'pptx') return;
  const parts = new Map();
  const load = part => {
    if (!parts.has(part)) parts.set(part, xmlPart(zip, part, xml));
    return parts.get(part);
  };
  try { await projectTheme(document, load); }
  catch { /* Appearance projection must never prevent opening a valid package. */ }
  let ownBackgrounds = new Map();
  try { ownBackgrounds = await projectEntityBackgrounds(document, load); }
  catch { ownBackgrounds = new Map(); }
  for (const master of document.masters) {
    try {
      const background = effectiveBackground(document, master, ownBackgrounds);
      if (!background) continue;
      master.extensions = {
        ...master.extensions,
        stagecraftLayoutSummary: {
          version: 1, appearanceResolved: true, input: nativeLayoutAppearanceInput(master, document), background, artworkCount: master.objects.length,
        },
      };
    } catch { /* Unresolved inheritance stays unproved. */ }
  }
  for (const layout of document.layouts) {
    try {
      const background = effectiveBackground(document, layout, ownBackgrounds);
      if (!background) continue;
      layout.extensions = {
        ...layout.extensions,
        stagecraftLayoutSummary: {
          version: 1, appearanceResolved: true, input: nativeLayoutAppearanceInput(layout, document), background, artworkCount: layout.objects.length,
        },
      };
    } catch { /* Unresolved inheritance stays unproved. */ }
  }
  for (const slide of document.slides) {
    if (!slide.source) continue;
    try {
      const layout = slide.layoutId ? document.layouts.find(item => item.id === slide.layoutId) : null;
      const master = layout?.masterId ? document.masters.find(item => item.id === layout.masterId) : null;
      const artworkCount = (layout?.objects?.length ?? 0) + (master?.objects?.length ?? 0);
      const background = effectiveBackground(document, slide, ownBackgrounds);
      if (background && artworkCount === 0) {
        slide.extensions = {
          ...slide.extensions,
          stagecraftSlideAppearance: {
            version: 1, appearanceResolved: true, input: nativeSlideAppearanceInput(slide, document), background, inheritedArtworkCount: 0,
          },
        };
      }
    } catch { /* Unresolved slide appearance stays unproved. */ }
    for (const object of slide.objects) {
      try { await projectObject(document, object, slide, load); }
      catch { /* Unsupported appearance stays opaque and refuses the scene later. */ }
    }
  }
}
