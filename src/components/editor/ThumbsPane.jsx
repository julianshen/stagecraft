import React from 'react';
import Icon from '../ui/Icon.jsx';
import { IconButton, ScaledSlide } from '../ui/Primitives.jsx';
import { useReorderDrag } from '../../hooks/useReorderDrag.js';

// flattenDeck rebuilds every slide wrapper per render, so wrapper identity
// can't drive the memo — compare the wrapper's own values instead (untouched
// slides keep field identity through applySlidePatch). The deck object also
// changes identity per edit; only the chrome fields the renderer reads matter.
// Handler/deckCtx identity is deliberately ignored: stale closures stay safe
// because anything they read (section order, numbering, deck chrome) is part
// of this comparison — when it changes, the thumb re-renders with fresh ones.
function shallowEqual(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}
function thumbPropsEqual(prev, next) {
  return (
    prev.idx === next.idx &&
    prev.total === next.total &&
    prev.isActive === next.isActive &&
    prev.nComments === next.nComments &&
    shallowEqual(prev.slide, next.slide) &&
    prev.secSlides === next.secSlides && // section order: new array → fresh drop handlers
    prev.deckCtx.deck?.title === next.deckCtx.deck?.title &&
    prev.deckCtx.deck?.author === next.deckCtx.deck?.author &&
    prev.deckCtx.deck?.subtitle === next.deckCtx.deck?.subtitle &&
    prev.deckCtx.deck?.theme === next.deckCtx.deck?.theme
  );
}

// One thumbnail card. Memoized so a per-keystroke deck edit (Data tab,
// Co-pilot) re-renders only the edited slide's thumb instead of all N —
// each thumb is a full <Slide> render behind a ResizeObserver.
const Thumb = React.memo(function Thumb({ slide, idx, total, isActive, nComments, deckCtx, renderSlide, onPick, dragHandlers }) {
  return (
    <div
      data-sid={slide.id}
      className={`thumb ${isActive ? 'active' : ''}`}
      onClick={() => onPick(slide.id)}
      {...dragHandlers}
    >
      <div className="thumb-num">{String(idx + 1).padStart(2, '0')}</div>
      <div className="thumb-slide">
        <ScaledSlide>
          {renderSlide(slide, { ...deckCtx, sectionName: slide.sectionName, num: idx + 1, total })}
        </ScaledSlide>
        {nComments > 0 && <div className="thumb-comments">{nComments}</div>}
      </div>
    </div>
  );
}, thumbPropsEqual);

export default function ThumbsPane({ flat, sections, curId, onPick, renderSlide, deckCtx, comments = [], onNewSlide, onReorder }) {
  // Drag-to-reorder mechanics shared with the Sorter grid.
  const { dragProps } = useReorderDrag(onReorder);
  return (
    <aside className="leftpane">
      <div className="pane-header">
        <span>Slides · {flat.length}</span>
        <div className="actions">
          <IconButton name="plus" title="New slide · ⌘N" onClick={onNewSlide} />
          <IconButton name="outline" title="Outline view" />
          <IconButton name="more-h" title="More" />
        </div>
      </div>
      <div className="thumbs">
        {sections.map((sec, si) => (
          <React.Fragment key={sec.id}>
            <div style={{ padding: '10px 4px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                <Icon name="chevron-down" size={10} style={{ marginRight: 4 }} />
                {String(si + 1).padStart(2, '0')} · {sec.name}
              </span>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-4)' }}>{sec.slides.length}</span>
            </div>
            {sec.slides.map((sid) => {
              const idx = flat.findIndex(f => f.id === sid);
              const s = flat[idx];
              if (!s) return null;
              const nComments = comments.filter(c => c.slide === sid).length;
              return (
                <Thumb
                  key={sid}
                  slide={s}
                  idx={idx}
                  total={flat.length}
                  isActive={sid === curId}
                  nComments={nComments}
                  deckCtx={deckCtx}
                  renderSlide={renderSlide}
                  onPick={onPick}
                  secSlides={sec.slides}
                  dragHandlers={dragProps(sid, sec)}
                />
              );
            })}
          </React.Fragment>
        ))}
        <button style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 6px', color: 'var(--ink-3)', fontSize: 12, width: '100%' }}>
          <Icon name="plus" size={12} /> New section
        </button>
      </div>
    </aside>
  );
}
