import { ScaledSlide } from '../ui/Primitives.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';

export default function PresenterSidePanel({ nextSlide, notes, deck, idx, flatLength }) {
  return (
    <div className="presenter-side">
      <div>
        <div className="label">Next up</div>
        <div className="presenter-next">
          {nextSlide ? (
            <ScaledSlide>
              <Slide slide={nextSlide} deck={deck} sectionName={nextSlide.sectionName} num={idx + 2} total={flatLength}/>
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
        <div className="presenter-notes">{notes}</div>
      </div>
    </div>
  );
}
