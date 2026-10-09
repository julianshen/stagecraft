import Icon from '../ui/Icon.jsx';
import { formatKeys, commandById, tooltip } from '../../lib/commands.js';

const BLACKOUT_TIP = tooltip('Blackout', 'show.blackout');
const EXIT_KEYS = formatKeys(commandById('show.exit'));

const pad2 = (n) => String(n).padStart(2, '0');
const formatClock = (secs) => `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`;

export default function PresenterControls({
  idx,
  total,
  elapsed,
  target = 0,
  onResetClock,
  laser,
  setLaser,
  blackout,
  setBlackout,
  onPrev,
  onNext,
  onExit,
}) {
  const clock = formatClock(elapsed);
  const over = target > 0 && elapsed > target * 60;

  return (
    <div className="presenter-bar">
      <div>
        <div className={`clock${over ? ' over' : ''}`}>{clock}</div>
        <div className="muted" style={{ marginTop: 2 }}>
          elapsed{target > 0 && ` · target ${formatClock(target * 60)}`}
        </div>
      </div>
      <button onClick={onResetClock} title="Reset the clock" aria-label="Reset clock">
        <Icon name="refresh" size={13}/>
      </button>
      <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }}/>
      <div>
        <div style={{ fontSize: 22, fontFamily: 'var(--f-mono)', color: 'white', fontWeight: 500 }}>
          {pad2(idx + 1)} <span style={{ color: 'rgba(255,255,255,0.3)' }}>/ {pad2(total)}</span>
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
      <button className={blackout ? 'active' : ''} onClick={() => setBlackout(b => !b)} title={BLACKOUT_TIP}>
        <Icon name="eye" size={13}/> Blackout
      </button>
      <button onClick={onExit}><Icon name="x" size={13}/> End · {EXIT_KEYS}</button>
    </div>
  );
}
