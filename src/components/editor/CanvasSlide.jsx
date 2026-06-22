import React, { useState, useEffect, useRef } from 'react';
import { ScaledSlide } from '../ui/Primitives.jsx';
import { moveElement, resizeElement, elementsInMarquee, rotateElement, hitBox, snap, snapDrawnBox, expandToGroups, resizeGroup, rotateGroup, selectionBounds } from '../../lib/elements.js';
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
// Rotate a box about its centre — shared by the hit-box outline and the
// selection frame so both track the rotated content identically (one source of
// truth for the transform + origin).
const rotStyle = (rot) => (rot ? { transform: `rotate(${rot}deg)`, transformOrigin: 'center' } : null);

// The 8 resize handles + rotate knob inside a selection frame (one element or a
// group). The enclosing frame positions/rotates the box; this fills it.
// onResize(handle, event) and onRotate(event) wire the gesture to either the
// single-element (resizeElement/rotateElement) or group (resizeGroup/rotateGroup) path.
function TransformHandles({ w, h, onResize, onRotate }) {
  return (
    <>
      {Object.entries(HANDLE_POS).map(([hk, [fx, fy]]) => (
        <div
          key={hk}
          className="sel-handle"
          data-handle={hk}
          style={{ position: 'absolute', left: w * fx - 4, top: h * fy - 4, cursor: HANDLE_CURSOR[hk], pointerEvents: 'auto' }}
          onPointerDown={(e) => onResize(hk, e)}
        />
      ))}
      {/* stem from the top-center handle up to the rotate knob */}
      <div style={{ position: 'absolute', left: w / 2 - 0.5, top: -22, width: 1, height: 22, background: 'oklch(0.62 0.2 265)' }} />
      <div
        className="rotate-handle"
        style={{ position: 'absolute', left: w / 2 - 6, top: -28, width: 12, height: 12, borderRadius: '50%', border: '1.5px solid oklch(0.62 0.2 265)', background: 'white', cursor: 'grab', pointerEvents: 'auto' }}
        onPointerDown={onRotate}
      />
    </>
  );
}

// Normalize two sweep corners into a positive-size box — shared by the draw
// gesture's commit and the marquee/draw preview rectangle.
const boxFromCorners = (x1, y1, x2, y2) => ({
  x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
});

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

