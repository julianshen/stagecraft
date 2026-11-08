// K1 perf check (not part of the suite): the real scene builder + painter on a
// 40-slide deck of Stagecraft elements, against ADR 0001's budget.
//   CHROMIUM_PATH=… K0_DPR=2 npx vitest run --config spikes/k1/vitest.config.js
import { it } from 'vitest';
import { buildScene } from '../../src/canvas/scene.js';
import { paintSlide, createPaintEnv } from '../../src/canvas/paint.js';
import { ms } from '../k0/paint.js';

const SHAPES = ['rect', 'rounded', 'circle', 'star', 'arrow', 'hexagon'];
const WORDS = 'quarterly revenue grew across every region while margins held steady and the roadmap shipped on time'.split(' ');
const sentence = (seed, n) => Array.from({ length: n }, (_, i) => WORDS[(seed + i * 7) % WORDS.length]).join(' ');
const slide = (s) => ({
  layout: 'blank',
  elements: [
    ...SHAPES.map((type, i) => ({ id: `s${i}`, type, x: 80 + i * 300, y: 120, w: 240, h: 160, fill: '#3366ff', stroke: '#112233', strokeWidth: 3, ...(i % 2 ? { gradient: { from: '#ff0000', to: '#0000ff', angle: 45 } } : {}) })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, type: 'text', x: 80 + (i % 4) * 450, y: 380 + Math.floor(i / 4) * 330, w: 420, h: 300, content: `Slide ${s} box ${i}: ${sentence(s + i, 16)}\n${sentence(s + i + 3, 20)}`, color: '#15171c', fontSize: [14, 18, 24, 40][i % 4] * 1.33 })),
    { id: 'i0', type: 'image', x: 1500, y: 80, w: 320, h: 120 }, { id: 'i1', type: 'image', x: 1500, y: 230, w: 320, h: 120 },
  ],
});
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); return { median: +s[s.length >> 1].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2) }; };

it('measures the K1 painter', () => {
  const scenes = Array.from({ length: 40 }, (_, s) => buildScene(slide(s), {}));
  const k = (1600 * devicePixelRatio) / 1920;
  const c = document.createElement('canvas');
  c.width = Math.round(1920 * k); c.height = Math.round(1080 * k);
  const ctx = c.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const env = createPaintEnv();
  const cold = scenes.map((sc) => ms(() => paintSlide(ctx, sc, env)));
  const warm = scenes.map((sc) => ms(() => paintSlide(ctx, sc, env)));
  const build = scenes.map((_, s) => ms(() => buildScene(slide(s), {})));
  const inked = ctx.getImageData(0, 0, c.width, c.height).data.filter((v, i) => i % 4 === 0 && v < 60).length;
  console.log(`K1_PERF ${JSON.stringify({ dpr: devicePixelRatio, layouts: env.layouts.size, darkPixels: inked, coldSlideMs: stats(cold), repaintMs: stats(warm), buildSceneMs: stats(build) })}`);
}, 120_000);
