const EMU_PER_PX = 9525;
const slots = { lt: 'latin', ea: 'eastAsian', cs: 'complexScript' };

/** New authored slides use the first layout in the PPTX writer; native slides retain their relationship. */
export function layoutForSlide(document, slide) {
  return slide.extensions?.stagecraftAuthored && !slide.source
    ? document.layouts?.[0] : document.layouts?.find(item => item.id === slide.layoutId);
}

/** Read-only theme appearance; never replace tokens in the canonical snapshot. */
export function themeForSlide(document, slide) {
  const layout = layoutForSlide(document, slide);
  const master = document.masters?.find(item => item.id === layout?.masterId);
  const appearance = document.themes?.find(item => item.id === master?.themeId)?.extensions;
  const fonts = appearance?.pptxFontScheme;
  const objectDefaults = appearance?.pptxObjectDefaults;
  const metricsSupported = document.extensions?.pptxTextDefaultsSupported !== false && master?.extensions?.pptxTextDefaultsSupported !== false
    && ![slide, layout, master].some(item => item?.extensions?.pptxThemeOverride);
  return fonts || objectDefaults || !metricsSupported ? { fonts, metricsSupported, ...(objectDefaults ? { objectDefaults } : {}) } : undefined;
}

function knownFont(value, theme) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (!value.startsWith('+')) return true;
  const alias = /^\+(mj|mn)-(lt|ea|cs)$/.exec(value);
  const group = alias && theme?.fonts?.[alias[1] === 'mj' ? 'major' : 'minor'];
  return !!group && !!(group[slots[alias[2]]] || group.latin);
}

/** Shared display normalization; never rewrites canonical/source run text. */
function canonicalRunTexts(paragraph) {
  let nextText = '';
  const text = new Array(paragraph.runs.length);
  for (let i = paragraph.runs.length - 1; i >= 0; i--) {
    const raw = paragraph.runs[i].text;
    text[i] = (raw.endsWith('\r') && nextText.startsWith('\n') ? raw.slice(0, -1) : raw).replace(/\r\n|\r/g, '\n');
    if (raw) nextText = raw;
  }
  return text;
}

/** Minimal DrawingML adapter. Unsupported/inherited metrics return null, never guessed sizes. */
export function canonicalTextBody(object, theme) {
  const g = object.geometry, layout = object.bodyLayout ?? {};
  if (object.shape && object.shape !== 'rect') return null;
  if (!g || ![g.width, g.height].every(n => Number.isFinite(n) && n > 0) || !object.text?.paragraphs?.length || object.source?.format === 'odp') return null;
  const metrics = object.extensions?.pptxTextMetrics;
  if (metrics?.supported === false || theme?.metricsSupported === false) return null;
  const alias = metrics?.fontRef === 'major' ? '+mj' : '+mn';
  const paragraphs = [];
  for (const paragraph of object.text.paragraphs) {
    const p = paragraph.style ?? {};
    if ((p.bullet && p.bullet.type !== 'none') || (p.level ?? 0) > 0) return null;
    const runs = [];
    const text = canonicalRunTexts(paragraph);
    for (const [index, run] of paragraph.runs.entries()) {
      const s = run.style ?? {}, fontSizePt = Number(s.sz) / 100;
      const family = s.typeface ?? `${alias}-lt`;
      if (run.text.includes('\t')) return null;
      if (theme && ['eastAsian', 'complexScript'].some((key, i) => !knownFont(s[key] || `${alias}-${i ? 'cs' : 'ea'}`, theme))) return null;
      // With no theme, a literal Latin face says nothing about inherited script slots.
      if (!theme && /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(run.text) && (!s.eastAsian || !s.complexScript)) return null;
      if (!Number.isFinite(fontSizePt) || fontSizePt <= 0 || !knownFont(family, theme)) return null;
      for (const key of ['eastAsian', 'complexScript']) if (s[key] != null && !knownFont(s[key], theme)) return null;
      if (run.editable === false) return null;
      runs.push({ text: text[index], fontSizePt, fontFamily: family, bold: s.b === '1' || s.b === 'true' || s.b === true, italic: s.i === '1' || s.i === 'true' || s.i === true,
        ...(s.eastAsian || theme ? { fontFamilyEastAsia: s.eastAsian || `${alias}-ea` } : {}), ...(s.complexScript || theme ? { fontFamilyComplexScript: s.complexScript || `${alias}-cs` } : {}), ...(s.lang ? { language: s.lang } : {}) });
    }
    if (!runs.length) return null; // No known end-paragraph size.
    paragraphs.push({ runs, align: p.alignment ?? 'left', level: p.level ?? 0, endProperties: { ...runs.at(-1), text: undefined },
      marginLeftEmu: p.indentStart ?? 0, marginRightEmu: p.indentEnd ?? 0, indentEmu: p.firstLineIndent ?? 0,
      ...(p.lineSpacing != null ? { lineSpacing: { kind: 'percent', value: p.lineSpacing / 100 } } : {}),
      ...(p.spaceBefore != null ? { spaceBefore: { kind: 'points', value: p.spaceBefore } } : {}),
      ...(p.spaceAfter != null ? { spaceAfter: { kind: 'points', value: p.spaceAfter } } : {}) });
  }
  const insets = { left: 91440, right: 91440, top: 45720, bottom: 45720, ...layout.insets };
  if (!Object.values(insets).every(n => Number.isFinite(n) && n >= 0)) return null;
  const width = g.width / EMU_PER_PX, height = g.height / EMU_PER_PX;
  const availableHeight = (g.height - insets.top - insets.bottom) / EMU_PER_PX;
  if (availableHeight <= 0 || g.width <= insets.left + insets.right) return null;
  return { width, height, availableHeight, theme, body: { paragraphs, wrap: layout.wrap !== 'none', anchor: { top: 't', middle: 'ctr', bottom: 'b' }[layout.anchor] ?? 't',
    insetLeftEmu: insets.left, insetRightEmu: insets.right, insetTopEmu: insets.top, insetBottomEmu: insets.bottom } };
}
