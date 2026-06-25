// Deck-level heading scale: a single multiplier applied to every layout's title
// baseline (CANVAS_BASELINE_PX[layout].title), so a deck can dial all headings
// up/down proportionally while each layout keeps its relative size. Stored as
// `deck.headingScale`; the renderer and the PPTX export both resolve it through
// `resolveHeadingScale` so the canvas and export scale identically and a malformed
// (gate-bypassing) value can't break layout. Per-slide `fmt.fontSize` overrides are
// unaffected (they're absolute) — see fmtText's `scale` handling for the parity math.
import { CANVAS_BASELINE_PX } from './fontBaselines.js';

export const HEADING_SCALE_RANGE = Object.freeze({ min: 0.6, max: 1.6, default: 1 });

// The presets the Design panel offers (the editable surface); every value sits in
// HEADING_SCALE_RANGE and one of them is the default 1.
export const HEADING_SCALES = Object.freeze([
  Object.freeze({ label: 'Compact', value: 0.85 }),
  Object.freeze({ label: 'Default', value: 1 }),
  Object.freeze({ label: 'Comfortable', value: 1.15 }),
  Object.freeze({ label: 'Large', value: 1.3 }),
]);

// The effective heading scale for a deck: the stored value clamped into range, or
// the default when it's absent / non-finite. This is the single defence both render
// surfaces share (deck-level fields bypass the per-slide patch gate), the same
// resolve-at-read pattern as resolveNotes / isRenderableShadow.
export const resolveHeadingScale = (deck) => {
  const v = deck?.headingScale;
  if (!Number.isFinite(v)) return HEADING_SCALE_RANGE.default;
  return Math.min(HEADING_SCALE_RANGE.max, Math.max(HEADING_SCALE_RANGE.min, v));
};

// The rendered title px for a layout under the deck's heading scale — the single
// source the canvas renderer (its <h1> size) and the Design panel readout share, so
// the editor's reported size can't drift from what the slide actually renders. (The
// export scales pt the same proportion via fmtText's `scale`.) Unknown layouts fall
// back to the 72px the renderer's own default uses.
export const headingPx = (layout, deck) =>
  Math.round((CANVAS_BASELINE_PX[layout]?.title ?? 72) * resolveHeadingScale(deck));

// The px the current slide's title actually renders at: an absolute per-title
// `fmt.title.fontSize` (set via the format toolbar) overrides the deck heading
// scale, mirroring the renderer (fmtStyle wins over the scaled <h1>). The Design
// panel H1 readout uses this so it reflects the real title size, not just the
// scale's baseline result (a resized title would otherwise read misleadingly).
export const effectiveTitlePx = (slide, deck) => {
  const override = slide?.fmt?.title?.fontSize;
  return (Number.isFinite(override) && override > 0) ? Math.round(override) : headingPx(slide?.layout, deck);
};
