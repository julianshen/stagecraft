import { useRef, useEffect } from 'react';

// The editable branch: an uncontrolled `contentEditable`. React never owns its
// children (that would reset the caret on every parent re-render), so the DOM
// holds the live text and we read it back on commit. The effect seeds the
// initial text and re-syncs only when `value` changes from outside (e.g. a
// Co-pilot edit) — never mid-typing, since the prop is unchanged until commit.
// Commit fires on blur or Enter, skipping a no-op edit. (Single-line by design;
// Shift+Enter is left to the browser.)
function EditableField({ value, onCommit, as: Tag, className, style }) {
  const ref = useRef(null);
  const text = value ?? '';
  useEffect(() => {
    if (ref.current && ref.current.textContent !== text) ref.current.textContent = text;
  }, [text]);
  return (
    <Tag
      ref={ref}
      className={className}
      style={style}
      role="textbox"
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => { const next = e.currentTarget.textContent; if (next !== text) onCommit?.(next); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
      }}
    />
  );
}

// One slide text field: read-only by default, editable in place on the canvas.
// Read-only renders the plain tag with NO hooks — important because the shared
// renderer mounts one of these per text field per slide in the thumbnail rail
// and sorter, where only the editable branch (canvas) needs the ref/effect.
export default function EditableText({ editable = false, value, onCommit, as: Tag = 'span', className, style }) {
  if (!editable) return <Tag className={className} style={style}>{value}</Tag>;
  return <EditableField value={value} onCommit={onCommit} as={Tag} className={className} style={style} />;
}
