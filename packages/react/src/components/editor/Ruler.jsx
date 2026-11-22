import React, { useState } from 'react';
import { readGeneralSettings } from '../../lib/generalSettings.js';

export default function Ruler() {
  // Settings→General "Show rulers" (AC-5.1), read ONCE per mount: the Settings
  // and editor views never coexist, so a toggle flip is picked up by the
  // remount on the next view switch — no storage listener needed (same policy
  // as CanvasSlide's snap-to-grid read).
  const [{ showRulers }] = useState(readGeneralSettings);
  const ticks = Array.from({ length: 21 }, (_, i) => i * 100);
  if (!showRulers) return null;
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
