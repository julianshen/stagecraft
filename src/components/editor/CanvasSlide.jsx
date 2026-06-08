import React, { useState, useEffect, useRef } from 'react';
import { ScaledSlide } from '../ui/Primitives.jsx';
import { moveElement, resizeElement } from '../../lib/elements.js';

const HANDLES = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
const HANDLE_CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};
// Handle offset (fraction of the box) — 0 = start edge, 0.5 = middle, 1 = end edge.
const HANDLE_POS = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0],
  w: [0, 0.5], e: [1, 0.5],
  sw: [0, 1], s: [0.5, 1], se: [1, 1],
};

export default function CanvasSlide({ slide, deckCtx, renderSlide, zoom, selectedId, onSelectElement, onUpdateElement }) {
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

  const elements = slide.elements || [];
  const selected = elements.find(e => e.id === selectedId) || null;

  // Generic pointer-drag: maps screen movement to slide coords and applies `apply`.
  function startDrag(e, el, apply) {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    function move(ev) {
      const s = scaleRef.current || 1;
      const dx = (ev.clientX - startX) / s;
      const dy = (ev.clientY - startY) / s;
      onUpdateElement?.(el.id, apply(dx, dy));
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const startMove = (e, el) => { onSelectElement?.(el.id); startDrag(e, el, (dx, dy) => moveElement(el, dx, dy)); };
  const startResize = (e, el, handle) => startDrag(e, el, (dx, dy) => resizeElement(el, handle, dx, dy));

  return (
    <div className="slide-frame" ref={frameRef} style={{ width: `${Math.min(92, zoom)}%`, aspectRatio: '16/9' }}>
      <ScaledSlide>
        {renderSlide(slide, deckCtx)}
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

        {selected && HANDLES.map((h) => {
          const [fx, fy] = HANDLE_POS[h];
          const left = (selected.x + selected.w * fx) * scale - 4;
          const top = (selected.y + selected.h * fy) * scale - 4;
          return (
            <div
              key={h}
              className="sel-handle"
              style={{ position: 'absolute', left, top, cursor: HANDLE_CURSOR[h] }}
              onPointerDown={(e) => startResize(e, selected, h)}
            />
          );
        })}
      </div>
    </div>
  );
}
