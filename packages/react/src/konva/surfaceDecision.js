import { fontFamiliesFor } from '@stagecraft/renderer';

const frozenMap = entries => Object.freeze(Object.assign(Object.create(null), entries));
const ownValue = (table, key) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined);
const isSafeDiagnosticCode = code =>
  typeof code === 'string' && code.length > 0 && code !== '__proto__' && !Object.hasOwn(Object.prototype, code);

export const SURFACE_REASON_MESSAGES = frozenMap({
  loading: 'Loading canvas view...',
  'no-slide': 'Showing the standard view: there is no slide to show.',
  'not-canonical': 'Showing the standard view: this deck format is not supported in canvas view.',
  'unsupported-format': 'Showing the standard view: canvas view supports PowerPoint files only.',
  'plugin-renderer': 'Showing the standard view: this editor uses custom object renderers.',
  'inherited-appearance': 'Showing the standard view: this slide uses its layout background. Set a slide background to use canvas view.',
  'unresolved-appearance': 'Showing the standard view: this slide has styling that could not be resolved for canvas view yet.',
  'unsupported-content': 'Showing the standard view: this slide has content canvas view cannot show yet (images, tables, charts or groups).',
  'invalid-geometry': 'Showing the standard view: an object on this slide has an invalid size or position.',
  'unsupported-embedding': 'Showing the standard view: the editor is inside a scaled or rotated container.',
  'fonts-unavailable': 'Showing the standard view: the slide fonts did not load.',
  'fonts-timeout': 'Showing the standard view: the slide fonts did not load.',
  'canvas-unavailable': 'Showing the standard view: canvas view could not start.',
  'load-failed': 'Showing the standard view: canvas view could not start.',
  'render-failed': 'Showing the standard view: canvas view could not start.',
});

const PLACEHOLDER_STYLE_MESSAGE =
  'Showing the standard view: this slide uses placeholder styling not supported in canvas view yet.';
const UNCONFIRMED_APPEARANCE_MESSAGE =
  'Showing the standard view: canvas view cannot confirm this slide matches PowerPoint yet.';

export const INHERITED_APPEARANCE_MESSAGES = frozenMap({
  'inherited-background': 'Showing the standard view: this slide uses its layout background. Set a slide background to use canvas view.',
  'inherited-artwork': 'Showing the standard view: this slide inherits layout or master artwork.',
  'theme-background-unresolved': 'Showing the standard view: this slide uses a theme background that could not be resolved.',
  'native-layout-summary-missing': "Showing the standard view: this slide's layout background could not be resolved for canvas view yet.",
  'authored-layout-mismatch': 'Showing the standard view: this slide uses a layout not supported in canvas view yet.',
  'theme-object-defaults': 'Showing the standard view: this slide uses theme default styling not supported in canvas view yet.',
});

// Includes all contracts/konva-3.md §4 codes; codes not yet emitted by the K3b renderer are reserved for source diagnostics.
export const UNRESOLVED_APPEARANCE_MESSAGES = frozenMap({
  'native-appearance-proof-missing': UNCONFIRMED_APPEARANCE_MESSAGE,
  'native-appearance-proof-invalid': UNCONFIRMED_APPEARANCE_MESSAGE,
  'native-appearance-stale': 'Showing the standard view: this slide was edited, so canvas view cannot confirm it matches PowerPoint yet.',
  'theme-color-unresolved': 'Showing the standard view: this slide uses a theme colour variation canvas view cannot show yet.',
  'text-appearance-unresolved': 'Showing the standard view: this slide has text styling that could not be resolved for canvas view yet.',
  'placeholder-style-unresolved': PLACEHOLDER_STYLE_MESSAGE,
});

export const UNSUPPORTED_CONTENT_MESSAGES = frozenMap({
  'gradient-fill': 'Showing the standard view: this slide has a gradient fill that canvas view cannot show yet.',
  'picture-fill': 'Showing the standard view: this slide has a picture fill that canvas view cannot show yet.',
  'outline-unsupported': 'Showing the standard view: this slide has a shape outline style that canvas view cannot show yet.',
  'custom-geometry': 'Showing the standard view: this slide has a custom shape geometry that canvas view cannot show yet.',
  'flip-unsupported': 'Showing the standard view: this slide has a flipped shape that canvas view cannot show yet.',
  'list-style-unsupported': 'Showing the standard view: this slide has a bulleted list or numbered list that canvas view cannot show yet.',
  'native-autofit-unsupported': 'Showing the standard view: this slide has text autofit scaling that canvas view cannot show yet.',
  'placeholder-style-unresolved': PLACEHOLDER_STYLE_MESSAGE,
});

const DIAGNOSTIC_MESSAGES_BY_REASON = frozenMap({
  'inherited-appearance': INHERITED_APPEARANCE_MESSAGES,
  'unresolved-appearance': UNRESOLVED_APPEARANCE_MESSAGES,
  'unsupported-content': UNSUPPORTED_CONTENT_MESSAGES,
});

