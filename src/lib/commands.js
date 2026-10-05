// The command registry — one source for every editor action's label, icon and
// key binding. The keyboard handler, context menus, ⌘K palette and the Settings
// shortcut list all derive from it, so a surface can never advertise a shortcut
// that isn't bound (docs/POWERPOINT-SPEC.md F-UI-1).
//
// A command runs against a context the editor builds per render:
//   { sel: selected-element count, els: elements on the slide, act: { [name]: fn } }
// `act` names the editor action the command invokes. A command applies when its
// action is wired and its selection rule (`need`) holds, plus an optional `when`.
//
// Combos are written `Mod+Shift+G`, where `Mod` is ⌘ on macOS and Ctrl elsewhere.
// Scopes: `editor` commands are dispatched by the editor's key handler;
// `app`/`presenter` commands are bound by App / PresenterView and listed here so
// the Settings page can show them; `display` rows describe a family of keys.

const NEED = {
  none: () => true,
  any: (ctx) => ctx.sel >= 1,
  one: (ctx) => ctx.sel === 1,
  multi: (ctx) => ctx.sel >= 2,
  elements: (ctx) => ctx.els >= 1,
};

const nudge = (id, label, key, dx, dy) => ({
  id, label, group: 'Arrange', scope: 'editor', act: 'nudge', need: 'any', hidden: true,
  keys: [key, `Shift+${key}`], run: (ctx, e) => ctx.act.nudge(dx, dy, e),
});

