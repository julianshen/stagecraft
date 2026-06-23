import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';

const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

export const THEME_OPTIONS = [
  { id: 'indigo', label: 'Indigo', hue: 265, chroma: 0.17 },
  { id: 'emerald', label: 'Emerald', hue: 155, chroma: 0.13 },
  { id: 'amber', label: 'Amber', hue: 75, chroma: 0.15 },
  { id: 'coral', label: 'Coral', hue: 25, chroma: 0.17 },
  { id: 'magenta', label: 'Magenta', hue: 335, chroma: 0.18 },
  { id: 'slate', label: 'Slate', hue: 260, chroma: 0.04 },
];

// The accent a deck theme renders as — single-sourced so every swatch (this
// menu, the Design panel's grid, and its accent token) stays identical.
// Lightness is fixed at 0.62; each theme varies only chroma + hue.
export const accentColor = (o) => `oklch(0.62 ${o.chroma} ${o.hue})`;

// The same accent as a compact readout for the Design panel's Tokens row, e.g.
// "oklch(.62/.13/155)". The leading zero is dropped only when a decimal follows
// (`/^0(?=\.)/`), so a whole-number chroma like 0 stays "0" instead of
// collapsing to an empty "//" component.
export const accentLabel = (o) => `oklch(.62/${String(o.chroma).replace(/^0(?=\.)/, '')}/${o.hue})`;

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
              <span className="theme-sw" style={{ background: accentColor(o) }} />
              <span className="theme-name">{o.label}</span>
              {current === o.id && <Icon name="check" size={13} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
