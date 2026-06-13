import { useRef, useEffect } from 'react';

// One slide text field, rendered read-only by default and editable in place on
// the canvas. When `editable`, it's an uncontrolled `contentEditable` element:
// React never owns its children (which would reset the caret on every parent
// re-render), so the DOM holds the live text and we read it back on commit.
// The effect seeds the initial text and re-syncs only when `value` actually
// changes from outside (e.g. a Co-pilot edit) — never mid-typing, since the
// prop is unchanged until commit. Commit fires on blur or Enter, skipping a
// no-op edit. (Single-line by design; Shift+Enter is left to the browser.)
//
// Read-only renders identical DOM to a plain element, so the shared renderer
// (thumbnails, sorter, presenter) is unchanged when `editable` is falsy.
export default function EditableText({ editable = false, value, onCommit, as: Tag = 'span', className, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (editable && ref.current && ref.current.textContent !== (value ?? '')) {
      ref.current.textContent = value ?? '';
    }
  }, [editable, value]);

  if (!editable) return <Tag className={className} style={style}>{value}</Tag>;

  const commit = (el) => {
    const next = el.textContent;
    if (next !== (value ?? '')) onCommit?.(next);
  };
  return (
    <Tag
      ref={ref}
      className={className}
      style={style}
      role="textbox"
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
      }}
    />
  );
}
