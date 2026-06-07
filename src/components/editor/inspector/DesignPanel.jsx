import React from 'react';
import Icon from '../../ui/Icon.jsx';

export default function DesignPanel() {
  return (
    <>
      <div className="pane-section">
        <h4>Layout</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {['frame', 'columns', 'rows', 'template', 'layers', 'list', 'outline', 'grid'].map((l, i) => (
            <button key={l} title={l} style={{ aspectRatio: '4/3', background: i === 0 ? 'var(--accent-wash)' : 'var(--bg)', border: '1px solid var(--line)', borderRadius: 4, color: i === 0 ? 'var(--accent)' : 'var(--ink-3)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <Icon name={l} size={14} />
            </button>
          ))}
        </div>
      </div>
      <div className="pane-section">
        <h4>Theme</h4>
        <div className="swatch-grid">
          {['oklch(0.22 0.01 85)', 'white', 'oklch(0.95 0.01 85)', 'oklch(0.62 0.17 265)', 'oklch(0.62 0.13 155)', 'oklch(0.7 0.15 75)', 'oklch(0.6 0.2 25)', 'oklch(0.6 0.18 335)'].map((c, i) => (
            <div key={i} className={`swatch ${i === 3 ? 'active' : ''}`} style={{ background: c }} />
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
          {['KPI', 'Chart', 'Bar', 'Quote', 'Roadmap', 'Table', 'Risks', 'Agenda'].map(n => (
            <div className="lib-chip" key={n}>
              <div className="lib-chip-inner"><span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{n[0]}</span></div>
              <div className="lib-chip-name">{n}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
