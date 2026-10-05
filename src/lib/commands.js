// The command registry — one source for every action's label, icon and key
// binding. The key handlers (editor, app, presenter, search boxes), context
// menus, ⌘K palette, toolbar tooltips and the Settings shortcut list all derive
// from it, so no surface can advertise a shortcut that isn't bound
// (docs/POWERPOINT-SPEC.md F-UI-1).
//
// A command runs against a context its surface builds:
//   { scope, sel: selected-element count, els: elements on the slide, act: { [name]: fn } }
// `scope` says which surface is dispatching (editor / app / presenter / home /
// templates); a command only fires in its own scope. `act` names the action the
// command invokes. A command applies when its action is wired (a function), its
// selection rule `need` holds (default: none) and its optional `when(ctx)` holds.
//
// Combos are written `Mod+Shift+G`, where `Mod` is ⌘ on macOS and Ctrl elsewhere;
// `Ctrl` is the literal Control key on every platform (⌃ on a Mac). Chords the
// browser or OS keeps for itself on macOS (⌘M minimize, ⌘⇧[ ] switch tabs, ⌘N/T/W/Q)
// are avoided — a page never receives them.
//
// Key auto-repeat is ignored unless a command opts in with `repeat: true` (nudge,
// slide navigation, undo/redo): holding ⌘D must not stamp out duplicates.

const NEED = {
  none: () => true,
  any: (ctx) => ctx.sel >= 1,
  one: (ctx) => ctx.sel === 1,
  multi: (ctx) => ctx.sel >= 2,
  elements: (ctx) => ctx.els >= 1,
};

// Arrow key → unit nudge direction (arrange.nudge reads it from the event).
const NUDGE_DIR = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const ARROWS = Object.keys(NUDGE_DIR);

// Undo/redo defer to the browser's native text undo while text is being edited.
const notTextEditing = (ctx) => !ctx.textEditing;

