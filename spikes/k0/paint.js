// The spike's stand-in for K1's paintNode/paintSlide: officeview painters only.
import { resolvePreset } from '../../src/vendor/officeview/drawing/geometry';
import { paintGeometry } from '../../src/vendor/officeview/drawing/paint';
import { layoutTextBody } from '../../src/vendor/officeview/drawing/text-layout';
import { paintTextBody, createTextBodyMeasurer } from '../../src/vendor/officeview/drawing/text-paint';
import { SLIDE_W, SLIDE_H } from './deck.js';

// The app's --f-sans stack (src/styles/main.css), as a full CSS stack.
export const resolveFont = () => '"Inter", -apple-system, BlinkMacSystemFont, sans-serif';

// env.cache: per-node geometry/layout cache (decision 6); null = recompute.
const cached = (env, node, compute) => {
  let v = env.cache?.get(node);
  if (!v) {
    v = compute();
    env.cache?.set(node, v);
  }
  return v;
};

/** Wall-clock ms of a synchronous call. */
export const ms = (f) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

export function paintNode(ctx, node, env) {
  ctx.save();
  ctx.translate(node.x + node.w / 2, node.y + node.h / 2);
  if (node.rot) ctx.rotate((node.rot * Math.PI) / 180);
  ctx.translate(-node.w / 2, -node.h / 2);
  if (node.kind === 'shape') {
    paintGeometry(ctx, cached(env, node, () => resolvePreset(node.preset, node.w, node.h)), node.style, node.w, node.h);
  } else if (node.kind === 'text') {
    const layout = cached(env, node, () => layoutTextBody(node.body, node.w, node.h, createTextBodyMeasurer(ctx, resolveFont)));
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
