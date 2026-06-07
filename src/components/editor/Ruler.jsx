import React from 'react';

export default function Ruler() {
  const ticks = Array.from({ length: 21 }, (_, i) => i * 100);
  return (
    <>
      <div className="canvas-ruler-h">
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {ticks.map((t, i) => (
            <div key={i} style={{ flex: 1, borderLeft: i === 0 ? 'none' : '1px solid var(--line)', paddingLeft: 3, paddingTop: 4, fontSize: 9, color: 'var(--ink-4)' }}>{t}</div>
          ))}
        </div>
      </div>
      <div className="canvas-ruler-v">
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
          {ticks.slice(0, 12).map((t, i) => (
            <div key={i} style={{ flex: 1, borderTop: i === 0 ? 'none' : '1px solid var(--line)', paddingTop: 3, paddingLeft: 2, fontSize: 9, color: 'var(--ink-4)' }}>{t}</div>
          ))}
        </div>
      </div>
    </>
  );
}
