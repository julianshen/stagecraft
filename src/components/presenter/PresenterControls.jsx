import Icon from '../ui/Icon.jsx';

export default function PresenterControls({
  idx,
  total,
  elapsed,
  laser,
  setLaser,
  blackout,
  setBlackout,
  onPrev,
  onNext,
  onExit,
}) {
  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  const clock = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  return (
    <div className="presenter-bar">
      <div>
        <div className="clock">{clock}</div>
        <div className="muted" style={{ marginTop: 2 }}>elapsed · target 40:00</div>
      </div>
      <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }}/>
      <div>
        <div style={{ fontSize: 22, fontFamily: 'var(--f-mono)', color: 'white', fontWeight: 500 }}>
          {String(idx + 1).padStart(2, '0')} <span style={{ color: 'rgba(255,255,255,0.3)' }}>/ {String(total).padStart(2, '0')}</span>
        </div>
        <div className="muted" style={{ marginTop: 2 }}>slide · → next · ← prev</div>
      </div>
      <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }}/>
      <div className="progress-dots" style={{ flex: 1, maxWidth: 400 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={`dot ${i < idx ? 'done' : i === idx ? 'current' : ''}`}/>
        ))}
      </div>
      <button onClick={onPrev}>
        <Icon name="chevron-left" size={13}/> Prev
      </button>
      <button onClick={onNext}>
        Next <Icon name="chevron-right" size={13}/>
      </button>
      <button className={laser ? 'active' : ''} onClick={() => setLaser(l => !l)}>
        <Icon name="dot" size={13}/> Laser
      </button>
      <button className={blackout ? 'active' : ''} onClick={() => setBlackout(b => !b)} title="Blackout · B">
        <Icon name="eye" size={13}/> Blackout
      </button>
      <button onClick={onExit}><Icon name="x" size={13}/> End · Esc</button>
    </div>
  );
}
