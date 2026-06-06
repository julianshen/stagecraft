import { useState, useMemo } from 'react';
import Icon from '../ui/Icon.jsx';
import { Button, IconButton, ScaledSlide } from '../ui/Primitives.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';

export default function SorterView({ deck, onBack, onOpenSlide }) {
  const [mode, setMode] = useState('grid'); // grid | outline

  const flat = useMemo(() => {
    const arr = [];
    deck.sections.forEach(sec => sec.slides.forEach(sid => {
      const s = deck.slides.find(x => x.id === sid);
      if (s) arr.push({ ...s, sectionId: sec.id, sectionName: sec.name });
    }));
    return arr;
  }, [deck]);

  const [active, setActive] = useState(null);

  return (
    <>
      <div className="toolbar">
        <div className="group">
          <Button variant="ghost" icon="chevron-left" onClick={onBack}>Editor</Button>
        </div>
        <div className="group">
          <div className="seg" style={{ width: 220 }}>
            <button className={mode === 'grid' ? 'active' : ''} onClick={() => setMode('grid')}>
              <Icon name="grid" size={12}/> Grid
            </button>
            <button className={mode === 'outline' ? 'active' : ''} onClick={() => setMode('outline')}>
              <Icon name="outline" size={12}/> Outline
            </button>
          </div>
        </div>
        <div className="group">
          <Button variant="ghost" icon="filter">All sections</Button>
          <Button variant="ghost" icon="sort">By order</Button>
        </div>
        <div className="spacer"/>
        <div className="group" style={{ border: 0 }}>
          <Button variant="ghost" icon="plus">New section</Button>
          <Button variant="ghost" icon="ai">Rearrange with AI</Button>
        </div>
      </div>

      {mode === 'grid' ? (
        <div className="sorter">
          {deck.sections.map((sec, si) => {
            const slides = sec.slides.map(sid => flat.find(f => f.id === sid)).filter(Boolean);
            return (
              <div key={sec.id} style={{ marginBottom: 36 }}>
                <div className="sorter-head">
                  <h2>
                    <Icon name="chevron-down" size={11} style={{ marginRight: 6 }}/>
                    {String(si + 1).padStart(2, '0')} · {sec.name}
                    <span style={{ marginLeft: 12, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)' }}>{slides.length} slides</span>
                  </h2>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <IconButton name="plus" title="Add slide"/>
                    <IconButton name="more-h"/>
                  </div>
                </div>
                <div className="sorter-grid">
                  {slides.map(s => {
                    const idx = flat.findIndex(f => f.id === s.id);
                    return (
                      <div
                        key={s.id}
                        className={`sorter-card ${active === s.id ? 'active' : ''}`}
                        onClick={() => setActive(s.id)}
                        onDoubleClick={() => onOpenSlide(idx)}
                      >
                        <div className="cover">
                          <ScaledSlide>
                            <Slide slide={s} deck={deck} sectionName={s.sectionName} num={idx + 1} total={flat.length}/>
                          </ScaledSlide>
                        </div>
                        <div className="foot">
                          <span>{String(idx + 1).padStart(2, '0')}</span>
                          <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.layout}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sorter">
          <div style={{ maxWidth: 1100 }}>
            {deck.sections.map((sec, si) => (
              <div key={sec.id} style={{ marginBottom: 30 }}>
                <h2 style={{ fontSize: 11, fontFamily: 'var(--f-mono)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 14px' }}>
                  {String(si + 1).padStart(2, '0')} · {sec.name}
                </h2>
                {sec.slides.map(sid => {
                  const idx = flat.findIndex(f => f.id === sid);
                  const s = flat[idx];
                  if (!s) return null;
                  const bodyPreview = s.body
                    || (s.items ? s.items.map(it => it.t || it).slice(0, 3).join(' · ') : null)
                    || (s.kpis ? s.kpis.map(k => `${k.label}: ${k.val}`).join(' · ') : null)
                    || s.subtitle
                    || '—';
                  return (
                    <div key={sid} className="outline-section" onClick={() => onOpenSlide(idx)}>
                      <div className="num">{String(idx + 1).padStart(2, '0')}</div>
                      <div>
                        <div className="ol-title">{s.title || s.subtitle || '(untitled)'}</div>
                        <div className="ol-body">{bodyPreview}</div>
                      </div>
                      <div className="ol-meta">
                        <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.layout}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
