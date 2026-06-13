import React, { useState, useEffect, useRef } from 'react';
import { ScaledSlide } from '../ui/Primitives.jsx';
import { moveElement, resizeElement, elementsInMarquee, rotateElement } from '../../lib/elements.js';
import { alignSnap } from '../../lib/align.js';

const HANDLE_CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};
const HANDLE_POS = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0],
  w: [0, 0.5], e: [1, 0.5],
  sw: [0, 1], s: [0.5, 1], se: [1, 1],
};

// A caret Range at a viewport point, across browsers: Chrome/Safari expose
// caretRangeFromPoint; Firefox exposes caretPositionFromPoint instead.
function caretRangeAt(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  const pos = document.caretPositionFromPoint?.(x, y);
  if (pos) {
    const r = document.createRange();
    r.setStart(pos.offsetNode, pos.offset);
    r.collapse(true);
    return r;
  }
  return null;
}

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
  // Active alignment guide lines (slide coords) while dragging a single element.
  const [guides, setGuides] = useState([]);
  const dragCleanup = useRef(null);
  useEffect(() => () => dragCleanup.current?.(), []);

  const baseElements = slide.elements || [];
  // Latest elements for the marquee's pointer-up (the deck can change mid-drag).
  const baseElementsRef = useRef(baseElements);
  baseElementsRef.current = baseElements;
  // Map a screen point to slide coords against a cached frame rect (px → 1920×1080).
  const toSlide = (rect, cx, cy) => {
    const s = scaleRef.current || 1;
    return { x: (cx - rect.left) / s, y: (cy - rect.top) / s };
  };

  const selectedSet = new Set(selectedIds);
  const elements = drag ? baseElements.map((e) => drag.get(e.id) || e) : baseElements;
  const liveSlide = drag ? { ...slide, elements } : slide;
  const selected = elements.filter((e) => selectedSet.has(e.id));
  // Resize handles only when exactly one element is selected.
  const resizeTarget = selected.length === 1 ? selected[0] : null;

  // Drag `targets` (array): each pointermove maps the screen delta to slide
  // coords and applies `apply(el, dx, dy)`; commits once on pointer-up.
  function startDrag(e, targets, apply, onClick, snapOthers) {
    if (dragCleanup.current) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* unsupported */ }
    const startX = e.clientX, startY = e.clientY;
    const origin = new Map(targets.map((t) => [t.id, t]));
    // Snap to alignment guides only for a single-element move (snapOthers given).
    const snapping = snapOthers && targets.length === 1;
    let latest = new Map();
    // Ignore sub-threshold jitter so a click (which can emit a 0-delta
    // pointermove) isn't treated as a drag — important now that snapping can
    // nudge an element to a non-grid position, which would otherwise turn a
    // click near a guide into a spurious move-commit. (Matches marquee/rotate.)
    const swept = (cx, cy) => Math.abs(cx - startX) > 3 || Math.abs(cy - startY) > 3;
    function move(ev) {
      if (!swept(ev.clientX, ev.clientY)) return;
      const s = scaleRef.current || 1;
      const dx = (ev.clientX - startX) / s, dy = (ev.clientY - startY) / s;
      latest = new Map(targets.map((t) => [t.id, apply(t, dx, dy)]));
      if (snapping) {
        const [id, m] = [...latest][0];
        const r = alignSnap(m, snapOthers);
        latest.set(id, { ...m, x: r.x, y: r.y });
        setGuides(r.guides);
      }
      setDrag(latest);
    }
    function removeListeners() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      dragCleanup.current = null;
      setGuides([]); // clear guides when the gesture ends
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
    // Snap a lone dragged element against the others (and the slide edges/centre).
    const snapOthers = targets.length === 1 ? baseElements.filter((x) => x.id !== targets[0].id) : null;
    startDrag(e, targets, (t, dx, dy) => moveElement(t, dx, dy), onClick, snapOthers);
  }
  function startResize(e, el, handle) {
    startDrag(e, [el], (t, dx, dy) => resizeElement(t, handle, dx, dy));
  }

  // Rotate the single selected element: the handle drags around the element's
  // center, with `rot` derived from the pointer angle (commits on pointer-up).
  function startRotate(e, el) {
    if (dragCleanup.current) return;
    if (e.button !== 0) return;
    const frame = frameRef.current;
    if (!frame) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* unsupported */ }
    const rect = frame.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    // A real drag past a screen-pixel threshold — a click on the handle must not
    // rotate (it would otherwise snap the element to the handle's angle).
    const swept = (cx, cy) => Math.abs(cx - startX) > 3 || Math.abs(cy - startY) > 3;
    function move(ev) {
      if (!swept(ev.clientX, ev.clientY)) return;
      const p = toSlide(rect, ev.clientX, ev.clientY);
      setDrag(new Map([[el.id, rotateElement(el, p.x, p.y)]]));
    }
    function removeListeners() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      dragCleanup.current = null;
    }
    function up(ev) {
      removeListeners();
      setDrag(null);
      if (!swept(ev.clientX, ev.clientY)) return; // a click, not a rotation
      // The release position is authoritative (a fast flick may deliver no
      // pointermove). Commit only when the angle actually changed — a missing
      // rot means the default 0°, so normalize before comparing.
      const p = toSlide(rect, ev.clientX, ev.clientY);
      const rotated = rotateElement(el, p.x, p.y);
      if (rotated.rot !== (el.rot ?? 0)) onUpdateElements?.(new Map([[el.id, rotated]]));
    }
    function cancel() { removeListeners(); setDrag(null); }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    dragCleanup.current = removeListeners;
  }

  // The interaction overlay sits above the slide, so a double-click on a text
  // field never reaches it. Hit-test through the overlay (briefly disabling its
  // own pointer events), and if the point lands on an editable field, focus it
  // and drop the caret where the user clicked — that starts an inline text edit.
  function focusTextUnder(e) {
    const overlay = e.currentTarget;
    const prev = overlay.style.pointerEvents;
    // Hit-test AND read the caret range while the overlay is disabled, so both
    // resolve against the slide text beneath it (not the overlay itself). The
    // restore is in `finally` so a throwing DOM call can't leave the overlay
    // permanently disabled (which would kill all drag/marquee interaction).
    let hit, range;
    try {
      overlay.style.pointerEvents = 'none';
      hit = document.elementFromPoint?.(e.clientX, e.clientY);
      range = caretRangeAt(e.clientX, e.clientY);
    } finally {
      overlay.style.pointerEvents = prev;
    }
    // Our inline fields always render contenteditable="true" (EditableText sets
    // `contentEditable`), so match that exactly — precise and testable, vs
    // isContentEditable which jsdom doesn't compute.
    const field = hit?.closest?.('[contenteditable="true"]');
    if (!field) return;
    field.focus();
    // Keep the overlay out of the way for the duration of the edit so the
    // pointer reaches the text — repositioning the caret, drag-selecting — and
    // restore it when the field blurs (the editing session ends).
    overlay.style.pointerEvents = 'none';
    field.addEventListener('blur', () => { overlay.style.pointerEvents = prev; }, { once: true });
    const sel = document.getSelection?.();
    if (!sel) return;
    sel.removeAllRanges();
    if (range && field.contains(range.startContainer)) {
      sel.addRange(range); // caret where the user clicked
    } else {
      // Click landed off the text node (padding/edge) — caret at the field's end.
      const end = document.createRange();
      end.selectNodeContents(field);
      end.collapse(false);
      sel.addRange(end);
    }
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
    const start = toSlide(rect, startX, startY);
    // Sweep past a screen-pixel threshold (zoom-independent), not a jittery click.
    const swept = (cx, cy) => Math.abs(cx - startX) > 3 || Math.abs(cy - startY) > 3;
    function move(ev) {
      if (!swept(ev.clientX, ev.clientY)) return;
      const p = toSlide(rect, ev.clientX, ev.clientY);
      setMarquee({ x1: start.x, y1: start.y, x2: p.x, y2: p.y });
    }
    function removeListeners() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      dragCleanup.current = null;
    }
    function up(ev) {
      removeListeners();
      setMarquee(null);
      // The release position is authoritative — a fast flick may deliver no
      // pointermove at the release point. A real sweep selects the overlapped
      // (live) elements; a bare click deselects.
      if (swept(ev.clientX, ev.clientY)) {
        const p = toSlide(rect, ev.clientX, ev.clientY);
        onMarqueeSelect?.(elementsInMarquee(baseElementsRef.current, start.x, start.y, p.x, p.y));
      } else {
        onSelectElement?.(null);
      }
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
      <div className="elements-overlay" style={{ position: 'absolute', inset: 0 }} onPointerDown={startMarquee} onDoubleClick={focusTextUnder}>
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

        {resizeTarget && (
          <>
            {/* stem from the top-center handle up to the rotate knob */}
            <div
              style={{
                position: 'absolute',
                left: (resizeTarget.x + resizeTarget.w / 2) * scale - 0.5,
                top: resizeTarget.y * scale - 22,
                width: 1, height: 22,
                background: 'oklch(0.62 0.2 265)',
                pointerEvents: 'none',
              }}
            />
            <div
              className="rotate-handle"
              style={{
                position: 'absolute',
                left: (resizeTarget.x + resizeTarget.w / 2) * scale - 6,
                top: resizeTarget.y * scale - 28,
                width: 12, height: 12,
                borderRadius: '50%',
                border: '1.5px solid oklch(0.62 0.2 265)',
                background: 'white',
                cursor: 'grab',
              }}
              onPointerDown={(e) => startRotate(e, resizeTarget)}
            />
          </>
        )}

        {guides.map((g, i) => (
          <div
            key={i}
            className="align-guide"
            style={{
              position: 'absolute',
              background: 'oklch(0.62 0.2 25)',
              pointerEvents: 'none',
              ...(g.axis === 'v'
                ? { left: g.pos * scale, top: 0, width: 1, height: '100%' }
                : { top: g.pos * scale, left: 0, height: 1, width: '100%' }),
            }}
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
