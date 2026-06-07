import React, { useState, useEffect, useRef } from 'react';
import { ScaledSlide } from '../ui/Primitives.jsx';

export default function CanvasSlide({ slide, deckCtx, renderSlide, selected, setSelected, zoom }) {
  const frameRef = useRef(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    function update() {
      const el = frameRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setScale(r.width / 1920);
    }
    update();
    const ro = new ResizeObserver(update);
    if (frameRef.current) ro.observe(frameRef.current);
    return () => ro.disconnect();
    // Observe once on mount — the ResizeObserver already catches zoom-driven
    // size changes, so there's no need to tear it down and rebuild on every zoom.
  }, []);

  const rect = selected ? {
    left: selected.x * scale,
    top: selected.y * scale,
    width: selected.w * scale,
    height: selected.h * scale,
  } : null;

  return (
    <div className="slide-frame" ref={frameRef} style={{ width: `${Math.min(92, zoom)}%`, aspectRatio: '16/9' }}>
      <ScaledSlide>
        {renderSlide(slide, deckCtx)}
      </ScaledSlide>
      {rect && (
        <>
          <div className="sel-rect" style={rect}>
            <div className="sel-label">{selected.label} · {selected.w}×{selected.h}</div>
          </div>
          {[
            [rect.left - 4, rect.top - 4], [rect.left + rect.width / 2 - 4, rect.top - 4], [rect.left + rect.width - 4, rect.top - 4],
            [rect.left - 4, rect.top + rect.height / 2 - 4], [rect.left + rect.width - 4, rect.top + rect.height / 2 - 4],
            [rect.left - 4, rect.top + rect.height - 4], [rect.left + rect.width / 2 - 4, rect.top + rect.height - 4], [rect.left + rect.width - 4, rect.top + rect.height - 4],
          ].map(([x, y], i) => (
            <div key={i} className="sel-handle" style={{ left: x, top: y }} />
          ))}
          <div className="guide-line" style={{ left: rect.left, top: 0, bottom: 0, width: 1 }} />
          <div className="guide-line" style={{ left: rect.left + rect.width, top: 0, bottom: 0, width: 1 }} />
          <div style={{ position: 'absolute', left: rect.left + rect.width + 6, top: -18, fontSize: 10, fontFamily: 'var(--f-mono)', color: 'oklch(0.6 0.2 0)' }}>
            ↔ {Math.round(1920 - selected.x - selected.w)}px
          </div>
        </>
      )}
    </div>
  );
}
