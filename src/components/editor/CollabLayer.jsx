import React from 'react';

export default function CollabLayer({ collaborators = [] }) {
  const positions = collaborators.length ? collaborators.map((u, i) => ({
    u, x: u.pos?.x || `${20 + i * 25}%`, y: u.pos?.y || `${40 + (i % 2) * 15}%`
  })) : [];
  return (
    <>
      {positions.map((p, i) => (
        <div key={i} className="cursor" style={{ left: p.x, top: p.y }}>
          <svg className="cursor-arrow" viewBox="0 0 16 16" fill={p.u.color}>
            <path d="M2 2l4 11 2-4 5-1z" stroke="white" strokeWidth="1" />
          </svg>
          <span className="cursor-label" style={{ background: p.u.color }}>{p.u.name}</span>
        </div>
      ))}
    </>
  );
}
