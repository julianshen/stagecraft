import { IconButton, ScaledSlide } from '../ui/Primitives.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';
import Icon from '../ui/Icon.jsx';

export default function SorterGrid({ deck, flat, active, setActive, onOpenSlide }) {
  return (
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
  );
}
