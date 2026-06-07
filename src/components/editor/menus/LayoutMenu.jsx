import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';

const LAYOUT_LABELS = {
  cover: 'Cover', agenda: 'Agenda', divider: 'Section', kpi: 'KPI grid', chart: 'Chart',
  split: 'Split', table: 'Table', text: 'Text', roadmap: 'Roadmap', risks: 'Risks',
  list: 'List', thanks: 'Closing',
};

const LAYOUT_OPTIONS = [
  { id: 'cover', icon: 'frame', label: 'Cover' },
  { id: 'agenda', icon: 'list', label: 'Agenda' },
  { id: 'divider', icon: 'flag', label: 'Section' },
  { id: 'kpi', icon: 'bolt', label: 'KPI grid' },
  { id: 'chart', icon: 'chart-bar', label: 'Chart' },
  { id: 'split', icon: 'columns', label: 'Split' },
  { id: 'table', icon: 'table', label: 'Table' },
  { id: 'text', icon: 'text', label: 'Text' },
  { id: 'list', icon: 'list', label: 'List' },
  { id: 'roadmap', icon: 'timeline', label: 'Roadmap' },
  { id: 'risks', icon: 'flag', label: 'Risks' },
  { id: 'thanks', icon: 'frame', label: 'Closing' },
];

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
          <div className="layout-grid">
            {LAYOUT_OPTIONS.map(o => (
              <button key={o.id} className={`layout-opt${current === o.id ? ' on' : ''}`} onClick={() => { onPick && onPick(o.id); setOpen(false); }}>
                <Icon name={o.icon} size={15} />
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