export const COMMANDS = [
  // ---- Edit ----
  { id: 'edit.undo', label: 'Undo', icon: 'undo', group: 'Edit', scope: 'app', keys: ['Mod+Z'] },
  { id: 'edit.redo', label: 'Redo', icon: 'redo', group: 'Edit', scope: 'app', keys: ['Mod+Shift+Z', 'Mod+Y'] },
  { id: 'edit.cut', label: 'Cut', icon: 'copy', group: 'Edit', scope: 'editor', act: 'cut', need: 'any', keys: ['Mod+X'] },
  { id: 'edit.copy', label: 'Copy', icon: 'copy', group: 'Edit', scope: 'editor', act: 'copy', need: 'any', keys: ['Mod+C'] },
  { id: 'edit.paste', label: 'Paste', icon: 'frame', group: 'Edit', scope: 'editor', act: 'paste', need: 'none', keys: ['Mod+V'] },
  { id: 'edit.duplicate', label: 'Duplicate', icon: 'copy', group: 'Edit', scope: 'editor', act: 'duplicate', need: 'any', keys: ['Mod+D'] },
  { id: 'edit.delete', label: 'Delete', icon: 'trash', group: 'Edit', scope: 'editor', act: 'deleteSelection', need: 'any', keys: ['Backspace', 'Delete'] },
  { id: 'edit.selectAll', label: 'Select all', icon: 'cursor', group: 'Edit', scope: 'editor', act: 'selectAll', need: 'elements', keys: ['Mod+A'] },
  { id: 'view.palette', label: 'Command palette', icon: 'search', group: 'Edit', scope: 'editor', act: 'palette', need: 'none', keys: ['Mod+K'], hidden: true },
  // ---- Arrange ----
  { id: 'arrange.front', label: 'Bring to front', icon: 'chevron-up', group: 'Arrange', scope: 'editor', act: 'front', need: 'one', keys: ['Mod+Shift+]'] },
  { id: 'arrange.back', label: 'Send to back', icon: 'chevron-down', group: 'Arrange', scope: 'editor', act: 'back', need: 'one', keys: ['Mod+Shift+['] },
  { id: 'arrange.group', label: 'Group', icon: 'layers', group: 'Arrange', scope: 'editor', act: 'group', need: 'multi', keys: ['Mod+G'] },
  { id: 'arrange.ungroup', label: 'Ungroup', icon: 'layers', group: 'Arrange', scope: 'editor', act: 'ungroup', need: 'any', keys: ['Mod+Shift+G'] },
  nudge('arrange.nudgeLeft', 'Nudge left', 'ArrowLeft', -1, 0),
  nudge('arrange.nudgeRight', 'Nudge right', 'ArrowRight', 1, 0),
  nudge('arrange.nudgeUp', 'Nudge up', 'ArrowUp', 0, -1),
  nudge('arrange.nudgeDown', 'Nudge down', 'ArrowDown', 0, 1),
  { id: 'arrange.nudge', label: 'Nudge selection', group: 'Arrange', scope: 'display', display: { mac: '↑ ↓ ← → (⇧ ×5)', other: '↑ ↓ ← → (Shift ×5)' } },
  // ---- Insert & tools ----
  { id: 'tool.select', label: 'Select tool', icon: 'cursor', group: 'Insert & tools', scope: 'editor', act: 'selectTool', need: 'none', keys: ['V'] },
  { id: 'tool.pen', label: 'Pen tool', icon: 'pen', group: 'Insert & tools', scope: 'editor', act: 'penTool', need: 'none', keys: ['P'] },
  { id: 'insert.textBox', label: 'Insert text box', icon: 'text', group: 'Insert & tools', scope: 'editor', act: 'insertTextBox', need: 'none' },
  { id: 'insert.image', label: 'Insert image', icon: 'image', group: 'Insert & tools', scope: 'editor', act: 'insertImage', need: 'none', keys: ['I'] },
  { id: 'copilot.open', label: 'Generate with AI', icon: 'magic', group: 'Insert & tools', scope: 'editor', act: 'copilot', need: 'none' },
  // ---- Slides ----
  { id: 'slide.new', label: 'New slide', icon: 'plus', group: 'Slides', scope: 'editor', act: 'newSlide', need: 'none', keys: ['Mod+M'] },
  { id: 'slide.duplicate', label: 'Duplicate slide', icon: 'copy', group: 'Slides', scope: 'editor', act: 'duplicateSlide', need: 'none' },
  { id: 'slide.delete', label: 'Delete slide', icon: 'trash', group: 'Slides', scope: 'editor', act: 'deleteSlide', need: 'none' },
  { id: 'slide.prev', label: 'Previous slide', icon: 'chevron-up', group: 'Slides', scope: 'editor', act: 'prevSlide', need: 'none', keys: ['PageUp'] },
  { id: 'slide.next', label: 'Next slide', icon: 'chevron-down', group: 'Slides', scope: 'editor', act: 'nextSlide', need: 'none', keys: ['PageDown'] },
  // ---- Slide show (bound by App / PresenterView) ----
  { id: 'show.present', label: 'Present', icon: 'play', group: 'Slide show', scope: 'app', keys: ['Mod+Enter'] },
  { id: 'show.next', label: 'Next slide (slide show)', group: 'Slide show', scope: 'presenter', keys: ['ArrowRight', 'Space'] },
  { id: 'show.prev', label: 'Previous slide (slide show)', group: 'Slide show', scope: 'presenter', keys: ['ArrowLeft'] },
  { id: 'show.blackout', label: 'Black screen', group: 'Slide show', scope: 'presenter', keys: ['B'] },
  { id: 'show.exit', label: 'End slide show', group: 'Slide show', scope: 'presenter', keys: ['Escape'] },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));
export const commandById = (id) => BY_ID.get(id);

export const isMacPlatform = (platform) => /Mac|iPhone|iPad|iPod/.test(platform || '');
const IS_MAC = typeof navigator !== 'undefined'
  && isMacPlatform(navigator.userAgentData?.platform || navigator.platform);

export function parseCombo(combo) {
  const parts = combo.split('+');
  const key = parts.pop() || '+';
  return { mod: parts.includes('Mod'), shift: parts.includes('Shift'), alt: parts.includes('Alt'), key };
}

// Keys whose `e.key` changes with Shift on common layouts are matched by `e.code`.
const KEY_CODES = { ']': 'BracketRight', '[': 'BracketLeft' };

