import {
  NATIVE_APPEARANCE_INPUT_MAX_BYTES,
  nativeLayoutAppearanceInput,
  nativeObjectAppearanceInput,
  nativeSlideAppearanceInput,
} from '@stagecraft/core/lib/nativeAppearance.js';
import { attrs, child, children, is, locate, xmlPart } from './xml.js';
import { readPptxColorMap, readPptxColorScheme, resolvePptxColor } from './pptxColor.js';

const FILL_TAGS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];
const DEFAULT_COLOR_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
const inputFits = value => new TextEncoder().encode(value).byteLength <= NATIVE_APPEARANCE_INPUT_MAX_BYTES;
const paragraphRuns = paragraph => children(paragraph).filter(node => !is(node, 'a', 'pPr') && !is(node, 'a', 'endParaRPr'));
const styleIndex = value => /^\d+$/.test(value ?? '') ? Number(value) - 1001 : -1;
const none = () => ({ kind: 'none' });
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
    seen.add(current.id);
    chain.unshift(current);
    if (current.layoutId) {
      current = document.layouts.find(layout => layout.id === current.layoutId);
      if (current) {
        chain.unshift(current);
        current = current.masterId ? document.masters.find(master => master.id === current.masterId) : null;
      }
    } else {
      current = current.masterId ? document.masters.find(master => master.id === current.masterId) : null;
    }
  }
  const map = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  for (const item of chain) Object.assign(map, item.extensions?.pptxColorMap);
  return map;
}

function simpleFill(parent, theme, colorMap) {
  const fills = children(parent).filter(node => FILL_TAGS.includes(node.localName));
  if (fills.length > 1) return null;
  if (!fills.length) return none();
  if (is(fills[0], 'a', 'noFill')) return none();
  if (!is(fills[0], 'a', 'solidFill') || children(fills[0]).length !== 1) return null;
  const color = resolvePptxColor(children(fills[0])[0], theme?.extensions?.pptxColorScheme, colorMap);
  return color ? { kind: 'solid', color } : null;
}

function fillFromStyle(styles, index) {
  if (index < 0 || index >= (styles?.length ?? 0)) return null;
  const value = styles[index];
  return value && value.kind === 'none' ? none() : value && value.kind === 'solid' ? { ...value } : null;
}

function simpleStroke(node, theme = {}, colorMap = {}) {
  if (!node) return none();
  for (const item of children(node)) {
    if (['solidFill', 'noFill', 'prstDash', 'round', 'bevel', 'miter'].includes(item.localName)) continue;
    return null;
  }
  const dash = child(node, 'a', 'prstDash');
  if (dash && dash.getAttribute('val') !== 'solid') return null;
  const fill = simpleFill(node, theme, colorMap);
  if (!fill) return null;
  if (fill.kind === 'none') return none();
  const width = node.getAttribute('w');
  if (!/^\d+$/.test(width ?? '') || !Number.isSafeInteger(Number(width)) || Number(width) <= 0) return null;
  return { kind: 'solid', color: fill.color, widthEmu: Number(width) };
}

function strokeFromStyle(styles, index) {
  if (index < 0 || index >= (styles?.length ?? 0)) return null;
  const value = styles[index];
  return value && value.kind === 'none' ? none() : value && value.kind === 'solid' ? { ...value } : null;
}