function formatAdditionalDiagnostics(message, totalCount) {
  const extra = totalCount - 1;
  if (extra <= 0) return message;
  const trimmed = message.endsWith('.') ? message.slice(0, -1) : message;
  return `${trimmed} (and ${extra} other ${extra === 1 ? 'item' : 'items'}).`;
}

export function surfaceDiagnosticForReason(reason, diagnostics = []) {
  const table = ownValue(DIAGNOSTIC_MESSAGES_BY_REASON, reason);
  const fallbackCode = Array.isArray(diagnostics)
    ? diagnostics.find(d => isSafeDiagnosticCode(d?.code))?.code
    : undefined;
  if (table && Array.isArray(diagnostics)) {
    for (const d of diagnostics) {
      const text = ownValue(table, d?.code);
      if (typeof text === 'string') {
        return {
          code: d.code,
          message: formatAdditionalDiagnostics(text, diagnostics.length),
        };
      }
    }
    if (reason === 'inherited-appearance') {
      return {
        code: fallbackCode,
        message: 'Showing the standard view: this slide uses inherited layout styling.',
      };
    }
  }
  const defaultMessage = ownValue(SURFACE_REASON_MESSAGES, reason);
  return {
    code: fallbackCode,
    message: typeof defaultMessage === 'string' ? defaultMessage : 'Showing the standard view.',
  };
}

export function surfaceMessageForReason(reason, diagnostics = []) {
  return surfaceDiagnosticForReason(reason, diagnostics).message;
}

export function isRelevantFontEvent(scene, event) {
  const bodies = (scene?.nodes ?? []).flatMap(n => (n.paint?.text ? [n.paint.text] : []));
  if (bodies.length === 0) return false;
  const faces = event?.fontfaces;
  if (!faces) return true;
  const list = Array.from(faces);
  if (list.length === 0) return true;
  const usedFamilies = new Set([...fontFamiliesFor(bodies)].map(f => f.toLowerCase()));
  if (usedFamilies.size === 0) return true;
  return list.some(face => {
    const fam = typeof face?.family === 'string' ? face.family.replace(/^['"]|['"]$/g, '').trim().toLowerCase() : '';
    return Boolean(fam) && usedFamilies.has(fam);
  });
}

export function hasNonEmptyObjectRenderers(plugins) {
  if (!Array.isArray(plugins)) return false;
  return plugins.some(plugin => Array.isArray(plugin?.objectRenderers) && plugin.objectRenderers.length > 0);
}

/** Positive axis-aligned CSS scale is supported; rotation, skew, reflection or 3D transforms fall back. */
export function isUnsupportedCssTransform(transform) {
  if (!transform || transform === 'none') return false;
  const m2d = /^matrix\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*[^,]+,\s*[^)]+\)$/.exec(transform.trim());
  if (!m2d) return true;
  const a = Number(m2d[1]), b = Number(m2d[2]), c = Number(m2d[3]), d = Number(m2d[4]);
  return !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)
    || b !== 0 || c !== 0 || a <= 0 || d <= 0;
}

export function computeSurfaceDecision({
  requested = 'svg',
  svgOverride = false,
  canonical = false,
  document = null,
  activeSlide = null,
  plugins = [],
  outerTransformUnsupported = false,
  sceneResult = null,
  moduleLoaded = false,
  fontStatus = 'loading',
  loadError = false,
  renderError = false,
}) {
  if (requested !== 'konva' || svgOverride) {
    return { active: 'svg', status: 'ready' };
  }
  if (!canonical) {
    return { active: 'svg', status: 'fallback', reason: 'not-canonical' };
  }
  if (document?.extensions?.sourceFormat === 'odp') {
    return { active: 'svg', status: 'fallback', reason: 'unsupported-format' };
  }
  if (!activeSlide) {
    return { active: 'svg', status: 'fallback', reason: 'no-slide' };
  }
  if (hasNonEmptyObjectRenderers(plugins)) {
    return { active: 'svg', status: 'fallback', reason: 'plugin-renderer' };
  }
  if (outerTransformUnsupported) {
    return { active: 'svg', status: 'fallback', reason: 'unsupported-embedding' };
  }
  if (!sceneResult || sceneResult.status !== 'ready') {
    return { active: 'svg', status: 'fallback', reason: sceneResult?.reason ?? 'unsupported-content' };
  }
  if (loadError) {
    return { active: 'svg', status: 'fallback', reason: 'load-failed' };
  }
  if (renderError) {
    return { active: 'svg', status: 'fallback', reason: 'render-failed' };
  }
  if (fontStatus === 'fonts-unavailable' || fontStatus === 'fonts-timeout' || fontStatus === 'canvas-unavailable') {
    return { active: 'svg', status: 'fallback', reason: fontStatus };
  }
  if (!moduleLoaded || fontStatus === 'loading') {
    return { active: 'svg', status: 'fallback', reason: 'loading' };
  }
  return { active: 'konva', status: 'ready' };
}
