import { useState, useEffect, useMemo } from 'react';
import { ScaledSlide } from '../ui/Primitives.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';
import { resolveNotes } from '../../data/deck.js';
import { transitionAnim } from '../../lib/transitions.js';
import { dispatchKey } from '../../lib/commands.js';
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
    // Presenter-scope commands (lib/commands.js show.*). Combos match exactly,
    // so a bare B blacks out but chords like Ctrl+Shift+B (bookmarks bar) or
    // ⌘B pass through; show.blackout ignores key auto-repeat (noRepeat), which
    // would flicker the toggle while held.
    function onKey(e) {
      dispatchKey(e, {
        scope: 'presenter',
        act: {
          exit: onExit,
          next: () => setIdx(i => Math.min(flat.length - 1, i + 1)),
          prev: () => setIdx(i => Math.max(0, i - 1)),
          blackout: () => setBlackout(b => !b),
        },
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat.length, onExit]);

  const cur = flat[idx];
  const next = flat[idx + 1];

  if (!cur) return null;

  // Authored slide notes → bundled sample notes → a default nudge (the shared
  // resolver honours an intentionally-cleared empty string as "no notes").
  const note = resolveNotes(cur, "Drive the narrative: what does the audience need to walk away believing? If you don't know, the slide isn't ready.");
  // The entering slide plays its own transition (Animate panel → slide.transition).
  // Key the stage on idx ONLY when it animates, so the CSS animation replays on
  // advance to an animated slide while no-transition slides reconcile in place
  // (no needless remount of the slide's charts/SVG/elements).
  const anim = transitionAnim(cur.transition);

  return (
    <div className="presenter">
      <div className="presenter-main">
        <div className="label">Now presenting · slide {idx + 1} of {flat.length} · {cur.sectionName}</div>
        <div className="presenter-current">
          <ScaledSlide key={anim ? idx : 'none'} style={anim ? { animation: anim } : undefined}>
            <Slide slide={cur} deck={deck} sectionName={cur.sectionName} num={idx + 1} total={flat.length}/>
          </ScaledSlide>
          {laser && !blackout && <LaserLayer/>}
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