function projectedAdjust(geometry) {
  const childrenOfGeometry = children(geometry);
  if (childrenOfGeometry.some(node => !is(node, 'a', 'avLst'))) return null;
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

async function projectTheme(document, zip, xml) {
  for (const theme of document.themes) {
    if (!theme.source?.part) continue;
    const root = (await xmlPart(zip, theme.source.part, xml)).documentElement;
    const palette = readPptxColorScheme(root);
    const format = child(child(root, 'a', 'themeElements'), 'a', 'fmtScheme');
    const projectStyles = (tag, stroke = false) => children(child(format, 'a', tag)).map(node => {
      if (stroke) return simpleStroke(node, { extensions: { pptxColorScheme: palette } }, DEFAULT_COLOR_MAP);
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

async function projectEntityBackgrounds(document, zip, xml) {
  const own = new Map();
  for (const entity of [...document.masters, ...document.layouts, ...document.slides]) {
    if (!entity.source?.part) continue;
    const root = (await xmlPart(zip, entity.source.part, xml)).documentElement;
    const colorMap = readPptxColorMap(child(root, 'p', 'clrMap'));
    entity.extensions = { ...entity.extensions, ...(Object.keys(colorMap).length ? { pptxColorMap: colorMap } : {}) };
    const theme = themeFor(document, entity);
    const bg = child(child(root, 'p', 'cSld'), 'p', 'bg');
    let value = null;
    if (bg) {
      const ref = child(bg, 'p', 'bgRef');
      if (ref) value = fillFromStyle(theme?.extensions?.pptxBackgroundFillStyles, styleIndex(ref.getAttribute('idx')));
      else {
        const bgPr = child(bg, 'p', 'bgPr');
        if (!bgPr) value = null;
        else value = simpleFill(bgPr, theme, colorMapFor(document, entity));
      }
    }
    own.set(entity.id, value);
  }
  return own;
}

function effectiveBackground(document, entity, own, fallback = null) {
  if (own.has(entity.id) && own.get(entity.id) !== null) return own.get(entity.id);
  if (entity.masterId) {
    const master = document.masters.find(item => item.id === entity.masterId);
    if (master) return effectiveBackground(document, master, own, fallback);
  }
  if (fallback) return fallback;
  const theme = themeFor(document, entity);
  const colorMap = colorMapFor(document, entity);
  const color = schemeHex(theme?.extensions?.pptxColorScheme, colorMap, colorMap.bg1);
  return color ? { kind: 'solid', color } : null;
}

function resolveFont(direct, theme, fontRef, slot) {
  const fonts = theme?.extensions?.pptxFontScheme;
  const value = direct?.getAttribute('typeface');
  if (value) {
    const alias = /^\+(mj|mn)-(lt|ea|cs)$/.exec(value);
    if (!alias) return value;
    const group = alias[1] === 'mj' ? 'major' : 'minor';
    const target = alias[2] === 'lt' ? 'latin' : alias[2] === 'ea' ? 'eastAsian' : 'complexScript';
    return fonts?.[group]?.[target] || fonts?.[group]?.latin || null;
  }
  return fonts?.[fontRef]?.[slot] || fonts?.[fontRef]?.latin || null;
}

function resolvedRun(runProperties, fallbackProperties, theme, colorMap, fontRef) {
  const size = runProperties?.getAttribute('sz') ?? fallbackProperties?.getAttribute('sz');
  if (!/^\d+$/.test(size ?? '') || !Number.isInteger(Number(size)) || Number(size) < 100 || Number(size) > 400000) return null;
  for (const properties of [runProperties, fallbackProperties]) {
    if (!properties) continue;
    for (const node of children(properties)) {
      if (!['latin', 'ea', 'cs', 'solidFill'].includes(node.localName)) return null;
    }
    if (properties.hasAttribute('u') && properties.getAttribute('u') !== 'none') return null;
  }
  const directFill = runProperties ? child(runProperties, 'a', 'solidFill') : null;
  const fallbackFill = fallbackProperties ? child(fallbackProperties, 'a', 'solidFill') : null;
  const colorNode = directFill ? children(directFill)[0] : fallbackFill ? children(fallbackFill)[0] : null;
  const color = colorNode ? resolvePptxColor(colorNode, theme?.extensions?.pptxColorScheme, colorMap)
    : schemeHex(theme?.extensions?.pptxColorScheme, colorMap, colorMap.tx1);
  const fontFamily = resolveFont(runProperties ? child(runProperties, 'a', 'latin') : null, theme, fontRef, 'latin');
  const fontFamilyEastAsia = resolveFont(runProperties ? child(runProperties, 'a', 'ea') : null, theme, fontRef, 'eastAsian');
  const fontFamilyComplexScript = resolveFont(runProperties ? child(runProperties, 'a', 'cs') : null, theme, fontRef, 'complexScript');
  if (!color || !fontFamily || !fontFamilyEastAsia || !fontFamilyComplexScript) return null;
  return {
    color,
    fontFamily,
    fontFamilyEastAsia,
    fontFamilyComplexScript,
    fontSizePt: Number(size) / 100,
    bold: (runProperties?.getAttribute('b') ?? fallbackProperties?.getAttribute('b')) === '1',
    italic: (runProperties?.getAttribute('i') ?? fallbackProperties?.getAttribute('i')) === '1',
  };
}

function supportedTextXml(node, body, theme) {
  const txBox = ['1', 'true'].includes(child(child(node, 'p', 'nvSpPr'), 'p', 'cNvSpPr')?.getAttribute('txBox'));
  if (theme?.extensions?.pptxObjectDefaults?.[txBox ? 'txDef' : 'spDef']) return false;
  const bodyPr = child(body, 'a', 'bodyPr');
  if (!bodyPr || Object.keys(attrs(bodyPr)).some(attribute => !['wrap', 'anchor', 'lIns', 'rIns', 'tIns', 'bIns'].includes(attribute))
    || children(bodyPr).some(item => !is(item, 'a', 'noAutofit'))) return false;
  for (const paragraph of children(body).filter(item => is(item, 'a', 'p'))) {
    const properties = child(paragraph, 'a', 'pPr');
    if (properties) {
      if (Object.keys(attrs(properties)).some(attribute => !['algn', 'lvl', 'marL', 'marR', 'indent'].includes(attribute))) return false;
      for (const item of children(properties)) {
        if (['lnSpc', 'spcBef', 'spcAft'].includes(item.localName)) {
          if (children(item).length !== 1) return false;
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

function projectText(object, node, theme, colorMap) {
  const body = child(node, 'p', 'txBody');
  if (!body) return null;
  if (object.bodyLayout?.autofit === 'shrink' || object.bodyLayout?.autofit === 'resize') return null;
  if (!supportedTextXml(node, body, theme) || allPlaceholdersOrLists(node)) return null;
  const fontRef = object.extensions.pptxTextMetrics.fontRef;
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
      const value = resolvedRun(runProperties, defaults, theme, colorMap, fontRef);
      if (!value) return null;
      run.extensions = { ...run.extensions, pptxAppearance: { ...run.extensions?.pptxAppearance, resolved: value } };
    }
    const lastRun = paragraph.runs.at(-1);
    const lastXmlRun = children(xmlParagraph).filter(item => is(item, 'a', 'r')).at(-1);
    const endValue = resolvedRun(end ?? (lastXmlRun ? child(lastXmlRun, 'a', 'rPr') : null), defaults, theme, colorMap, fontRef)
      ?? lastRun?.extensions?.pptxAppearance?.resolved;
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
  }
  return { paragraphs };
}

function allPlaceholdersOrLists(node) {
  if (Array.from(node.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'ph')).length) return true;
  return Array.from(node.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'lstStyle'))
    .some(item => item.children.length > 0);
}

async function projectObject(document, object, slide, zip, xml) {
  if (!object.source?.part || !['shape', 'text'].includes(object.type)) return;
  const node = locate(await xmlPart(zip, object.source.part, xml), object.source.path);
  if (!is(node, 'p', 'sp')) return;
  const props = child(node, 'p', 'spPr');
  const xfrm = child(props, 'a', 'xfrm');
  if (!props || !xfrm || xfrm.getAttribute('flipH') === '1' || xfrm.getAttribute('flipV') === '1') return;
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
  if (!theme) return;
  const colorMap = colorMapFor(document, slide);
  const hasDirectFill = children(props).some(item => FILL_TAGS.includes(item.localName));
  const fillRef = style ? child(style, 'a', 'fillRef') : null;
  const fill = hasDirectFill ? simpleFill(props, theme, colorMap)
    : fillRef ? fillFromStyle(theme.extensions.pptxFillStyles, styleIndex(fillRef.getAttribute('idx'))) : none();
  if (!fill) return;
  const line = child(props, 'a', 'ln');
  const lineRef = style ? child(style, 'a', 'lnRef') : null;
  const stroke = line ? simpleStroke(line, theme, colorMap)
    : lineRef ? strokeFromStyle(theme.extensions.pptxLineStyles, styleIndex(lineRef.getAttribute('idx'))) : none();
  if (!stroke) return;
  const text = body ? projectText(object, node, theme, colorMap) : null;
  if (body && !text) return;
  if (!body) {
    object.type = 'shape';
    object.shape = preset;
  }
  const appearance = {
    version: 1,
    sourceFormat: 'pptx',
    appearanceResolved: true,
    input: nativeObjectAppearanceInput(object),
    fill,
    stroke,
    ...(Object.keys(adjust).length ? { adjust } : {}),
    ...(text ? { text } : {}),
  };
  if (inputFits(appearance.input)) object.extensions = { ...object.extensions, stagecraftNativeAppearance: appearance };
}

export async function projectNativeAppearance(document, zip, xml) {
  if (document.extensions?.sourceFormat !== 'pptx') return;
  try { await projectTheme(document, zip, xml); }
  catch { /* Appearance projection must never prevent opening a valid package. */ }
  let ownBackgrounds = new Map();
  try { ownBackgrounds = await projectEntityBackgrounds(document, zip, xml); }
  catch { ownBackgrounds = new Map(); }
  for (const master of document.masters) {
    try {
      const background = effectiveBackground(document, master, ownBackgrounds);
      if (!background) continue;
      master.extensions = {
        ...master.extensions,
        stagecraftLayoutSummary: {
          version: 1, appearanceResolved: true, input: nativeLayoutAppearanceInput(master), background, artworkCount: master.objects.length,
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
          version: 1, appearanceResolved: true, input: nativeLayoutAppearanceInput(layout), background, artworkCount: layout.objects.length,
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
            version: 1, appearanceResolved: true, input: nativeSlideAppearanceInput(slide), background, inheritedArtworkCount: 0,
          },
        };
      }
    } catch { /* Unresolved slide appearance stays unproved. */ }
    for (const object of slide.objects) {
      try { await projectObject(document, object, slide, zip, xml); }
      catch { /* Unsupported appearance stays opaque and refuses the scene later. */ }
    }
  }
}
