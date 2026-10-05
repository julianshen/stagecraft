import { useEffect } from 'react';
import { dispatchKey, commandById } from '../lib/commands.js';

// Focus (and select) `ref`'s input when the registry command `commandId` (e.g.
// 'home.search') is triggered, while `enabled`. Backs the search boxes'
// shortcut badges, so each badge is a real binding rather than decoration.
export function useFocusShortcut(commandId, ref, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const { scope } = commandById(commandId);
    const focusSearch = () => { ref.current?.focus(); ref.current?.select?.(); };
    const onKey = (e) => dispatchKey(e, { scope, act: { focusSearch } });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commandId, ref, enabled]);
}
