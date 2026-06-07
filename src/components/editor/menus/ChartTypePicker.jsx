import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';

const CHART_TYPES = [
  { id: 'line', label: 'Line', draw: <polyline points="3,17 9,11 14,13 21,5" fill="none" stroke="currentColor" strokeWidth="2" /> },
  { id: 'bar', label: 'Bar', draw: <g fill="currentColor"><rect x="3" y="11" width="4" height="8" /><rect x="10" y="6" width="4" height="13" /><rect x="17" y="9" width="4" height="10" /></g> },
  { id: 'area', label: 'Area', draw: <g><polygon points="3,17 9,11 14,13 21,5 21,19 3,19" fill="currentColor" opacity="0.25" /><polyline points="3,17 9,11 14,13 21,5" fill="none" stroke="currentColor" strokeWidth="2" /></g> },
  { id: 'donut', label: 'Donut', draw: <g fill="none" stroke="currentColor" strokeWidth="4"><circle cx="12" cy="12" r="8" opacity="0.25" /><path d="M12 4 a8 8 0 0 1 7 11" /></g> },
];

export default function ChartTypePicker({ onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={`btn ghost icon-caret${open ? ' active' : ''}`} title="Add chart" style={open ? { background: 'var(--bg-3)', color: 'var(--ink)' } : null} onClick={() => setOpen(v => !v)}>
        <Icon name="chart-bar" size={14} /> <Icon name="chevron-down" size={11} style={{ color: 'var(--ink-4)' }} />
      </button>
      {open && (
        <div className="ctp-pop">
          <div className="tsp-label">Chart type</div>
          <div className="ctp-grid">
            {CHART_TYPES.map(ct => (
              <button key={ct.id} className="ctp-cell" onClick={() => { onPick && onPick(ct.id); setOpen(false); }}>
                <svg viewBox="0 0 24 24" width="38" height="38">{ct.draw}</svg>
                <span>{ct.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
