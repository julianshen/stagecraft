import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';

const COMPONENT_GROUPS = [
  {
    group: 'Content', items: [
      { id: 'agenda', icon: 'list', label: 'Agenda', desc: 'Numbered sections' },
      { id: 'text', icon: 'text', label: 'Text', desc: 'Title + body' },
      { id: 'list', icon: 'list', label: 'Bullet list', desc: 'Numbered points' },
      { id: 'quote', icon: 'message', label: 'Quote', desc: 'Pull quote' },
      { id: 'divider', icon: 'flag', label: 'Section', desc: 'Chapter divider' },
    ]
  },
  {
    group: 'Data', items: [
      { id: 'kpi', icon: 'bolt', label: 'KPI grid', desc: 'Metric cards' },
    ]
  },
  {
    group: 'Planning', items: [
      { id: 'roadmap', icon: 'timeline', label: 'Roadmap', desc: 'Swimlane timeline' },
      { id: 'risks', icon: 'flag', label: 'Risks', desc: 'Severity list' },
    ]
  },
];

export default function ComponentMenu({ onPick }) {
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
      <button className={`iconbtn${open ? ' active' : ''}`} title="Components" onClick={() => setOpen(v => !v)}>
        <Icon name="component" size={14} />
      </button>
      {open && (
        <div className="cmp-pop">
          <div className="tsp-label" style={{ textAlign: 'left', marginBottom: 6 }}>Insert component</div>
          {COMPONENT_GROUPS.map(g => (
            <div key={g.group} className="cmp-group">
              <div className="cmp-group-label">{g.group}</div>
              {g.items.map(it => (
                <button key={it.id} className="cmp-item" onClick={() => { onPick && onPick(it.id); setOpen(false); }}>
                  <span className="cmp-ic"><Icon name={it.icon} size={14} /></span>
                  <span className="cmp-meta">
                    <span className="cmp-name">{it.label}</span>
                    <span className="cmp-desc">{it.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
