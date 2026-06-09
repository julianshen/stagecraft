import { useRef } from 'react';

// HTML5 drag-to-reorder for section-grouped slide lists (shared by the editor's
// thumbnail rail and the Sorter grid). Tracks the dragged slide id and asks the
// host to move it via onReorder(slideId, sectionId, index). The target index is
// always computed against the section MINUS the dragged slide, so a same-section
// move lands exactly where intended (no off-by-one from the removal).
//
// Returns two handler factories:
//   dragProps(slideId, section)  — spread on each draggable card; a drop lands
//                                   just before the card it hit.
//   sectionDropProps(section)    — spread on the section CONTAINER; a drop that
//                                   isn't on a card appends to that section, so a
//                                   slide can be dropped into an empty/fresh one.
// Card drops stopPropagation so a precise insert wins over the container append.
export function useReorderDrag(onReorder) {
  const dragId = useRef(null);
  // Move the dragged slide into `sec`: before `beforeSid`, or appended when it's
  // null. Index is taken after removing the dragged id (matching moveSlide).
  const move = (sec, beforeSid) => {
    const src = dragId.current;
    dragId.current = null;
    if (!src || !onReorder) return;
    const rest = (sec.slides || []).filter((id) => id !== src);
    const at = beforeSid == null ? rest.length : rest.indexOf(beforeSid);
    onReorder(src, sec.id, at < 0 ? rest.length : at);
  };
  const dragProps = (sid, sec) => ({
    draggable: true,
    onDragStart: (e) => { dragId.current = sid; e.dataTransfer?.setData?.('text/plain', sid); },
    onDragEnd: () => { dragId.current = null; },
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragId.current === sid) { dragId.current = null; return; } // drop onto self
      move(sec, sid);
    },
  });
  const sectionDropProps = (sec) => ({
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => { e.preventDefault(); move(sec, null); },
  });
  return { dragProps, sectionDropProps };
}
