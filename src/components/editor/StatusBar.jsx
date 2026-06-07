import React from 'react';
import Icon from '../ui/Icon.jsx';

export default function StatusBar({ zoom, setZoom, selected }) {
  return (
    <div className="statusbar">
      <span><span className="dot" style={{ background: 'var(--success)' }} />Saved · autosave on</span>
      <span>1920×1080</span>
      <span>Grid: 8px</span>
      <span>Guides: on</span>
      <span className="spacer" />
      {selected && <span style={{ color: 'var(--ink-2)' }}>{selected.label} · x {selected.x} y {selected.y} · w {selected.w} h {selected.h}</span>}
      <span className="spacer" />
      <span>en-US</span>
      <div className="zoom">
        <button onClick={() => setZoom(z => Math.max(20, z - 8))}><Icon name="minus" size={11} /></button>
        <span className="val">{zoom}%</span>
        <button onClick={() => setZoom(z => Math.min(200, z + 8))}><Icon name="plus" size={11} /></button>
        <button onClick={() => setZoom(62)} title="Fit"><Icon name="expand" size={11} /></button>
      </div>
    </div>
  );
}
