import { useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { Button, IconButton } from '../ui/Primitives.jsx';
import { TEMPLATES } from '../../data/deck.js';

function TemplatePreview({ vibe }) {
  const styles = {
    blank:   { bg: 'white', a: null },
    mono:    { bg: '#111', a:
      <div style={{ position: 'absolute', left: '8%', bottom: '10%', fontSize: 20, fontWeight: 600, color: 'white', letterSpacing: '-0.03em' }}>MONOLITH.</div>
    },
    grid:    { bg: 'oklch(0.96 0.01 85)', a:
      <div style={{ position: 'absolute', inset: '20%', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 2 }}>
        {Array.from({ length: 30 }).map((_, i) => <div key={i} style={{ background: '#ddd', opacity: 0.3 + (i % 5) / 10 }}/>)}
      </div>
    },
    cart:    { bg: 'oklch(0.95 0.03 75)', a:
      <div style={{ position: 'absolute', inset: '15%', border: '2px solid #222', borderRadius: 6 }}>
        <div style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 9, borderBottom: '2px solid #222', color: '#222' }}>▌ CART · 01</div>
      </div>
    },
    atlas:   { bg: 'oklch(0.22 0.02 260)', a:
      <div style={{ position: 'absolute', left: '8%', top: '25%', color: 'white' }}>
        <div style={{ fontSize: 10, opacity: 0.6, fontFamily: 'monospace' }}>ATLAS · Q3</div>
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', marginTop: 6 }}>Quarterly<br/>Review</div>
      </div>
    },
    ledger:  { bg: 'oklch(0.97 0.01 75)', a:
      <>
        <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 8, color: '#888' }}>
          <span>LEDGER · 2026</span><span>PAGE 01</span>
        </div>
        <div style={{ position: 'absolute', left: '8%', right: '8%', top: '35%', fontFamily: 'serif', fontSize: 22, fontStyle: 'italic' }}>On precision,<br/>first.</div>
      </>
    },
    field:   { bg: 'oklch(0.94 0.03 75)', a:
      <>
        <div style={{ position: 'absolute', inset: '10%', border: '1px dashed #aaa' }}/>
        <div style={{ position: 'absolute', left: '15%', top: '40%', fontSize: 20, fontWeight: 600 }}>Field Notes,<br/>Q3.</div>
      </>
    },
    subs:    { bg: 'oklch(0.1 0.01 260)', a:
      <>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 40%, oklch(0.4 0.18 265 / 0.6), transparent 50%)' }}/>
        <div style={{ position: 'absolute', left: '8%', bottom: '15%', color: 'white', fontSize: 22, fontWeight: 600 }}>SUBSTRATE</div>
      </>
    },
    dossier: { bg: 'oklch(0.97 0.02 75)', a:
      <>
        <div style={{ position: 'absolute', left: '10%', top: '15%', border: '1px solid #444', padding: '2px 8px', fontFamily: 'monospace', fontSize: 8 }}>CLASSIFIED · LEVEL 3</div>
        <div style={{ position: 'absolute', left: '10%', top: '45%', fontSize: 24, fontWeight: 700, fontFamily: 'serif' }}>The<br/>Dossier.</div>
      </>
    },
  };
  const s = styles[vibe] || styles.blank;
  return (
    <div style={{ width: '100%', height: '100%', background: s.bg, position: 'relative', overflow: 'hidden' }}>
      {s.a}
    </div>
  );
}

export default function TemplatePicker({ onClose, onPick }) {
  const [cat, setCat] = useState('All');
  const cats = ['All', ...Array.from(new Set(TEMPLATES.map(t => t.cat)))];
  const shown = TEMPLATES.filter(t => cat === 'All' || t.cat === cat);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h3>Templates</h3>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--ink-3)' }}>{shown.length} · of {TEMPLATES.length}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="input-group" style={{ width: 240 }}>
              <span className="ico"><Icon name="search" size={12}/></span>
              <input placeholder="Search templates"/>
              <span className="kbd">⌘F</span>
            </div>
            <IconButton name="x" onClick={onClose}/>
          </div>
        </div>
        <div className="modal-body" style={{ padding: '16px 20px' }}>
          <div className="tmpl-filter">
            {cats.map(c => (
              <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
          <div className="tmpl-grid">
            {shown.map(t => (
              <div key={t.id} className="deck-card" onClick={() => onPick && onPick(t)}>
                <div className="cover">
                  <TemplatePreview vibe={t.vibe}/>
                </div>
                <div className="info">
                  <div className="title">
                    <span>{t.name}</span>
                    <span className="badge" style={{ background: 'var(--bg-2)', color: 'var(--ink-3)' }}>{t.cat.toUpperCase()}</span>
                  </div>
                  <div className="sub">
                    <span>{8 + ((t.id.charCodeAt(1) || 0) % 12)} slides</span>
                    <span style={{ color: 'var(--ink-4)' }}>·</span>
                    <span>Dark + Light</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)' }}>Templates are fully editable. Swap theme tokens any time.</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={onClose}>Create deck</Button>
        </div>
      </div>
    </div>
  );
}
