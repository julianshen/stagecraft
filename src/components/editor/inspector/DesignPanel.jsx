import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { THEME_OPTIONS, accentColor, accentLabel } from '../menus/ThemeMenu.jsx';

// Insertable components → createComponentSlide ids (via onAddComponent).
const COMPONENTS = [
  { label: 'KPI', id: 'kpi' }, { label: 'Chart', id: 'chart' }, { label: 'Table', id: 'table' }, { label: 'Agenda', id: 'agenda' },
  { label: 'List', id: 'list' }, { label: 'Risks', id: 'risks' }, { label: 'Roadmap', id: 'roadmap' }, { label: 'Quote', id: 'quote' },
];

export default function DesignPanel({ deck, onChangeTheme, onAddComponent }) {
  const theme = deck?.theme;
  // The accent token mirrors the live deck theme (same source as the swatch
  // grid above), so the Tokens readout can't drift from the chosen accent.
  const active = THEME_OPTIONS.find(o => o.id === theme) || THEME_OPTIONS[0];
  const accentCss = accentColor(active);
  const accentVal = accentLabel(active);
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
          {THEME_OPTIONS.map(o => (
            <button
              key={o.id}
              type="button"
              className={`swatch ${theme === o.id ? 'active' : ''}`}
              title={o.label}
              aria-label={`${o.id} theme`}
              style={{ background: accentColor(o), padding: 0, appearance: 'none', WebkitAppearance: 'none' }}
              onClick={() => onChangeTheme?.(o.id)}
            />
          ))}
        </div>
      </div>
      <div className="pane-section">
        <h4>Tokens</h4>
        <div className="tokens-row"><div className="swatch-s" style={{ background: 'oklch(0.22 0.01 85)' }} /><div className="name">ink</div><div className="val">#15171c</div></div>
        <div className="tokens-row"><div className="swatch-s" style={{ background: accentCss }} /><div className="name">accent</div><div className="val">{accentVal}</div></div>
        <div className="tokens-row"><div className="swatch-s" style={{ background: 'var(--ink)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600 }}>Aa</div><div className="name">H1 / Inter 600</div><div className="val">96 / -3%</div></div>
      </div>
      <div className="pane-section">
        <h4>Components</h4>
        <div className="lib-rail">
          {COMPONENTS.map(({ label, id }) => (
            <button className="lib-chip" key={id} type="button" title={`Add ${label}`} style={{ padding: 0, appearance: 'none', WebkitAppearance: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => onAddComponent?.(id)}>
              <div className="lib-chip-inner"><span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{label[0]}</span></div>
              <div className="lib-chip-name">{label}</div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
