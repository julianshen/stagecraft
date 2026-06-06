import { useState, useEffect, useMemo } from 'react';
import Icon from '../ui/Icon.jsx';
import { ScaledSlide } from '../ui/Primitives.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';
import { SPEAKER_NOTES } from '../../data/deck.js';

export default function PresenterView({ deck, onExit }) {

  const flat = useMemo(() => {
    const arr = [];
    deck.sections.forEach(sec => sec.slides.forEach(sid => {
      const s = deck.slides.find(x => x.id === sid);
      if (s) arr.push({ ...s, sectionName: sec.name });
    }));
    return arr;
  }, [deck]);

  // Default to the demo deep-link (slide 4) but never past the last slide —
  // an edited deck may have fewer slides, which would otherwise render blank.
  const [idx, setIdx] = useState(() => Math.min(3, Math.max(0, flat.length - 1)));
  const [elapsed, setElapsed] = useState(412); // seconds
  const [laser, setLaser] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onExit();
      if (e.key === 'ArrowRight' || e.key === ' ') setIdx(i => Math.min(flat.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat.length, onExit]);

  const cur = flat[idx];
  const next = flat[idx + 1];

  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  const clock = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  const note = SPEAKER_NOTES[cur?.id] || "Drive the narrative: what does the audience need to walk away believing? If you don't know, the slide isn't ready.";

  if (!cur) return null;

  return (
    <div className="presenter">
      <div className="presenter-main">
        <div className="label">Now presenting · slide {idx + 1} of {flat.length} · {cur.sectionName}</div>
        <div className="presenter-current">
          <ScaledSlide>
            <Slide slide={cur} deck={deck} sectionName={cur.sectionName} num={idx + 1} total={flat.length}/>
          </ScaledSlide>
          {laser && (
            <div style={{
              position: 'absolute', left: '48%', top: '54%',
              width: 20, height: 20, borderRadius: '50%',
              background: 'oklch(0.7 0.25 25)',
              boxShadow: '0 0 30px oklch(0.7 0.25 25 / 0.6)',
            }}/>
          )}
        </div>
      </div>

      <div className="presenter-side">
        <div>
          <div className="label">Next up</div>
          <div className="presenter-next">
            {next ? (
              <ScaledSlide>
                <Slide slide={next} deck={deck} sectionName={next.sectionName} num={idx + 2} total={flat.length}/>
              </ScaledSlide>
            ) : (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#aaa', fontFamily: 'var(--f-mono)', fontSize: 12 }}>
                END OF DECK
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className="label">Speaker notes</div>
          <div className="presenter-notes">{note}</div>
        </div>
      </div>

      <div className="presenter-bar">
        <div>
          <div className="clock">{clock}</div>
          <div className="muted" style={{ marginTop: 2 }}>elapsed · target 40:00</div>
        </div>
        <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }}/>
        <div>
          <div style={{ fontSize: 22, fontFamily: 'var(--f-mono)', color: 'white', fontWeight: 500 }}>
            {String(idx + 1).padStart(2, '0')} <span style={{ color: 'rgba(255,255,255,0.3)' }}>/ {String(flat.length).padStart(2, '0')}</span>
          </div>
          <div className="muted" style={{ marginTop: 2 }}>slide · → next · ← prev</div>
        </div>
        <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }}/>
        <div className="progress-dots" style={{ flex: 1, maxWidth: 400 }}>
          {flat.map((_, i) => (
            <div key={i} className={`dot ${i < idx ? 'done' : i === idx ? 'current' : ''}`}/>
          ))}
        </div>
        <button onClick={() => setIdx(i => Math.max(0, i - 1))}>
          <Icon name="chevron-left" size={13}/> Prev
        </button>
        <button onClick={() => setIdx(i => Math.min(flat.length - 1, i + 1))}>
          Next <Icon name="chevron-right" size={13}/>
        </button>
        <button onClick={() => setLaser(l => !l)} style={{ color: laser ? 'oklch(0.7 0.25 25)' : '' }}>
          <Icon name="dot" size={13}/> Laser
        </button>
        <button><Icon name="eye" size={13}/> Blackout</button>
        <button onClick={onExit}><Icon name="x" size={13}/> End · Esc</button>
      </div>
    </div>
  );
}
