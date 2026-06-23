import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';
import { LAYOUT_LABELS, LayoutGrid } from './LayoutGrid.jsx';

export default function LayoutMenu({ current, onPick }) {
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
      <button className={`select${open ? ' open' : ''}`} onClick={() => setOpen(v => !v)}>
        <Icon name="template" size={13} /> <span className="tb-select-value">{LAYOUT_LABELS[current] || 'Blank'}</span> <Icon name="chevron-down" size={11} className="chev" />
      </button>
      {open && (
        <div className="menu-pop">
          <div className="tsp-label" style={{ textAlign: 'left', marginBottom: 6 }}>Change layout</div>
          <LayoutGrid current={current} onPick={(id) => { onPick?.(id); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}
