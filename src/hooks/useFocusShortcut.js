import { useEffect } from 'react';
import { dispatchKey, commandById, formatKeys } from '../lib/commands.js';

// Focus (and select) `ref`'s input when the registry command `commandId` (e.g.
// 'home.search') is triggered, while `enabled`. Returns the command's shortcut
// label for the search box's badge, so the badge is always the real binding.
export function useFocusShortcut(commandId, ref, enabled = true) {
  const cmd = commandById(commandId);
  useEffect(() => {
    if (!enabled) return undefined;
    const focusSearch = () => { ref.current?.focus(); ref.current?.select?.(); };
    const onKey = (e) => dispatchKey(e, { scope: cmd.scope, act: { focusSearch } });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmd, ref, enabled]);
  return formatKeys(cmd);
}
