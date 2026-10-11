import React, { useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { readGeneralSettings } from '../../lib/generalSettings.js';
import { GRID, SLIDE_W, SLIDE_H } from '../../lib/elements.js';

// Every value here is real: the slide size, and the Settings → General snapping
// and ruler toggles (read on mount, like the canvas that obeys them). Save state
// lives in the top bar's badge; there's no language setting to report.
export default function StatusBar({ zoom, setZoom, selected }) {
  const [{ snapToGrid, showRulers }] = useState(readGeneralSettings);
  return (
    <div className="statusbar">
      <span>{SLIDE_W}×{SLIDE_H}</span>
      <span>{snapToGrid ? `Snap: ${GRID}px grid + guides` : 'Snap: off'}</span>
      <span>Rulers: {showRulers ? 'on' : 'off'}</span>
      <span className="spacer" />
      {selected && <span style={{ color: 'var(--ink-2)' }}>{selected.label} · x {selected.x} y {selected.y} · w {selected.w} h {selected.h}</span>}
      <span className="spacer" />
      <div className="zoom">
        <button onClick={() => setZoom(z => Math.max(20, z - 8))}><Icon name="minus" size={11} /></button>
        <span className="val">{zoom}%</span>
        <button onClick={() => setZoom(z => Math.min(200, z + 8))}><Icon name="plus" size={11} /></button>
        <button onClick={() => setZoom(62)} title="Fit"><Icon name="expand" size={11} /></button>
      </div>
    </div>
  );
}
