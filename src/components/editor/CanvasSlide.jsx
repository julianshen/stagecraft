import React, { useState, useEffect, useRef } from 'react';
import { ScaledSlide } from '../ui/Primitives.jsx';
import { moveElement, resizeElement, elementsInMarquee } from '../../lib/elements.js';

const HANDLE_CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};
const HANDLE_POS = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0],
  w: [0, 0.5], e: [1, 0.5],
  sw: [0, 1], s: [0.5, 1], se: [1, 1],
};

export default function CanvasSlide({ slide, deckCtx, renderSlide, zoom, selectedIds = [], onSelectElement, onUpdateElements, onMarqueeSelect }) {
  const frameRef = useRef(null);
  const [scale, setScale] = useState(0.5);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    function update() {
      const el = frameRef.current;
      if (!el) return;
      setScale(el.getBoundingClientRect().width / 1920);
    }
    update();
    const ro = new ResizeObserver(update);
    if (frameRef.current) ro.observe(frameRef.current);
    return () => ro.disconnect();
  }, []);

  // Live drag preview: a map id→element while dragging (commits once on pointer-up).
  const [drag, setDrag] = useState(null);
  // Live marquee rectangle (slide coords) while rubber-band selecting on empty space.
  const [marquee, setMarquee] = useState(null);
  const dragCleanup = useRef(null);
  useEffect(() => () => dragCleanup.current?.(), []);

  const baseElements = slide.elements || [];
  // Latest elements for the marquee's pointer-up (the deck can change mid-drag).
  const baseElementsRef = useRef(baseElements);
  baseElementsRef.current = baseElements;
  const selectedSet = new Set(selectedIds);
  const elements = drag ? baseElements.map((e) => drag.get(e.id) || e) : baseElements;
  const liveSlide = drag ? { ...slide, elements } : slide;
  const selected = elements.filter((e) => selectedSet.has(e.id));
  // Resize handles only when exactly one element is selected.
  const resizeTarget = selected.length === 1 ? selected[0] : null;

  // Drag `targets` (array): each pointermove maps the screen delta to slide
  // coords and applies `apply(el, dx, dy)`; commits once on pointer-up.
  function startDrag(e, targets, apply, onClick) {
    if (dragCleanup.current) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* unsupported */ }
    const startX = e.clientX, startY = e.clientY;
    const origin = new Map(targets.map((t) => [t.id, t]));
    let latest = new Map();
    function move(ev) {
      const s = scaleRef.current || 1;
      const dx = (ev.clientX - startX) / s, dy = (ev.clientY - startY) / s;
      latest = new Map(targets.map((t) => [t.id, apply(t, dx, dy)]));
      setDrag(latest);
    }
    function removeListeners() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      dragCleanup.current = null;
    }
    // A canceled gesture (pointercancel never fires pointerup) discards the
    // drag — detach listeners and clear the preview so the lifecycle isn't stuck.
    function cancel() {
      removeListeners();
      setDrag(null);
    }
    function up() {
      removeListeners();
      setDrag(null);
      // One atomic commit, carrying only elements whose geometry actually
      // changed. A click or a snap-back-to-origin gesture moves nothing, so it
      // commits nothing and is treated as a click instead.
      const moved = new Map();
      latest.forEach((el, id) => {
        const o = origin.get(id);
        if (!o || el.x !== o.x || el.y !== o.y || el.w !== o.w || el.h !== o.h) moved.set(id, el);
      });
      if (moved.size) onUpdateElements?.(moved);
      else onClick?.();
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    dragCleanup.current = removeListeners;
  }

  function startMove(e, el) {
    const inSelection = selectedSet.has(el.id);
    const additive = !!e.shiftKey;
    // Select on pointer-down so a drag has the right targets. Shift-removing an
    // already-selected element is deferred to pointer-up (only when it's a click,
    // not a drag) so shift-dragging a selected element still moves the selection.
    if (!inSelection) onSelectElement?.(el.id, additive);
    // Drag the whole selection when the grabbed element is part of it. A
    // shift-grab adds this element, so drag the combined set; otherwise just it.
    const targets = inSelection ? selected : additive ? [...selected, el] : [el];
    const onClick = additive && inSelection ? () => onSelectElement?.(el.id, true) : undefined;
    startDrag(e, targets, (t, dx, dy) => moveElement(t, dx, dy), onClick);
  }
  function startResize(e, el, handle) {
    startDrag(e, [el], (t, dx, dy) => resizeElement(t, handle, dx, dy));
  }

  // Rubber-band selection: a drag on empty canvas sweeps a rectangle and selects
  // the elements it overlaps on pointer-up. A click (no drag) deselects.
  function startMarquee(e) {
    if (dragCleanup.current) return;
    // Primary button only — let right/middle clicks through to the context menu.
    if (e.button !== 0) return;
    const frame = frameRef.current;
    if (!frame) { onSelectElement?.(null); return; }
    e.preventDefault();
    e.stopPropagation();
    // The slide canvas is a fixed, non-scrolling scaled viewport, so the frame
    // rect is stable for the gesture — cache it once (no per-move layout read).
    const rect = frame.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const toSlide = (cx, cy) => {
      const s = scaleRef.current || 1;
      return { x: (cx - rect.left) / s, y: (cy - rect.top) / s };
    };
    const start = toSlide(startX, startY);
    let end = start;
    let moved = false; // a real sweep, not a jittery click
    function move(ev) {
      // Threshold in screen pixels so it doesn't shrink as the canvas zooms out.
      if (!moved && (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3)) moved = true;
      end = toSlide(ev.clientX, ev.clientY);
      if (moved) setMarquee({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
    }
    function removeListeners() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      dragCleanup.current = null;
    }
    function up() {
      removeListeners();
      setMarquee(null);
      // A real sweep selects the overlapped (live) elements; a bare click deselects.
      if (moved) onMarqueeSelect?.(elementsInMarquee(baseElementsRef.current, start.x, start.y, end.x, end.y));
      else onSelectElement?.(null);
    }
    function cancel() { removeListeners(); setMarquee(null); }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    dragCleanup.current = removeListeners;
  }

  return (
    <div className="slide-frame" ref={frameRef} style={{ width: `${Math.min(92, zoom)}%`, aspectRatio: '16/9' }}>
      <ScaledSlide>
        {renderSlide(liveSlide, deckCtx)}
      </ScaledSlide>

      {/* Interaction overlay — drag empty space to marquee-select, click to deselect. */}
      <div className="elements-overlay" style={{ position: 'absolute', inset: 0 }} onPointerDown={startMarquee}>
        {elements.map((el) => (
          <div
            key={el.id}
            className={`el-hit${selectedSet.has(el.id) ? ' selected' : ''}`}
            style={{
              position: 'absolute',
              left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale,
              cursor: 'move',
              outline: selectedSet.has(el.id) ? '1.5px solid oklch(0.62 0.2 265)' : '1px solid transparent',
            }}
            onPointerDown={(e) => startMove(e, el)}
          />
        ))}

        {resizeTarget && Object.entries(HANDLE_POS).map(([h, [fx, fy]]) => (
          <div
            key={h}
            className="sel-handle"
            style={{
              position: 'absolute',
              left: (resizeTarget.x + resizeTarget.w * fx) * scale - 4,
              top: (resizeTarget.y + resizeTarget.h * fy) * scale - 4,
              cursor: HANDLE_CURSOR[h],
            }}
            onPointerDown={(e) => startResize(e, resizeTarget, h)}
          />
        ))}

        {marquee && (
          <div
            className="marquee-rect"
            style={{
              position: 'absolute',
              left: Math.min(marquee.x1, marquee.x2) * scale,
              top: Math.min(marquee.y1, marquee.y2) * scale,
              width: Math.abs(marquee.x2 - marquee.x1) * scale,
              height: Math.abs(marquee.y2 - marquee.y1) * scale,
              border: '1px solid oklch(0.62 0.2 265)',
              background: 'oklch(0.62 0.2 265 / 0.12)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}
