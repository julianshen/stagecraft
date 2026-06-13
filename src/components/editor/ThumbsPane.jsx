import React from 'react';
import Icon from '../ui/Icon.jsx';
import { IconButton, ScaledSlide } from '../ui/Primitives.jsx';
import { DECK_CHROME_FIELDS } from '../slides/SlideRenderer.jsx';
import { useReorderDrag } from '../../hooks/useReorderDrag.js';

// flattenDeck rebuilds every slide wrapper per render, so wrapper identity
// can't drive the memo — compare the wrapper's own values instead (untouched
// slides keep field identity through applySlidePatch). The deck object also
// changes identity per edit; only DECK_CHROME_FIELDS (the renderer's memo
// contract) matter for a thumb's pixels.
//
// Handler/render-prop identity is deliberately skipped. That's safe on two
// conditions: (1) everything their closures READ (section order via secSlides,
// numbering, deck chrome) is part of this comparison — when it changes, the
// thumb re-renders with fresh closures; (2) everything they WRITE goes through
// functional updaters (`onDeckChange(prev => …)`, Editor's callback contract),
// so a stale closure still mutates the latest deck.
//
// Unknown props fail CLOSED: anything not explicitly skipped is compared with
// ===, so a future Thumb prop participates by default (worst case it defeats
// the memo, never staleness).
const SKIP_IDENTITY = new Set(['slide', 'deck', 'dragHandlers', 'onPick', 'renderSlide']);
function shallowEqual(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}
function thumbPropsEqual(prev, next) {
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(prev).length) return false;
  for (const k of keys) {
    if (SKIP_IDENTITY.has(k)) continue;
    if (prev[k] !== next[k]) return false;
  }
  return shallowEqual(prev.slide, next.slide)
    && DECK_CHROME_FIELDS.every((f) => prev.deck?.[f] === next.deck?.[f]);
}

// One thumbnail card. Memoized so a per-keystroke deck edit (Data tab,
// Co-pilot) re-renders only the edited slide's thumb instead of all N —
// each thumb is a full <Slide> render behind a ResizeObserver.
const Thumb = React.memo(function Thumb({ slide, idx, total, isActive, nComments, deck, renderSlide, onPick, dragHandlers }) {
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
          {renderSlide(slide, { deck, sectionName: slide.sectionName, num: idx + 1, total })}
        </ScaledSlide>
        {nComments > 0 && <div className="thumb-comments">{nComments}</div>}
      </div>
    </div>
  );
}, thumbPropsEqual);

export default function ThumbsPane({ flat, sections, curId, onPick, renderSlide, deckCtx, comments = [], onNewSlide, onReorder }) {
  // Drag-to-reorder mechanics shared with the Sorter grid.
  const { dragProps } = useReorderDrag(onReorder);
  // Hoisted out of the thumb loop: per-slide lookups would be O(n²)/O(n·m)
  // per render, and ThumbsPane itself re-renders on every deck edit.
  const idxById = new Map(flat.map((f, i) => [f.id, i]));
  const commentCounts = new Map();
  for (const c of comments) commentCounts.set(c.slide, (commentCounts.get(c.slide) || 0) + 1);
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
              const idx = idxById.get(sid);
              const s = idx === undefined ? null : flat[idx];
              if (!s) return null;
              return (
                <Thumb
                  key={sid}
                  slide={s}
                  idx={idx}
                  total={flat.length}
                  isActive={sid === curId}
                  nComments={commentCounts.get(sid) || 0}
                  deck={deckCtx.deck}
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
