import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { IconButton } from '../../ui/Primitives.jsx';

export default function TimelineDrawer({ onClose }) {
  return (
    <div className="timeline">
      <div className="timeline-head">
        <Icon name="play" size={12} />
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11 }}>0:00.480 / 0:02.400</span>
        <IconButton name="skip-back" /><IconButton name="play" /><IconButton name="skip-forward" />
        <span style={{ flex: 1 }} />
        <button className="select"><Icon name="sparkle" size={12} />Ease: expo.out</button>
        <IconButton name="x" onClick={onClose} />
      </div>
      <div className="timeline-tracks">
        <div className="playhead" style={{ left: '28%' }} />
        {[{ n: 'Title', k: 'bar', a: 5, b: 35 }, { n: 'KPI cards (6)', k: 'stagger', a: 10, b: 55 }, { n: 'Footnote', k: 'kf', a: 40 }, { n: 'Chart bars', k: 'bar', a: 55, b: 80 }].map((t, i) => (
          <div className="track" key={i}>
            <div className="label"><Icon name={i < 2 ? 'text' : 'shape'} size={11} />{t.n}</div>
            <div className="lane">
              {t.k === 'bar' && <div className="kf-bar" style={{ left: `${t.a}%`, width: `${t.b - t.a}%` }} />}
              {t.k === 'stagger' && Array.from({ length: 6 }).map((_, j) => (<div key={j} className="kf-bar" style={{ left: `${t.a + j * 7}%`, width: '6%', height: 5, top: 13 }} />))}
              {t.k === 'kf' && <div className="keyframe" style={{ left: `${t.a}%` }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