export const COMMANDS = [
  // ---- Edit ----
  { id: 'edit.undo', label: 'Undo', icon: 'undo', group: 'Edit', scope: 'app', act: 'undo', when: notTextEditing, repeat: true, keys: ['Mod+Z'] },
  { id: 'edit.redo', label: 'Redo', icon: 'redo', group: 'Edit', scope: 'app', act: 'redo', when: notTextEditing, repeat: true, keys: ['Mod+Shift+Z', 'Mod+Y'] },
  { id: 'edit.cut', label: 'Cut', icon: 'copy', group: 'Edit', scope: 'editor', act: 'cut', need: 'any', keys: ['Mod+X'] },
  { id: 'edit.copy', label: 'Copy', icon: 'copy', group: 'Edit', scope: 'editor', act: 'copy', need: 'any', keys: ['Mod+C'] },
  { id: 'edit.paste', label: 'Paste', icon: 'frame', group: 'Edit', scope: 'editor', act: 'paste', keys: ['Mod+V'] },
  { id: 'edit.duplicate', label: 'Duplicate', icon: 'copy', group: 'Edit', scope: 'editor', act: 'duplicate', need: 'any', keys: ['Mod+D'] },
  { id: 'edit.delete', label: 'Delete', icon: 'trash', group: 'Edit', scope: 'editor', act: 'deleteSelection', need: 'any', keys: ['Backspace', 'Delete'] },
  { id: 'edit.selectAll', label: 'Select all', icon: 'cursor', group: 'Edit', scope: 'editor', act: 'selectAll', need: 'elements', keys: ['Mod+A'] },
  { id: 'view.palette', label: 'Command palette', icon: 'search', group: 'Edit', scope: 'editor', act: 'palette', palette: false, keys: ['Mod+K'] },
  // ---- Arrange ----
  { id: 'arrange.front', label: 'Bring to front', icon: 'chevron-up', group: 'Arrange', scope: 'editor', act: 'front', need: 'one', keys: ['Mod+Shift+ArrowUp'] },
  { id: 'arrange.back', label: 'Send to back', icon: 'chevron-down', group: 'Arrange', scope: 'editor', act: 'back', need: 'one', keys: ['Mod+Shift+ArrowDown'] },
  { id: 'arrange.group', label: 'Group', icon: 'layers', group: 'Arrange', scope: 'editor', act: 'group', need: 'multi', keys: ['Mod+G'] },
  { id: 'arrange.ungroup', label: 'Ungroup', icon: 'layers', group: 'Arrange', scope: 'editor', act: 'ungroup', need: 'any', keys: ['Mod+Shift+G'] },
  {
    id: 'arrange.nudge', label: 'Nudge selection', group: 'Arrange', scope: 'editor', act: 'nudge', need: 'any', palette: false, repeat: true,
    keys: [...ARROWS, ...ARROWS.map((k) => `Shift+${k}`)],
    keysLabel: { mac: '↑ ↓ ← → (⇧ ×5)', other: '↑ ↓ ← → (Shift ×5)' },
    run: (ctx, e) => ctx.act.nudge(...NUDGE_DIR[e.key], e),
  },
  // ---- Insert & tools ----
  { id: 'tool.select', label: 'Select tool', icon: 'cursor', group: 'Insert & tools', scope: 'editor', act: 'selectTool', keys: ['V'] },
  { id: 'tool.pen', label: 'Pen tool', icon: 'pen', group: 'Insert & tools', scope: 'editor', act: 'penTool', keys: ['P'] },
  { id: 'insert.textBox', label: 'Insert text box', icon: 'text', group: 'Insert & tools', scope: 'editor', act: 'insertTextBox' },
  { id: 'insert.image', label: 'Insert image', icon: 'image', group: 'Insert & tools', scope: 'editor', act: 'insertImage', keys: ['I'] },
  { id: 'copilot.open', label: 'Generate with AI', icon: 'magic', group: 'Insert & tools', scope: 'editor', act: 'copilot' },
  // ---- Slides ----
  { id: 'slide.new', label: 'New slide', icon: 'plus', group: 'Slides', scope: 'editor', act: 'newSlide', keys: ['Ctrl+M'] },
  { id: 'slide.duplicate', label: 'Duplicate slide', icon: 'copy', group: 'Slides', scope: 'editor', act: 'duplicateSlide' },
  { id: 'slide.delete', label: 'Delete slide', icon: 'trash', group: 'Slides', scope: 'editor', act: 'deleteSlide' },
  { id: 'slide.prev', label: 'Previous slide', icon: 'chevron-up', group: 'Slides', scope: 'editor', act: 'prevSlide', repeat: true, keys: ['PageUp'] },
  { id: 'slide.next', label: 'Next slide', icon: 'chevron-down', group: 'Slides', scope: 'editor', act: 'nextSlide', repeat: true, keys: ['PageDown'] },
  // ---- Slide show ----
  // Not while editing text: Mod+Enter sends in text fields (e.g. the Co-pilot prompt).
  { id: 'show.present', label: 'Present', icon: 'play', group: 'Slide show', scope: 'app', act: 'present', when: notTextEditing, keys: ['Mod+Enter'] },
  { id: 'show.next', label: 'Next slide (slide show)', group: 'Slide show', scope: 'presenter', act: 'next', repeat: true, keys: ['ArrowRight', 'Space'] },
  { id: 'show.prev', label: 'Previous slide (slide show)', group: 'Slide show', scope: 'presenter', act: 'prev', repeat: true, keys: ['ArrowLeft'] },
  { id: 'show.blackout', label: 'Black screen', group: 'Slide show', scope: 'presenter', act: 'blackout', keys: ['B'] },
  { id: 'show.exit', label: 'End slide show', group: 'Slide show', scope: 'presenter', act: 'exit', keys: ['Escape'] },
  // ---- Search ----
  { id: 'home.search', label: 'Search decks', group: 'Search', scope: 'home', act: 'focusSearch', keys: ['Mod+K'] },
  { id: 'templates.search', label: 'Search templates', group: 'Search', scope: 'templates', act: 'focusSearch', keys: ['Mod+F'] },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));
export const commandById = (id) => BY_ID.get(id);

export const isMacPlatform = (platform) => /Mac|iPhone|iPad|iPod/.test(platform || '');
const IS_MAC = typeof navigator !== 'undefined'
  && isMacPlatform(navigator.userAgentData?.platform || navigator.platform);

