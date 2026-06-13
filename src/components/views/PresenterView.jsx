import { useState, useEffect, useMemo } from 'react';
import { ScaledSlide } from '../ui/Primitives.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';
import { SPEAKER_NOTES } from '../../data/deck.js';
import LaserLayer from '../presenter/LaserLayer.jsx';
import PresenterSidePanel from '../presenter/PresenterSidePanel.jsx';
import PresenterControls from '../presenter/PresenterControls.jsx';

const EMPTY_DECK = { sections: [], slides: [] };

export default function PresenterView({ deck, onExit }) {
  // Normalize once so a null or partially-populated deck can't crash the view.
  const safeDeck = deck || EMPTY_DECK;

  const flat = useMemo(() => {
    const arr = [];
    (safeDeck.sections || []).forEach(sec => (sec?.slides || []).forEach(sid => {
      const s = (safeDeck.slides || []).find(x => x.id === sid);
      if (s) arr.push({ ...s, sectionName: sec.name });
    }));
    return arr;
  }, [safeDeck]);

  // Start on the first slide — for a freshly created deck that's the cover.
  // (Previously a demo deep-link to slide 4, tuned to the sample deck.)
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(412); // seconds
  const [laser, setLaser] = useState(false);
  const [blackout, setBlackout] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onExit();
      if (e.key === 'ArrowRight' || e.key === ' ') setIdx(i => Math.min(flat.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1));
      // Bare B blacks out the audience screen — but not modifier chords like
      // Ctrl+Shift+B (browser bookmarks bar) or Cmd+B, which aren't ours.
      if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey && !e.altKey) setBlackout(b => !b);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat.length, onExit]);

  const cur = flat[idx];
  const next = flat[idx + 1];

  if (!cur) return null;

  // Prefer notes authored on the slide (e.g. the Co-pilot's "Generate speaker
  // notes") — honoring an intentionally-cleared empty string — then the bundled
  // sample notes, then a default nudge.
  const note = typeof cur.notes === 'string'
    ? cur.notes
    : (SPEAKER_NOTES[cur.id] || "Drive the narrative: what does the audience need to walk away believing? If you don't know, the slide isn't ready.");

  return (
    <div className="presenter">
      <div className="presenter-main">
        <div className="label">Now presenting · slide {idx + 1} of {flat.length} · {cur.sectionName}</div>
        <div className="presenter-current">
          <ScaledSlide>
            <Slide slide={cur} deck={deck} sectionName={cur.sectionName} num={idx + 1} total={flat.length}/>
          </ScaledSlide>
          <LaserLayer enabled={laser}/>
          {blackout && <div className="presenter-blackout" aria-label="Screen blacked out — press B to resume"/>}
        </div>
      </div>

      <PresenterSidePanel
        nextSlide={next}
        notes={note}
        deck={deck}
        idx={idx}
        flatLength={flat.length}
      />

      <PresenterControls
        idx={idx}
        total={flat.length}
        elapsed={elapsed}
        laser={laser}
        setLaser={setLaser}
        blackout={blackout}
        setBlackout={setBlackout}
        onPrev={() => setIdx(i => Math.max(0, i - 1))}
        onNext={() => setIdx(i => Math.min(flat.length - 1, i + 1))}
        onExit={onExit}
      />
    </div>
  );
}
