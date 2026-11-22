import { SLIDE_W, SLIDE_H } from './elements.js';

// Snap a dragged element to alignment guides: its left/centre/right edges snap
// to any other element's left/centre/right (and the slide's left/centre/right),
// likewise top/middle/bottom on the y-axis. Returns the snapped { x, y } plus
// the `guides` lines to draw — one per axis that snapped ({ axis:'v'|'h', pos }).
// Each axis snaps independently to its CLOSEST target within `tol` px. Pure.
export function alignSnap(el, others = [], { bounds = { w: SLIDE_W, h: SLIDE_H }, tol = 6 } = {}) {
  const targetsX = [0, bounds.w / 2, bounds.w];
  const targetsY = [0, bounds.h / 2, bounds.h];
  for (const o of others) {
    targetsX.push(o.x, o.x + o.w / 2, o.x + o.w);
    targetsY.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  // The element's three reference positions on an axis (near edge, centre, far edge).
  const best = (refs, targets) => {
    let win = null;
    for (const ref of refs) {
      for (const t of targets) {
        const d = Math.abs(ref - t);
        if (d <= tol && (!win || d < win.d)) win = { d, delta: t - ref, pos: t };
      }
    }
    return win;
  };
  const sx = best([el.x, el.x + el.w / 2, el.x + el.w], targetsX);
  const sy = best([el.y, el.y + el.h / 2, el.y + el.h], targetsY);
  const guides = [];
  if (sx) guides.push({ axis: 'v', pos: sx.pos });
  if (sy) guides.push({ axis: 'h', pos: sy.pos });
  return { x: el.x + (sx ? sx.delta : 0), y: el.y + (sy ? sy.delta : 0), guides };
}
