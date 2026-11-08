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
import { slideDims } from '../../lib/slideDims.js';
import { paintSlide } from '../../canvas/paint.js';
import { ensureAssets, sharedPaintEnv } from '../../canvas/assets.js';

const MAX_DPR = 3; // a 4×+ backing store costs memory for no visible gain
const currentDpr = () => Math.min(globalThis.devicePixelRatio || 1, MAX_DPR);

// The screen's pixel ratio, kept current: it changes when the window moves to
// a display with another density (or on a pinch zoom), without any resize.
function useDevicePixelRatio() {
  const [dpr, setDpr] = useState(currentDpr);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mql = matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
    const update = () => setDpr(currentDpr());
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [dpr]); // re-armed at each new ratio: the query matches one value
  return dpr;
}

/** The text a slide's scene shows, in z-order — the canvas's accessible label. */
export const sceneText = (scene) => scene.nodes.filter((n) => n.kind === 'text').map((n) => n.content.trim()).filter(Boolean).join('. ');

export default function SlideCanvas({ slide, deck, width, env = sharedPaintEnv, label, className, style }) {
  const canvasRef = useRef(null);
  const paintRef = useRef(() => {});
  const [measured, setMeasured] = useState(0);
  const dpr = useDevicePixelRatio();
  // The deck's slide size is the only deck input a K1 scene reads (K3's layout
  // compilers widen this to the full render key, decision 2), so an unrelated
  // deck edit doesn't rebuild — and repaint — every thumbnail.
  const { w: slideW, h: slideH } = slideDims(deck);
  const scene = useMemo(() => buildScene(slide, { w: slideW, h: slideH }), [slide, slideW, slideH]);
  const cssW = width ?? measured;

  // Track the container's width (unless one was given).
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (width != null) return undefined;
    setMeasured(canvas.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setMeasured(entry.contentRect.width));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [width]);

  // Size the backing store (only when its pixel size changes) and paint.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!(cssW > 0)) return;
    const pw = Math.round(cssW * dpr), ph = Math.round((cssW * scene.h * dpr) / scene.w);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    paintRef.current = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return; // no canvas support (jsdom)
      const k = canvas.width / scene.w;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      paintSlide(ctx, scene, env);
    };
    paintRef.current();
  }, [scene, cssW, dpr, env]);

  // Repaint once the scene's pictures have decoded and its fonts have loaded.
  // Re-checked after a resize too: a picture the bounded image cache dropped
  // while this canvas sat unpainted decodes again (a cheap no-op otherwise).
  useEffect(() => {
    let live = true;
    ensureAssets(scene, env).then((changed) => { if (changed && live) paintRef.current(); });
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
      aria-label={label ?? (sceneText(scene) || (typeof slide?.title === 'string' ? slide.title : ''))}
      className={className}
      style={{ display: 'block', width: width ?? '100%', aspectRatio: `${scene.w} / ${scene.h}`, ...style }}
    />
  );
}
