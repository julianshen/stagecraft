import React, { useState, useEffect, useRef } from 'react';
import { ScaledSlide } from '../ui/Primitives.jsx';
import { moveElement, resizeElement } from '../../lib/elements.js';

const HANDLE_CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};
// Handle offset (fraction of the box): 0 = start edge, 0.5 = middle, 1 = end.
const HANDLE_POS = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0],
  w: [0, 0.5], e: [1, 0.5],
  sw: [0, 1], s: [0.5, 1], se: [1, 1],
};

export default function CanvasSlide({ slide, deckCtx, renderSlide, zoom, selectedId, onSelectElement, onUpdateElement }) {
  const frameRef = useRef(null);
  const [scale, setScale] = useState(0.5);
  const scaleRef = useRef(scale); // latest scale for the drag closure
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

  // Live drag preview: { id, el } while dragging. The deck is only updated once,
  // on pointer-up — so a drag doesn't fire a deck mutation (and a server PUT) on
  // every frame. Cleared on commit.
  const [drag, setDrag] = useState(null);
  const dragCleanup = useRef(null);
  useEffect(() => () => dragCleanup.current?.(), []); // tear down a drag if we unmount mid-drag

  const baseElements = slide.elements || [];
  const elements = drag ? baseElements.map((e) => (e.id === drag.id ? drag.el : e)) : baseElements;
  const liveSlide = drag ? { ...slide, elements } : slide;
  const selected = elements.find((e) => e.id === selectedId) || null;

  function startDrag(e, startEl, apply) {
    if (dragCleanup.current) return; // a drag is already active
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* jsdom / unsupported */ }
    const startX = e.clientX, startY = e.clientY;
    let latest = startEl;
    function move(ev) {
      const s = scaleRef.current || 1;
      latest = apply((ev.clientX - startX) / s, (ev.clientY - startY) / s);
      setDrag({ id: startEl.id, el: latest });
    }
    function removeListeners() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragCleanup.current = null;
    }
    function up() {
      removeListeners();
      setDrag(null);
      onUpdateElement?.(startEl.id, latest);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    // On unmount mid-drag, only detach listeners (no setState on an unmounted tree).
    dragCleanup.current = removeListeners;
  }

  function startMove(e, el) {
    onSelectElement?.(el.id);
    startDrag(e, el, (dx, dy) => moveElement(el, dx, dy));
  }
  function startResize(e, el, handle) {
    startDrag(e, el, (dx, dy) => resizeElement(el, handle, dx, dy));
  }

  return (
    <div className="slide-frame" ref={frameRef} style={{ width: `${Math.min(92, zoom)}%`, aspectRatio: '16/9' }}>
      <ScaledSlide>
        {renderSlide(liveSlide, deckCtx)}
      </ScaledSlide>

      {/* Interaction overlay — click empty space to deselect. */}
      <div style={{ position: 'absolute', inset: 0 }} onPointerDown={() => onSelectElement?.(null)}>
        {elements.map((el) => (
          <div
            key={el.id}
            className={`el-hit${el.id === selectedId ? ' selected' : ''}`}
            style={{
              position: 'absolute',
              left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale,
              cursor: 'move',
              outline: el.id === selectedId ? '1.5px solid oklch(0.62 0.2 265)' : '1px solid transparent',
            }}
            onPointerDown={(e) => startMove(e, el)}
          />
        ))}

        {selected && Object.entries(HANDLE_POS).map(([h, [fx, fy]]) => (
          <div
            key={h}
            className="sel-handle"
            style={{
              position: 'absolute',
              left: (selected.x + selected.w * fx) * scale - 4,
              top: (selected.y + selected.h * fy) * scale - 4,
              cursor: HANDLE_CURSOR[h],
            }}
            onPointerDown={(e) => startResize(e, selected, h)}
          />
        ))}
      </div>
    </div>
  );
}
