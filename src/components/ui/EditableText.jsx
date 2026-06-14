import { useRef, useEffect } from 'react';

// The editable branch: an uncontrolled `contentEditable`. React never owns its
// children (that would reset the caret on every parent re-render), so the DOM
// holds the live text and we read it back on commit. The effect seeds the
// initial text and re-syncs only when `value` changes from outside (e.g. a
// Co-pilot edit) — never mid-typing, since the prop is unchanged until commit.
// Commit fires on blur or Enter, skipping a no-op edit. (Single-line by design;
// Shift+Enter is left to the browser.)
function EditableField({ value, onCommit, as: Tag, className, style, fmtKey }) {
  const ref = useRef(null);
  const text = value ?? '';
  useEffect(() => {
    if (ref.current && ref.current.textContent !== text) ref.current.textContent = text;
  }, [text]);
  // Commit on blur. `onCommit` may return false to signal the edit was rejected
  // (e.g. the patch failed validation) — since a rejected edit triggers no state
  // change, the effect won't re-sync, so revert the DOM to `value` here rather
  // than leave the unsaved text stranded in the field.
  const commit = (e) => {
    const next = e.currentTarget.textContent;
    if (next === text) return;
    if (onCommit?.(next) === false) e.currentTarget.textContent = text;
  };
  return (
    <Tag
      ref={ref}
      className={className}
      style={style}
      role="textbox"
      data-fmt-key={fmtKey}
      contentEditable
      suppressContentEditableWarning
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') {
          // Cancel: restore the original text and blur — the blur then commits a
          // no-op (next === text) so the edit is discarded.
          e.preventDefault();
          e.currentTarget.textContent = text;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// One slide text field: read-only by default, editable in place on the canvas.
// Read-only renders the plain tag with NO hooks — important because the shared
// renderer mounts one of these per text field per slide in the thumbnail rail
// and sorter, where only the editable branch (canvas) needs the ref/effect.
export default function EditableText({ editable = false, value, onCommit, as: Tag = 'span', className, style, fmtKey }) {
  if (!editable) return <Tag className={className} style={style}>{value}</Tag>;
  return <EditableField value={value} onCommit={onCommit} as={Tag} className={className} style={style} fmtKey={fmtKey} />;
}
