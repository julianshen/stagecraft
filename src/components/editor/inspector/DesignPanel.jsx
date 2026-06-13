import React from 'react';
import Icon from '../../ui/Icon.jsx';

// The 6 deck themes (matching the toolbar Theme menu), each a representative
// swatch colour. Clicking one applies it via onChangeTheme.
const THEMES = [
  { key: 'indigo', c: 'oklch(0.62 0.17 265)' },
  { key: 'emerald', c: 'oklch(0.62 0.13 155)' },
  { key: 'amber', c: 'oklch(0.7 0.15 75)' },
  { key: 'coral', c: 'oklch(0.6 0.2 25)' },
  { key: 'magenta', c: 'oklch(0.6 0.18 335)' },
  { key: 'slate', c: 'oklch(0.55 0.03 255)' },
];
// Insertable components → createComponentSlide ids (via onAddComponent).
const COMPONENTS = [
  { label: 'KPI', id: 'kpi' }, { label: 'Chart', id: 'chart' }, { label: 'Table', id: 'table' }, { label: 'Agenda', id: 'agenda' },
  { label: 'List', id: 'list' }, { label: 'Risks', id: 'risks' }, { label: 'Roadmap', id: 'roadmap' }, { label: 'Quote', id: 'quote' },
];

export default function DesignPanel({ deck, onChangeTheme, onAddComponent }) {
  const theme = deck?.theme;
  return (
    <>
      {/* Layout style presets — display-only (these are abstract layout shapes,
          not the per-slide layouts, which the toolbar Layout menu changes). */}
      <div className="pane-section">
        <h4>Layout</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {['frame', 'columns', 'rows', 'template', 'layers', 'list', 'outline', 'grid'].map((l, i) => (
            <div key={l} title={l} style={{ aspectRatio: '4/3', background: i === 0 ? 'var(--accent-wash)' : 'var(--bg)', border: '1px solid var(--line)', borderRadius: 4, color: i === 0 ? 'var(--accent)' : 'var(--ink-3)', display: 'grid', placeItems: 'center' }}>
              <Icon name={l} size={14} />
            </div>
          ))}
        </div>
      </div>
      <div className="pane-section">
        <h4>Theme</h4>
        <div className="swatch-grid">
          {THEMES.map(t => (
            <div
              key={t.key}
              className={`swatch ${theme === t.key ? 'active' : ''}`}
              title={t.key}
              aria-label={`${t.key} theme`}
              role="button"
              style={{ background: t.c, cursor: 'pointer' }}
              onClick={() => onChangeTheme?.(t.key)}
            />
          ))}
        </div>
      </div>
      <div className="pane-section">
        <h4>Tokens</h4>
        <div className="tokens-row"><div className="swatch-s" style={{ background: 'oklch(0.22 0.01 85)' }} /><div className="name">ink</div><div className="val">#15171c</div></div>
        <div className="tokens-row"><div className="swatch-s" style={{ background: 'oklch(0.62 0.17 265)' }} /><div className="name">accent</div><div className="val">oklch(.62/.17/265)</div></div>
        <div className="tokens-row"><div className="swatch-s" style={{ background: 'var(--ink)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600 }}>Aa</div><div className="name">H1 / Inter 600</div><div className="val">96 / -3%</div></div>
      </div>
      <div className="pane-section">
        <h4>Components</h4>
        <div className="lib-rail">
          {COMPONENTS.map(({ label, id }) => (
            <div className="lib-chip" key={id} title={`Add ${label}`} role="button" style={{ cursor: 'pointer' }} onClick={() => onAddComponent?.(id)}>
              <div className="lib-chip-inner"><span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{label[0]}</span></div>
              <div className="lib-chip-name">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
