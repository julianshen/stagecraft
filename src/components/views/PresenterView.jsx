import { useState, useEffect, useMemo } from 'react';
import { ScaledSlide } from '../ui/Primitives.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';
import { SPEAKER_NOTES } from '../../data/deck.js';
import LaserPointer from '../presenter/LaserPointer.jsx';
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

  // Prefer notes authored on the slide (e.g. the Co-pilot's "Generate speaker
  // notes"), then the bundled sample notes, then a default nudge.
  const note = cur?.notes || SPEAKER_NOTES[cur?.id] || "Drive the narrative: what does the audience need to walk away believing? If you don't know, the slide isn't ready.";

  if (!cur) return null;

  return (
    <div className="presenter">
      <div className="presenter-main">
        <div className="label">Now presenting · slide {idx + 1} of {flat.length} · {cur.sectionName}</div>
        <div className="presenter-current">
          <ScaledSlide>
            <Slide slide={cur} deck={deck} sectionName={cur.sectionName} num={idx + 1} total={flat.length}/>
          </ScaledSlide>
          <LaserPointer enabled={laser}/>
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
        onPrev={() => setIdx(i => Math.max(0, i - 1))}
        onNext={() => setIdx(i => Math.min(flat.length - 1, i + 1))}
        onExit={onExit}
      />
    </div>
  );
}
