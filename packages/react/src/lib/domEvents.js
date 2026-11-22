// Is the event target a form control that consumes keystrokes, so canvas
// hotkeys (Delete / nudge / ⌘D…) should stand down? Broad on purpose: a <select>
// or range/number <input> needs its arrow keys, a checkbox needs Space, etc.
export function isTextEntryTarget(el) {
  if (!el) return false;
  return el.tagName === 'INPUT'
    || el.tagName === 'TEXTAREA'
    || el.tagName === 'SELECT'
    || el.isContentEditable === true;
}

// <input> types with no text to edit — these have no native text undo, so a
// global ⌘Z should still reach the app rather than being swallowed.
const NON_TEXT_INPUT = /^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i;

// Narrower than isTextEntryTarget: does the target have its OWN native text
// undo/redo we should defer to (so global ⌘Z / ⌘⇧Z stands down)? True for
// textareas, contentEditable, and text-like inputs — but NOT dropdowns,
// checkboxes, or sliders, where ⌘Z has no native meaning and deck undo should win.
export function isTextEditingTarget(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable === true) return true;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUT.test(el.type || 'text');
  return false;
}
