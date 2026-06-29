import { useState, useRef } from 'react';

// Shared rename mechanic for ThumbsPane and SorterGrid.
// The settled ref prevents Escape+blur from firing the callback twice:
// Escape sets it, the follow-on blur sees it and returns early.
export function useSectionRename(onRenameSection) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  const settled = useRef(false);

  function startRename(sec) {
    settled.current = false;
    setEditingId(sec.id);
    setDraft(sec.name);
  }

  function commitRename(commit) {
    if (settled.current) return;
    settled.current = true;
    const name = draft.trim();
    setEditingId(null);
    if (commit && name) onRenameSection?.(editingId, name);
  }

  return { editingId, draft, setDraft, startRename, commitRename };
}
