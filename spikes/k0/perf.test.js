// K0 perf spike (not part of the suite): `npx vitest run --config spikes/k0/vitest.config.js`.
// Prints one JSON line of measurements for docs/adr/0001-canvas-engine.md.
import { it } from 'vitest';
import Konva from 'konva';
import { deck, SLIDE_W, SLIDE_H } from './deck.js';
import { paintNode, paintSlide, resolveFont } from './paint.js';
import { layoutTextBody } from '../../src/vendor/officeview/drawing/text-layout';
import { createTextBodyMeasurer } from '../../src/vendor/officeview/drawing/text-paint';

const ms = (f) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const r = (v) => Math.round(v * 100) / 100;
  return { median: r(s[Math.floor(s.length / 2)]), p95: r(s[Math.floor(s.length * 0.95)]), max: r(s.at(-1)) };
};

async function pictureBitmap() {
  const c = document.createElement('canvas');
  c.width = 800;
  c.height = 600;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 800, 600);
  grad.addColorStop(0, '#3366FF');
  grad.addColorStop(1, '#FF9933');
  g.fillStyle = grad;
  g.fillRect(0, 0, 800, 600);
  return createImageBitmap(c);
}

it('measures the canvas engine on a 40-slide deck', async () => {
  const image = await pictureBitmap();
  const out = { dpr: devicePixelRatio, slides: deck.length, nodesPerSlide: deck[0].length };

  // 1. Editor-size full repaint — the slide shown 1600 CSS px wide at the
  //    device's DPR (the backing store an editor canvas really has): cold (no
  //    layout cache) vs cached.
  const scale = (1600 * devicePixelRatio) / SLIDE_W;
  const full = document.createElement('canvas');
  full.width = Math.round(SLIDE_W * scale);
  full.height = Math.round(SLIDE_H * scale);
  const fctx = full.getContext('2d');
  fctx.scale(scale, scale);
  out.firstSlideColdMs = Math.round(ms(() => paintSlide(fctx, deck[0], { image, cache: null })) * 100) / 100;
  out.fullSlideColdMs = stats(deck.map((s) => ms(() => paintSlide(fctx, s, { image, cache: null }))));
  const cache = new Map();
  deck.forEach((s) => paintSlide(fctx, s, { image, cache }));
  out.fullSlideCachedMs = stats(deck.map((s) => ms(() => paintSlide(fctx, s, { image, cache }))));

  // 2. Text layout alone, per slide (8 boxes).
  const measure = createTextBodyMeasurer(fctx, resolveFont);
  out.textLayoutPerSlideMs = stats(deck.map((s) => ms(() => s.filter((n) => n.kind === 'text').forEach((n) => layoutTextBody(n.body, n.w, n.h, measure)))));

  // 3. Thumbnails: 40 × 320×180 CSS px at DPR 2, kept as ImageBitmaps — cold
  //    (first open: no layouts yet) and warm (layouts cached by the editor).
  const thumbnails = (thumbCache) => {
    const t = performance.now();
    const bitmaps = deck.map((s) => {
      const c = new OffscreenCanvas(640, 360);
      const ctx = c.getContext('2d');
      ctx.scale(640 / SLIDE_W, 640 / SLIDE_W);
      paintSlide(ctx, s, { image, cache: thumbCache });
      return c.transferToImageBitmap();
    });
    return { ms: Math.round(performance.now() - t), bitmaps };
  };
  out.thumbnails40ColdMs = thumbnails(new Map()).ms;
  const warm = thumbnails(cache);
  out.thumbnails40WarmMs = warm.ms;
  out.thumbnailBitmapsMB = Math.round((warm.bitmaps.length * 640 * 360 * 4) / 1e5) / 10;

  // 4. Konva editor stage, viewport-sized (1600×900 → scale 1600/1920), one
  //    Konva.Shape per node painting through the officeview painters; hit
  //    regions are the node boxes. Drag = 120 moves of one shape, each a
  //    synchronous redraw: (a) the whole content layer, (b) a drag layer only.
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stage = new Konva.Stage({ container: host, width: 1600, height: 900, scaleX: 1600 / SLIDE_W, scaleY: 1600 / SLIDE_W });
  const content = new Konva.Layer();
  const dragLayer = new Konva.Layer();
  stage.add(content, dragLayer);
  const env = { image, cache };
  const shapes = deck[0].map((node) => new Konva.Shape({
    perfectDrawEnabled: false,
    sceneFunc: (con) => paintNode(con._context, node, env),
    hitFunc: (con, shape) => {
      con.beginPath();
      con.rect(node.x, node.y, node.w, node.h);
      con.closePath();
      con.fillStrokeShape(shape);
    },
  }));
  shapes.forEach((s) => content.add(s));
  out.stageFirstDrawMs = Math.round(ms(() => content.draw()) * 100) / 100;
  const target = shapes[3];
  out.dragFrameContentLayerMs = stats(Array.from({ length: 120 }, (_, i) => {
    target.x(i * 2);
    return ms(() => content.draw());
  }));
  target.moveTo(dragLayer);
  content.draw();
  out.dragFrameDragLayerMs = stats(Array.from({ length: 120 }, (_, i) => {
    target.x(i * 2);
    return ms(() => dragLayer.draw());
  }));
  out.hitTestMs = stats(Array.from({ length: 200 }, (_, i) => ms(() => stage.getIntersection({ x: (i * 37) % 1600, y: (i * 53) % 900 }))));
  // Per layer: a scene canvas at DPR² plus a hit canvas at pixel ratio 1 (Konva's default).
  const perLayer = (dpr) => 1600 * 900 * 4 * (dpr ** 2 + 1);
  out.stageBackingStoreMB = { dpr1: Math.round((2 * perLayer(1)) / 1e5) / 10, dpr2: Math.round((2 * perLayer(2)) / 1e5) / 10, dpr2ThreeLayers: Math.round((3 * perLayer(2)) / 1e5) / 10 };
  console.log(`K0_PERF ${JSON.stringify(out)}`);
}, 120_000);