export function parseCombo(combo) {
  const parts = combo.split('+');
  const key = parts.pop() || '+';
  return { mod: parts.includes('Mod'), ctrl: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt'), key };
}

// Keys whose `e.key` changes with Shift on common layouts are matched by `e.code`.
const KEY_CODES = { ']': 'BracketRight', '[': 'BracketLeft' };

export function matchesCombo(e, combo) {
  const c = parseCombo(combo);
  const modOk = c.ctrl ? (e.ctrlKey && !e.metaKey) : c.mod === (e.metaKey || e.ctrlKey);
  if (!modOk || c.shift !== e.shiftKey || c.alt !== e.altKey) return false;
  if (c.key === 'Space') return e.key === ' ';
  if (KEY_CODES[c.key]) return e.code === KEY_CODES[c.key] || e.key === c.key;
  return c.key.length === 1 ? e.key?.toLowerCase() === c.key.toLowerCase() : e.key === c.key;
}

const KEY_NAMES_COMMON = { Delete: 'Del', Escape: 'Esc', PageUp: 'PgUp', PageDown: 'PgDn', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
const KEY_NAMES = { mac: { ...KEY_NAMES_COMMON, Enter: '⏎', Backspace: '⌫' }, other: KEY_NAMES_COMMON };

export function formatCombo(combo, mac = IS_MAC) {
  const c = parseCombo(combo);
  const name = KEY_NAMES[mac ? 'mac' : 'other'][c.key] || (c.key.length === 1 ? c.key.toUpperCase() : c.key);
  if (mac) return `${c.ctrl ? '⌃' : ''}${c.mod ? '⌘' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${name}`;
  return [(c.mod || c.ctrl) && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', name].filter(Boolean).join('+');
}

// A command's shortcut label: its first combo (menus, tooltips), or all of them
// (Settings). A key family (the nudge arrows) carries a summary `keysLabel`.
export function formatKeys(cmd, { mac = IS_MAC, all = false } = {}) {
  if (cmd?.keysLabel) return cmd.keysLabel[mac ? 'mac' : 'other'];
  const keys = cmd?.keys || [];
  return (all ? keys : keys.slice(0, 1)).map((k) => formatCombo(k, mac)).join(' / ');
}

// Is this command runnable in `ctx` now? `scopes` widens the scope check (the
// palette lists app commands too); key dispatch always uses ctx.scope alone.
const available = (cmd, ctx, scopes = [ctx.scope || 'editor']) => scopes.includes(cmd.scope)
  && typeof ctx.act?.[cmd.act] === 'function'
  && NEED[cmd.need || 'none'](ctx) && (!cmd.when || cmd.when(ctx));

export const runCommand = (cmd, ctx, e) => (cmd.run ? cmd.run(ctx, e) : ctx.act[cmd.act](e));

// The command in `ctx.scope` bound to this key event, if one applies now (else null).
export function findKeyCommand(e, ctx) {
  return COMMANDS.find((cmd) => cmd.keys && (cmd.repeat || !e.repeat) && available(cmd, ctx)
    && cmd.keys.some((k) => matchesCombo(e, k))) || null;
}

// Find and run the command for a key event; true when one ran (and the event
// was consumed). The one dispatcher every surface's key handler calls.
export function dispatchKey(e, ctx) {
  const cmd = findKeyCommand(e, ctx);
  if (!cmd) return false;
  e.preventDefault();
  runCommand(cmd, ctx, e);
  return true;
}

// A tooltip naming the command's real, bound shortcut.
export function tooltip(label, id, opts) {
  const keys = formatKeys(commandById(id), opts);
  return keys ? `${label} · ${keys}` : label;
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
    out.push({ icon: cmd.icon, label: cmd.label, kbd: formatKeys(cmd, { mac }) || undefined, onClick: () => runCommand(cmd, ctx) });
  }
  if (out[out.length - 1] === '-') out.pop();
  return out;
}

// Commands the ⌘K palette offers: runnable now (in any of `scopes`), listable,
// matching `query`.
export function paletteCommands(ctx, query = '', { mac = IS_MAC, scopes } = {}) {
  const q = query.trim().toLowerCase();
  return COMMANDS
    .filter((c) => c.palette !== false && available(c, ctx, scopes) && c.label.toLowerCase().includes(q))
    .map((c) => ({ id: c.id, label: c.label, icon: c.icon, kbd: formatKeys(c, { mac }), run: () => runCommand(c, ctx) }));
}

// The Settings → Shortcuts page: every bound shortcut, grouped, in registry order.
export function shortcutGroups({ mac = IS_MAC } = {}) {
  const groups = [];
  for (const c of COMMANDS) {
    if (!c.keys) continue;
    let g = groups.find((x) => x.g === c.group);
    if (!g) groups.push(g = { g: c.group, rows: [] });
    g.rows.push([c.label, formatKeys(c, { mac, all: true })]);
  }
  return groups;
}
