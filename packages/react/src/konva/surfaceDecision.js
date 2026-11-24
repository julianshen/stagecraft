export const SURFACE_REASON_MESSAGES = Object.freeze({
  loading: 'Loading canvas view...',
  'no-slide': 'Showing the standard view: there is no slide to show.',
  'not-canonical': 'Showing the standard view: this deck format is not supported in canvas view.',
  'unsupported-format': 'Showing the standard view: canvas view supports PowerPoint files only.',
  'plugin-renderer': 'Showing the standard view: this editor uses custom object renderers.',
  'inherited-appearance': 'Showing the standard view: this slide uses its layout background. Set a slide background to use canvas view.',
  'unresolved-appearance': 'Showing the standard view: imported slide styling is not supported in canvas view yet.',
  'unsupported-content': 'Showing the standard view: this slide has content canvas view cannot show yet (images, tables, charts or groups).',
  'invalid-geometry': 'Showing the standard view: an object on this slide has an invalid size or position.',
  'unsupported-embedding': 'Showing the standard view: the editor is inside a scaled or rotated container.',
  'fonts-unavailable': 'Showing the standard view: the slide fonts did not load.',
  'fonts-timeout': 'Showing the standard view: the slide fonts did not load.',
  'canvas-unavailable': 'Showing the standard view: canvas view could not start.',
  'load-failed': 'Showing the standard view: canvas view could not start.',
  'render-failed': 'Showing the standard view: canvas view could not start.',
});

export const INHERITED_APPEARANCE_MESSAGES = Object.freeze({
  'inherited-background': 'Showing the standard view: this slide uses its layout background. Set a slide background to use canvas view.',
  'inherited-artwork': 'Showing the standard view: this slide inherits layout or master artwork.',
  'authored-layout-mismatch': 'Showing the standard view: this slide uses a layout not supported in canvas view yet.',
  'theme-object-defaults': 'Showing the standard view: this slide uses theme default styling not supported in canvas view yet.',
});

export function surfaceMessageForReason(reason, diagnostics = []) {
  if (reason === 'inherited-appearance' && Array.isArray(diagnostics)) {
    for (const d of diagnostics) {
      if (d?.code && INHERITED_APPEARANCE_MESSAGES[d.code]) {
        return INHERITED_APPEARANCE_MESSAGES[d.code];
      }
    }
    return 'Showing the standard view: this slide uses inherited layout styling.';
  }
  return SURFACE_REASON_MESSAGES[reason] ?? 'Showing the standard view.';
}

export function isRelevantFontEvent(scene, event) {
  const nodes = scene?.nodes ?? [];
  if (!nodes.some(n => Boolean(n.paint?.text))) return false;
  const faces = event?.fontfaces;
  if (!faces) return true;
  const list = Array.from(faces);
  if (list.length === 0) return true;
  const usedFamilies = new Set();
  for (const node of nodes) {
    for (const p of node.paint?.text?.body?.paragraphs ?? []) {
      for (const r of p.runs ?? []) {
        for (const key of ['typeface', 'eastAsian', 'complexScript', 'fontFamily', 'font']) {
          const val = r[key] ?? r.style?.[key];
          if (typeof val === 'string' && val.trim()) {
            usedFamilies.add(val.replace(/['"]/g, '').trim().toLowerCase());
          }
        }
      }
    }
  }
  if (usedFamilies.size === 0) return true;
  return list.some(face => {
    const fam = typeof face?.family === 'string' ? face.family.replace(/['"]/g, '').trim().toLowerCase() : '';
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
