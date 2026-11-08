// A slide drawn on a <canvas> by the Phase K painter: the read-only surface
// thumbnails, the sorter, the presenter and Home cards switch to in K4.
//
// The backing store is the CSS size × devicePixelRatio, so text and edges are
// crisp at any size; the painter works in slide px under one transform. The
// slide paints at once, then again when ensureAssets has decoded its pictures
// and loaded its fonts. The width follows the container (or `width`), and the
// height the deck's slide size.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildScene } from '../../canvas/scene.js';
import { paintSlide } from '../../canvas/paint.js';
import { ensureAssets, sharedPaintEnv } from '../../canvas/assets.js';

const MAX_DPR = 3; // a 4×+ backing store costs memory for no visible gain

/** The text a slide's scene shows, in z-order — the canvas's accessible label. */
export const sceneText = (scene) => scene.nodes.filter((n) => n.kind === 'text' && n.content.trim()).map((n) => n.content.trim()).join('. ');

export default function SlideCanvas({ slide, deck, width, env = sharedPaintEnv, label, className, style }) {
  const canvasRef = useRef(null);
  const [measured, setMeasured] = useState(0);
  const deckH = deck?.size?.h;
  // Keyed on the deck's slide size, the only deck input a K1 scene reads (K3's
  // layout compilers widen this to the full render key, decision 2), so an
  // unrelated deck edit doesn't rebuild and repaint every thumbnail.
  const scene = useMemo(() => buildScene(slide, deck), [slide, deckH]);
  const cssW = width ?? measured;

  // Track the container's width (unless one was given).
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (width != null || !canvas) return undefined;
    setMeasured(canvas.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setMeasured(entry.contentRect.width));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [width]);

  // Paint now, and again once the scene's assets are ready.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !(cssW > 0)) return undefined;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round((cssW * scene.h * dpr) / scene.w);
    const paint = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return; // no canvas support (jsdom)
      const k = canvas.width / scene.w;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      paintSlide(ctx, scene, env);
    };
    paint();
    let live = true;
    ensureAssets(scene, env).then((changed) => { if (changed && live) paint(); });
    return () => { live = false; };
  }, [scene, cssW, env]);

  // Free the backing store when the canvas goes (thumbnail rails mount many).
  // The canvas is captured on mount: React clears the ref before this cleanup runs.
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => { canvas.width = canvas.height = 0; };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label ?? sceneText(scene)}
      className={className}
      style={{ display: 'block', width: width ?? '100%', aspectRatio: `${scene.w} / ${scene.h}`, ...style }}
    />
  );
}