export default function CanvasSlide({ slide, deckCtx, renderSlide, zoom, selectedIds = [], onSelectElement, onUpdateElements, onMarqueeSelect, drawTool = null, onDrawElement }) {
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

  // Coerce + drop falsy entries at the source so every downstream use (drag map,
  // selection, hit boxes) gets real elements — matches the export's filtering and
  // guards against a malformed deck/MCP write ({} or a null entry).
  const baseElements = (Array.isArray(slide.elements) ? slide.elements : []).filter(Boolean);
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
  // Selection-frame box in screen px (only meaningful when there's a target).
  const fw = resizeTarget ? resizeTarget.w * scale : 0;
  const fh = resizeTarget ? resizeTarget.h * scale : 0;
  // A 2+ selection gets a group transform frame: an axis-aligned bbox whose
  // handles scale / rotate the whole selection as a unit (resizeGroup/rotateGroup).
  const groupBounds = !drawTool && selected.length >= 2 ? selectionBounds(selected) : null;
  const gw = groupBounds ? (groupBounds.x2 - groupBounds.x1) * scale : 0;
  const gh = groupBounds ? (groupBounds.y2 - groupBounds.y1) * scale : 0;
  // The marquee/draw preview rectangle (slide coords), normalized from its corners.
  const marqueeBox = marquee ? boxFromCorners(marquee.x1, marquee.y1, marquee.x2, marquee.y2) : null;

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
    // Map a screen position to the dragged elements' new geometry (+ any
    // alignment guides). Shared by move() and up() so the release position is
    // authoritative — a fast flick may emit no pointermove past the threshold.
    const computeAt = (cx, cy) => {
      const s = scaleRef.current || 1;
      const dx = (cx - startX) / s, dy = (cy - startY) / s;
      const map = new Map(targets.map((t) => [t.id, apply(t, dx, dy)]));
      if (snapping) {
        const id = targets[0].id;
        const m = map.get(id);
        const r = alignSnap(m, snapOthers);
        map.set(id, { ...m, x: r.x, y: r.y });
        return { map, guides: r.guides };
      }
      return { map, guides: [] };
    };
    function move(ev) {
      if (!swept(ev.clientX, ev.clientY)) return;
      const { map, guides } = computeAt(ev.clientX, ev.clientY);
      latest = map;
      setGuides(guides);
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
    function up(ev) {
      removeListeners();
      setDrag(null);
      // The release position is authoritative: a fast flick can deliver no
      // pointermove past the sweep threshold, leaving `latest` empty. Recompute
      // from the release coords when it swept (matches startRotate).
      if (swept(ev.clientX, ev.clientY)) latest = computeAt(ev.clientX, ev.clientY).map;
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
    // Drag the whole selection when the grabbed element is part of it. Otherwise
    // drag the grabbed element's GROUP (expandToGroups → just [el] if ungrouped),
    // so a group moves as a unit on the first drag — the pointer-down selection
    // above is async, so the targets can't read it yet. A shift-grab adds that set.
    const grabIds = new Set(expandToGroups(baseElements, [el.id]));
    const grabbed = baseElements.filter((x) => grabIds.has(x.id));
    const targets = inSelection ? selected : additive ? [...new Set([...selected, ...grabbed])] : grabbed;
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

  // Only the selected elements out of a full transformed array (for preview/commit).
  function selectedMap(next) {
    return new Map(next.filter((el) => selectedSet.has(el.id)).map((el) => [el.id, el]));
  }
  // Shared pointer scaffold for the group bbox handles: tracks the drag in slide
  // space, previews via setDrag, commits the CHANGED selection on pointer-up.
  // `computeMap` (current slide point, start slide point) → Map<id, transformed
  // el>; `origin` is the pre-drag geometry, used to drop no-op writes (as startDrag does).
  function beginGroupDrag(e, computeMap, origin) {
    if (dragCleanup.current || e.button !== 0) return;
    const frame = frameRef.current;
    if (!frame) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* unsupported */ }
    const rect = frame.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const start = toSlide(rect, startX, startY);
    const swept = (cx, cy) => Math.abs(cx - startX) > 3 || Math.abs(cy - startY) > 3;
    let latest = null; // last previewed transform; committed on pointer-up
    function move(ev) {
      if (!swept(ev.clientX, ev.clientY)) return;
      latest = computeMap(toSlide(rect, ev.clientX, ev.clientY), start);
      setDrag(latest);
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
      // Recompute from the RELEASE position whenever it carries coords (even
      // within the start threshold), so "drag out then back to start" commits
      // the final transform — which the origin filter then drops as a no-op. A
      // coordless flick keeps the last previewed transform instead.
      if (Number.isFinite(ev.clientX) && Number.isFinite(ev.clientY)) latest = computeMap(toSlide(rect, ev.clientX, ev.clientY), start);
      if (!latest) return;
      // Commit only elements whose geometry actually changed — a swept-but-net-
      // zero drag (or a snap-back) shouldn't write the deck / push an undo entry.
      const moved = new Map();
      latest.forEach((el, id) => {
        const o = origin?.get(id);
        // Normalize rot (a zero-delta rotation stamps rot:0 on an unrotated
        // element — 0 == "no rot", not a change), like the single-element path.
        if (!o || el.x !== o.x || el.y !== o.y || el.w !== o.w || el.h !== o.h || (el.rot ?? 0) !== (o.rot ?? 0)) moved.set(id, el);
      });
      if (moved.size) onUpdateElements?.(moved);
    }
    function cancel() { removeListeners(); setDrag(null); }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    dragCleanup.current = removeListeners;
  }
  // Group resize: the slide-space drag delta scales every selected child from
  // the edge opposite the dragged handle (resizeGroup operates on the bbox).
  function startGroupResize(e, handle) {
    const base = baseElements, ids = selectedIds;
    beginGroupDrag(e, (p, start) => selectedMap(resizeGroup(base, ids, handle, p.x - start.x, p.y - start.y)), selectedMap(base));
  }
  // Group rotate: the angle the pointer sweeps about the bbox centre becomes the
  // delta applied to every selected child (orbit + own rot) via rotateGroup.
  function startGroupRotate(e) {
    const base = baseElements, ids = selectedIds;
    const origin = selectedMap(base);
    const b = selectionBounds(selected), center = [b.cx, b.cy];
    beginGroupDrag(e, (p, start) => {
      const delta = (Math.atan2(p.y - center[1], p.x - center[0]) - Math.atan2(start.y - center[1], start.x - center[0])) * 180 / Math.PI;
      return selectedMap(rotateGroup(base, ids, delta, center));
    }, origin);
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

  // Draw a new element: with a draw tool active, a sweep on the canvas defines
  // the element's box; a click (no sweep) drops a default-size one at the point.
  // Reuses the marquee rectangle as the live preview; commits via onDrawElement.
  function startDraw(e, type) {
    const frame = frameRef.current;
    if (!frame) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = frame.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const start = toSlide(rect, startX, startY);
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
      setMarquee(null);
    }
    function up(ev) {
      removeListeners();
      // The release position is authoritative (a fast flick may emit no move).
      if (swept(ev.clientX, ev.clientY)) {
        const p = toSlide(rect, ev.clientX, ev.clientY);
        // Grid-snap + per-type floor the drawn box (snapDrawnBox), so a draw
        // aligns like move/resize and an on-axis sweep can't make a degenerate one.
        onDrawElement?.(type, snapDrawnBox(type, boxFromCorners(start.x, start.y, p.x, p.y)));
      } else {
        onDrawElement?.(type, { x: snap(start.x), y: snap(start.y) }); // click → factory default size
      }
    }
    function cancel() { removeListeners(); }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    dragCleanup.current = removeListeners;
  }

  // Rubber-band selection: a drag on empty canvas sweeps a rectangle and selects
  // the elements it overlaps on pointer-up. A click (no drag) deselects.
  function startMarquee(e) {
    if (dragCleanup.current) return;
    // Primary button only — let right/middle clicks through to the context menu.
    if (e.button !== 0) return;
    // A draw tool turns the empty-canvas sweep into element creation instead.
    if (drawTool) return startDraw(e, drawTool);
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

      {/* Interaction overlay — drag empty space to marquee-select, click to deselect.
          With a draw tool active it becomes a drawing surface (crosshair). */}
      <div className="elements-overlay" style={{ position: 'absolute', inset: 0, cursor: drawTool ? 'crosshair' : undefined }} onPointerDown={startMarquee} onDoubleClick={focusTextUnder}>
        {elements.map((el) => {
          // Click/selection target is padded to a minimum (hitBox) so a thin rule
          // is grabbable and shows a visible outline. Only the click+outline pads:
          // the VISUAL (ElementsLayer), the resize handles below, and marquee
          // selection (`elementsInMarquee`) all use the element's true geometry —
          // marquee tests what visually intersects the sweep, padding is just for
          // acquiring a precise thin target by click.
          const hb = hitBox(el);
          return (
            <div
              key={el.id}
              className={`el-hit${selectedSet.has(el.id) ? ' selected' : ''}`}
              style={{
                position: 'absolute',
                left: hb.x * scale, top: hb.y * scale, width: hb.w * scale, height: hb.h * scale,
                // Match the rotated content so the outline and hit area sit on the
                // element (move is a screen translation, so the math is unchanged).
                ...rotStyle(el.rot),
                cursor: 'move',
                // In draw mode, let the pointer fall through to the overlay so a
                // sweep starting over an element still draws a new one.
                pointerEvents: drawTool ? 'none' : undefined,
                outline: selectedSet.has(el.id) ? '1.5px solid oklch(0.62 0.2 265)' : '1px solid transparent',
              }}
              onPointerDown={(e) => startMove(e, el)}
            />
          );
        })}

        {/* Selection frame: positioned at the element box and rotated with it,
            so the resize handles and rotate knob sit on the rotated element's
            edges. Handles/knob are placed relative to the box (px within it). */}
        {resizeTarget && !drawTool && (
          <div
            style={{
              position: 'absolute',
              left: resizeTarget.x * scale, top: resizeTarget.y * scale,
              width: fw, height: fh,
              ...rotStyle(resizeTarget.rot),
              pointerEvents: 'none',
            }}
          >
            <TransformHandles w={fw} h={fh} onResize={(h, e) => startResize(e, resizeTarget, h)} onRotate={(e) => startRotate(e, resizeTarget)} />
          </div>
        )}

        {/* Group transform frame: an axis-aligned box around a 2+ selection. Its
            handles scale (startGroupResize) and the knob rotates (startGroupRotate)
            the whole selection as a unit. No rotStyle — children rotate individually. */}
        {groupBounds && (
          <div
            style={{
              position: 'absolute',
              left: groupBounds.x1 * scale, top: groupBounds.y1 * scale,
              width: gw, height: gh,
              pointerEvents: 'none',
            }}
          >
            <TransformHandles w={gw} h={gh} onResize={(h, e) => startGroupResize(e, h)} onRotate={startGroupRotate} />
          </div>
        )}

        {guides.map((g) => (
          <div
            key={g.axis}
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

        {marqueeBox && (
          <div
            className="marquee-rect"
            style={{
              position: 'absolute',
              left: marqueeBox.x * scale, top: marqueeBox.y * scale, width: marqueeBox.w * scale, height: marqueeBox.h * scale,
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
