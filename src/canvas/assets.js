// Assets gate the paint (docs/CANVAS-EDITOR.md §6, decision 5): every image a
// scene shows is decoded, and every font its text uses is loaded, before the
// paint can be right. Interactive surfaces paint at once and repaint when
// ensureAssets reports a change (a missing image draws its placeholder
// meanwhile); anything that serialises pixels — thumbnail bitmaps, PDF,
// toBlob — awaits it first, so a cold export never captures a blank image or
// a fallback font.
//
// Decodes are cached on the paint env by source, so the editor, thumbnails and
// the presenter share one decoded image; `sharedPaintEnv` is that common env.
import { createPaintEnv, canvasFont } from './paint.js';

/** The env every surface shares unless it brings its own (tests, workers). */
export const sharedPaintEnv = createPaintEnv();

// A CSS font shorthand for a text node — size is irrelevant to which face loads.
const fontSpec = (n) => `${n.italic ? 'italic' : 'normal'} ${n.bold ? 'bold' : 'normal'} 16px ${canvasFont(n.fontFamily)}`;

/** The distinct image sources and font specs a scene needs. */
export function sceneAssets(scene) {
  const images = new Set(), fonts = new Set();
  for (const n of scene.nodes) {
    if (n.kind === 'image' && n.src) images.add(n.src);
    if (n.kind === 'text') fonts.add(fontSpec(n));
  }
  return { images: [...images], fonts: [...fonts] };
}

/** An image source decoded for drawing (an <img>, which applies EXIF orientation as the DOM does). */
export async function decodeImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

// Store a decode, keeping at most env.imageLimit: the oldest goes first (and an
// ImageBitmap is closed, freeing its pixels now). A dropped picture that is
// still on a slide decodes again on its next ensureAssets.
function store(env, src, img) {
  env.images.set(src, img);
  while (env.images.size > env.imageLimit) {
    const [oldest, drawable] = env.images.entries().next().value;
    env.images.delete(oldest);
    drawable?.close?.();
  }
}

// Decode `src` into env.images (false on failure), sharing an in-flight decode.
function loadInto(env, src, loadImage) {
  if (!env.pending.has(src)) {
    env.pending.set(src, Promise.resolve()
      .then(() => loadImage(src))
      .then((img) => { store(env, src, img); return true; }, () => { store(env, src, false); return false; })
      .finally(() => env.pending.delete(src)));
  }
  return env.pending.get(src);
}

/**
 * Make everything `scene` draws ready on `env`. Resolves to whether anything
 * changed (an image decoded, or a font arrived — which bumps `env.fontEpoch`,
 * so cached text layouts measured with the fallback are dropped), i.e. whether
 * a surface that already painted should paint again.
 */
export async function ensureAssets(scene, env = sharedPaintEnv, { loadImage = decodeImage, fonts = globalThis.document?.fonts } = {}) {
  const { images, fonts: specs } = sceneAssets(scene);
  const decoded = images.filter((src) => !env.images.has(src)).map((src) => loadInto(env, src, loadImage));
  const loading = fonts?.load ? specs.filter((s) => !env.fonts.has(s)).map(async (spec) => {
    env.fonts.add(spec); // once per spec, loaded or not: a failure leaves the fallback, which is what then measures
    try {
      return (await fonts.load(spec)).length > 0;
    } catch {
      return false;
    }
  }) : [];
  const [imagesChanged, fontsChanged] = await Promise.all([Promise.all(decoded), Promise.all(loading)]);
  if (fontsChanged.some(Boolean)) env.fontEpoch += 1;
  return imagesChanged.some(Boolean) || fontsChanged.some(Boolean);
}
