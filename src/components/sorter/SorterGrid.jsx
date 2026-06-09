import { useState } from 'react';
import { IconButton, ScaledSlide } from '../ui/Primitives.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';
import Icon from '../ui/Icon.jsx';
import { useReorderDrag } from '../../hooks/useReorderDrag.js';

export default function SorterGrid({ deck, flat, active, setActive, onOpenSlide, editable, onReorder, onRenameSection, onDeleteSection }) {
  // Drag-to-reorder mechanics shared with the editor's thumbnail rail.
  // `sectionDropProps` lets a slide be dropped into an empty section's area
  // (a card drop wins via stopPropagation; the container append is the fallback).
  const { dragProps, sectionDropProps } = useReorderDrag(onReorder);

  // Inline section rename: which section is in edit mode + the draft text.
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  const startRename = (sec) => { setEditingId(sec.id); setDraft(sec.name); };
  const commitRename = () => {
    if (editingId) onRenameSection?.(editingId, draft);
    setEditingId(null);
  };

  return (
    <div className="sorter">
      {deck.sections.map((sec, si) => {
        const slides = sec.slides.map(sid => flat.find(f => f.id === sid)).filter(Boolean);
        return (
          <div key={sec.id} data-section-drop={sec.id} style={{ marginBottom: 36 }} {...(editable ? sectionDropProps(sec) : {})}>
            <div className="sorter-head">
              <h2>
                <Icon name="chevron-down" size={11} style={{ marginRight: 6 }}/>
                {String(si + 1).padStart(2, '0')} ·{' '}
                {editingId === sec.id ? (
                  <input
                    className="sorter-rename"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      else if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : sec.name}
                <span style={{ marginLeft: 12, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)' }}>{slides.length} slides</span>
              </h2>
              {editable && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <IconButton name="pen" title="Rename section" onClick={() => startRename(sec)}/>
                  {/* Deleting the last section is a no-op (a deck keeps ≥1 section), so
                      disable rather than offer a dead click. */}
                  <IconButton name="trash" title="Delete section" disabled={deck.sections.length <= 1} onClick={() => onDeleteSection?.(sec.id)}/>
                </div>
              )}
            </div>
            <div className="sorter-grid">
              {slides.map(s => {
                const idx = flat.findIndex(f => f.id === s.id);
                return (
                  <div
                    key={s.id}
                    data-sid={s.id}
                    className={`sorter-card ${active === s.id ? 'active' : ''}`}
                    onClick={() => setActive(s.id)}
                    onDoubleClick={() => onOpenSlide(idx)}
                    {...(editable ? dragProps(s.id, sec) : {})}
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
