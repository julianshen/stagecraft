export { buildScene, elementNode } from './canvas/scene.js';
export { paintSlide, paintNode, createPaintEnv } from './canvas/paint.js';
export { ensureAssets } from './canvas/assets.js';
export { measureShrinkFits, waitForShrinkFonts, SHRINK_FIT_POLICY } from './text/measureShrinkFits.js';
export { measureResizeFits, resizeFallback, RESIZE_FIT_POLICY } from './text/measureResizeFits.js';
export { waitForAutofitFonts } from './text/waitForAutofitFonts.js';
export { collectFontQueries, fontFamiliesFor } from './text/fontReadiness.js';
export { DEFAULT_TEXT_INSETS_EMU } from './text/canonicalTextBody.js';
