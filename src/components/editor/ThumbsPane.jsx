import React from 'react';
import Icon from '../ui/Icon.jsx';
import { IconButton, ScaledSlide } from '../ui/Primitives.jsx';
import { useReorderDrag } from '../../hooks/useReorderDrag.js';

export default function ThumbsPane({ flat, sections, curId, onPick, renderSlide, deckCtx, comments = [], onNewSlide, onReorder }) {
  // Drag-to-reorder mechanics shared with the Sorter grid.
  const dragProps = useReorderDrag(onReorder);
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
                <div
                  key={sid}
                  data-sid={sid}
                  className={`thumb ${sid === curId ? 'active' : ''}`}
                  onClick={() => onPick(sid)}
                  {...dragProps(sid, sec)}
                >
                  <div className="thumb-num">{String(idx + 1).padStart(2, '0')}</div>
                  <div className="thumb-slide">
                    <ScaledSlide>
                      {renderSlide(s, { ...deckCtx, sectionName: s.sectionName, num: idx + 1, total: flat.length })}
                    </ScaledSlide>
                    {nComments > 0 && <div className="thumb-comments">{nComments}</div>}
                  </div>
                </div>
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
