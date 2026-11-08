// A deck's slide size in authoring px (F-SLD-3). The width is always 1920, so
// existing geometry stays valid; the height comes from the deck (1080 for 16:9
// today, 1440 for 4:3 once D3 lands). Everything that sizes a slide — the
// canvas scene, <SlideCanvas>, thumbnails, PDF and PPTX pages — reads it from
// here instead of hard-coding SLIDE_H.
import { SLIDE_W, SLIDE_H } from './elements.js';

export function slideDims(deck) {
  const h = deck?.size?.h;
  return { w: SLIDE_W, h: Number.isFinite(h) && h > 0 ? h : SLIDE_H };
}
