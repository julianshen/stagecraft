import React from 'react';
import { THEME_OPTIONS, accentColor, accentLabel } from '../menus/ThemeMenu.jsx';
import { LayoutGrid } from '../menus/LayoutGrid.jsx';
import { HEADING_SCALES, resolveHeadingScale, effectiveTitlePx } from '../../../lib/headingScale.js';

// Insertable components → createComponentSlide ids (via onAddComponent).
const COMPONENTS = [
  { label: 'KPI', id: 'kpi' }, { label: 'Chart', id: 'chart' }, { label: 'Table', id: 'table' }, { label: 'Agenda', id: 'agenda' },
  { label: 'List', id: 'list' }, { label: 'Risks', id: 'risks' }, { label: 'Roadmap', id: 'roadmap' }, { label: 'Quote', id: 'quote' },
];
// The canvas slide text colour (mirrors `.slide { color }` in main.css). The ink
// token isn't user-editable yet (canvas light-bg/dark-text vs export dark-bg/white
// is a separate reconciliation), so the row is an honest readout of what renders.
const SLIDE_INK = '#0a0a0b';

export default function DesignPanel({ deck, current, slide, onChangeLayout, onChangeTheme, onAddComponent, onChangeHeadingScale }) {
  const theme = deck?.theme;
  // The accent token mirrors the live deck theme (same source as the swatch
  // grid above), so the Tokens readout can't drift from the chosen accent.
  const active = THEME_OPTIONS.find(o => o.id === theme) || THEME_OPTIONS[0];
  const accentCss = accentColor(active);
  const accentVal = accentLabel(active);
  // The live deck heading scale + the px the current slide's title actually renders
  // at under it (single-sourced with the canvas via headingPx) — so the H1 readout
  // can't drift from the slide, the way the accent token tracks the theme.
  const scale = resolveHeadingScale(deck);
  return (
    <>
      {/* Per-slide layout picker — a second entry point to the toolbar Layout menu,
          rendered from the shared LayoutGrid so the two pickers can't drift. The
          active card mirrors the current slide's layout; a pick swaps it. */}
      <div className="pane-section">
        <h4>Layout</h4>
        <LayoutGrid current={current} onPick={onChangeLayout} />
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
        <div className="tokens-row"><div className="swatch-s" style={{ background: SLIDE_INK }} /><div className="name">ink</div><div className="val">{SLIDE_INK}</div></div>
        <div className="tokens-row"><div className="swatch-s" style={{ background: accentCss }} /><div className="name">accent</div><div className="val">{accentVal}</div></div>
        {/* H1 token: a real editable heading scale (deck-wide) + a live readout of the
            current slide's resulting title px — the size the canvas/export render. */}
        <div className="tokens-row">
          <div className="swatch-s" style={{ background: 'var(--ink)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600 }}>Aa</div>
          <div className="name">H1 · {effectiveTitlePx(slide, deck)}px</div>
          <div className="input-group" style={{ marginLeft: 'auto', minWidth: 96 }}>
            <select aria-label="Heading scale" value={String(scale)} onChange={(e) => onChangeHeadingScale?.(Number(e.target.value))}>
              {HEADING_SCALES.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.value}×)</option>)}
              {/* A gate-bypassing write can set an in-range non-preset scale; surface it
                  so the control reflects what the slide actually renders (resolveHeadingScale
                  clamps a range, not a preset set) rather than snapping to a preset. */}
              {!HEADING_SCALES.some((s) => s.value === scale) && <option value={String(scale)}>Custom ({scale}×)</option>}
            </select>
          </div>
        </div>
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
