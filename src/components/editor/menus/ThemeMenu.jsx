import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';

const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

const THEME_OPTIONS = [
  { id: 'indigo', label: 'Indigo', hue: 265, chroma: 0.17 },
  { id: 'emerald', label: 'Emerald', hue: 155, chroma: 0.13 },
  { id: 'amber', label: 'Amber', hue: 75, chroma: 0.15 },
  { id: 'coral', label: 'Coral', hue: 25, chroma: 0.17 },
  { id: 'magenta', label: 'Magenta', hue: 335, chroma: 0.18 },
  { id: 'slate', label: 'Slate', hue: 260, chroma: 0.04 },
];

export default function ThemeMenu({ current, onPick }) {
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
        <Icon name="palette" size={13} /> <span className="tb-select-value">{cap(current) || 'Default'}</span> <Icon name="chevron-down" size={11} className="chev" />
      </button>
      {open && (
        <div className="menu-pop" style={{ width: 180 }}>
          <div className="tsp-label" style={{ textAlign: 'left', marginBottom: 6 }}>Deck theme</div>
          {THEME_OPTIONS.map(o => (
            <button key={o.id} className={`theme-opt${current === o.id ? ' on' : ''}`} onClick={() => { onPick && onPick(o.id); setOpen(false); }}>
              <span className="theme-sw" style={{ background: `oklch(0.62 ${o.chroma} ${o.hue})` }} />
              <span className="theme-name">{o.label}</span>
              {current === o.id && <Icon name="check" size={13} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
