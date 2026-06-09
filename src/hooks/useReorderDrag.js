import { useRef } from 'react';

// HTML5 drag-to-reorder for section-grouped slide lists (shared by the editor's
// thumbnail rail and the Sorter grid). Tracks the dragged slide id and, on drop,
// asks the host to move it just before the slide it landed on — within or across
// sections — via onReorder(slideId, sectionId, index). The target index is
// computed against the section MINUS the dragged slide so a same-section move
// lands exactly before the drop target (no off-by-one from the removal).
//
// Returns a `dragProps(slideId, section)` factory that yields the DOM handlers
// for one draggable item; spread it onto the element (e.g. `{...dragProps(id, sec)}`).
export function useReorderDrag(onReorder) {
  const dragId = useRef(null);
  const handleDrop = (dropSid, sec) => {
    const src = dragId.current;
    dragId.current = null;
    if (!src || src === dropSid || !onReorder) return;
    const toIndex = sec.slides.filter((id) => id !== src).indexOf(dropSid);
    onReorder(src, sec.id, toIndex < 0 ? sec.slides.length : toIndex);
  };
  return (sid, sec) => ({
    draggable: true,
    onDragStart: (e) => { dragId.current = sid; e.dataTransfer?.setData?.('text/plain', sid); },
    onDragEnd: () => { dragId.current = null; },
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => { e.preventDefault(); handleDrop(sid, sec); },
  });
}
