import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';

const TEXT_STYLES = [
  { id: 'heading', label: 'Heading', sample: 'Aa', size: '30px', weight: 700, desc: 'Large title' },
  { id: 'subheading', label: 'Subheading', sample: 'Aa', size: '20px', weight: 600, desc: 'Section label' },
  { id: 'body', label: 'Body', sample: 'Aa', size: '14px', weight: 400, desc: 'Paragraph text' },
];

export default function TextMenu({ onPick }) {
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
      <button className={`btn ghost icon-caret${open ? ' active' : ''}`} title="Add text" style={open ? { background: 'var(--bg-3)', color: 'var(--ink)' } : null} onClick={() => setOpen(v => !v)}>
        <Icon name="text" size={14} /> <Icon name="chevron-down" size={11} style={{ color: 'var(--ink-4)' }} />
      </button>
      {open && (
        <div className="menu-pop" style={{ width: 212 }}>
          <div className="tsp-label" style={{ textAlign: 'left', marginBottom: 6 }}>Add text</div>
          {TEXT_STYLES.map(t => (
            <button key={t.id} className="text-opt" onClick={() => { onPick && onPick(t.id); setOpen(false); }}>
              <span className="text-sample" style={{ fontSize: t.size, fontWeight: t.weight }}>{t.sample}</span>
              <span className="text-meta">
                <span className="text-name">{t.label}</span>
                <span className="text-desc">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