export function matchesCombo(e, combo) {
  const c = parseCombo(combo);
  if (c.mod !== (e.metaKey || e.ctrlKey) || c.shift !== e.shiftKey || c.alt !== e.altKey) return false;
  if (c.key === 'Space') return e.key === ' ';
  if (KEY_CODES[c.key]) return e.code === KEY_CODES[c.key] || e.key === c.key;
  return c.key.length === 1 ? e.key?.toLowerCase() === c.key.toLowerCase() : e.key === c.key;
}

const KEY_NAMES = {
  mac: { Enter: '⏎', Backspace: '⌫', Delete: 'Del', Escape: 'Esc', PageUp: 'PgUp', PageDown: 'PgDn', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' },
  other: { Delete: 'Del', Escape: 'Esc', PageUp: 'PgUp', PageDown: 'PgDn', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' },
};

export function formatCombo(combo, mac = IS_MAC) {
  const c = parseCombo(combo);
  const name = KEY_NAMES[mac ? 'mac' : 'other'][c.key] || (c.key.length === 1 ? c.key.toUpperCase() : c.key);
  if (mac) return `${c.mod ? '⌘' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${name}`;
  return [c.mod && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', name].filter(Boolean).join('+');
}

// A command's shortcut label: its first combo (menus), or all of them (Settings).
export function formatKeys(cmd, { mac = IS_MAC, all = false } = {}) {
  if (cmd?.display) return cmd.display[mac ? 'mac' : 'other'];
  const keys = cmd?.keys || [];
  return (all ? keys : keys.slice(0, 1)).map((k) => formatCombo(k, mac)).join(' / ');
}

// Is this editor command runnable in `ctx` now?
const available = (cmd, ctx) => cmd.scope === 'editor' && !!cmd.act && typeof ctx.act?.[cmd.act] === 'function'
  && NEED[cmd.need || 'none'](ctx) && (!cmd.when || cmd.when(ctx));

const runner = (cmd) => cmd.run || ((ctx) => ctx.act[cmd.act]());

// The editor command bound to this key event, if one applies now (else null).
export function findKeyCommand(e, ctx) {
  for (const cmd of COMMANDS) {
    if (cmd.keys && available(cmd, ctx) && cmd.keys.some((k) => matchesCombo(e, k))) {
      return { ...cmd, run: runner(cmd) };
    }
  }
  return null;
}

// Menu items (for the shared <Menu>) from a list of command ids, '-' separators,
// and raw items/headers passed through. Unavailable commands drop out, and
// separators collapse so none leads, trails or doubles.
export function menuItems(entries, ctx, { mac = IS_MAC } = {}) {
  const out = [];
  for (const entry of entries) {
    if (entry === '-') { if (out.length && out[out.length - 1] !== '-') out.push('-'); continue; }
    if (typeof entry !== 'string') { out.push(entry); continue; }
    const cmd = commandById(entry);
    if (!cmd || !available(cmd, ctx)) continue;
    out.push({ icon: cmd.icon, label: cmd.label, kbd: formatKeys(cmd, { mac }) || undefined, onClick: () => runner(cmd)(ctx) });
  }
  if (out[out.length - 1] === '-') out.pop();
  return out;
}

// Commands the ⌘K palette offers: runnable now, not hidden, matching `query`.
export function paletteCommands(ctx, query = '', { mac = IS_MAC } = {}) {
  const q = query.trim().toLowerCase();
  return COMMANDS
    .filter((c) => !c.hidden && available(c, ctx) && c.label.toLowerCase().includes(q))
    .map((c) => ({ id: c.id, label: c.label, icon: c.icon, group: c.group, kbd: formatKeys(c, { mac }), run: () => runner(c)(ctx) }));
}

// The Settings → Shortcuts page: every bound shortcut, grouped, in registry order.
export function shortcutGroups({ mac = IS_MAC } = {}) {
  const groups = [];
  for (const c of COMMANDS) {
    if ((!c.keys && !c.display) || (c.hidden && !c.display)) continue;
    let g = groups.find((x) => x.g === c.group);
    if (!g) groups.push(g = { g: c.group, rows: [] });
    g.rows.push([c.label, formatKeys(c, { mac, all: true })]);
  }
  return groups;
}
