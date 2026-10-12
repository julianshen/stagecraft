// The spike's stand-in for K1's paintNode/paintSlide: officeview painters only.
import { resolvePreset } from '../../src/vendor/officeview/drawing/geometry';
import { paintGeometry } from '../../src/vendor/officeview/drawing/paint';
import { layoutTextBody } from '../../src/vendor/officeview/drawing/text-layout';
import { paintTextBody, createTextBodyMeasurer } from '../../src/vendor/officeview/drawing/text-paint';
import { SLIDE_W, SLIDE_H } from './deck.js';

export const resolveFont = () => '"Inter", "Helvetica Neue", Arial, sans-serif';

// env.cache: per-node layout/geometry cache (decision 6); null = no caching.
export function paintNode(ctx, node, env) {
  ctx.save();
  ctx.translate(node.x + node.w / 2, node.y + node.h / 2);
  if (node.rot) ctx.rotate((node.rot * Math.PI) / 180);
  ctx.translate(-node.w / 2, -node.h / 2);
  if (node.kind === 'shape') {
    const geo = env.cache?.get(node) ?? resolvePreset(node.preset, node.w, node.h);
    env.cache?.set(node, geo);
    paintGeometry(ctx, geo, node.style, node.w, node.h);
  } else if (node.kind === 'text') {
    let layout = env.cache?.get(node);
    if (!layout) {
      layout = layoutTextBody(node.body, node.w, node.h, createTextBodyMeasurer(ctx, resolveFont));
      env.cache?.set(node, layout);
    }
    paintTextBody(node.body, ctx, 0, 0, node.w, node.h, resolveFont, undefined, { layout });
  } else {
    ctx.drawImage(env.image, 0, 0, node.w, node.h);
  }
  ctx.restore();
}

export function paintSlide(ctx, nodes, env) {
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  for (const n of nodes) paintNode(ctx, n, env);
}
