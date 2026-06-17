// Is the event target a text-entry field where global keyboard shortcuts should
// stand down (so typing — and the browser's native editing shortcuts — win)?
// Shared by the app-wide and editor keydown handlers so the guard can't drift.
export function isTextEntryTarget(el) {
  if (!el) return false;
  return el.tagName === 'INPUT'
    || el.tagName === 'TEXTAREA'
    || el.tagName === 'SELECT'
    || el.isContentEditable === true;
}
