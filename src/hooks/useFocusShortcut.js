import { useEffect } from 'react';
import { matchesCombo } from '../lib/commands.js';

// Focus (and select) `ref`'s input when `combo` (e.g. 'Mod+K') is pressed, while
// `enabled`. Backs the search boxes' shortcut badges, so each badge is a real
// binding rather than decoration.
export function useFocusShortcut(combo, ref, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    function onKey(e) {
      if (!matchesCombo(e, combo) || !ref.current) return;
      e.preventDefault();
      ref.current.focus();
      ref.current.select?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, ref, enabled]);
}
