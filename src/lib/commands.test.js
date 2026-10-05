import { describe, it, expect, vi } from 'vitest';
import {
  COMMANDS, commandById, parseCombo, matchesCombo, formatCombo, formatKeys,
  findKeyCommand, menuItems, paletteCommands, shortcutGroups, isMacPlatform,
} from './commands.js';

const key = (k, mods = {}) => ({ key: k, code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

// A context with every editor action wired, `sel` elements selected and
// `els` elements on the slide.
const ctxWith = ({ sel = 0, els = 3 } = {}) => {
  const act = new Proxy({}, { get: (t, p) => (t[p] ??= vi.fn()) });
  return { sel, els, act };
};

describe('parseCombo / matchesCombo', () => {
  it('parses modifiers and the key', () => {
    expect(parseCombo('Mod+Shift+G')).toEqual({ mod: true, shift: true, alt: false, key: 'G' });
    expect(parseCombo('PageDown')).toEqual({ mod: false, shift: false, alt: false, key: 'PageDown' });
  });

  it('Mod matches ⌘ or Ctrl (so Windows/Linux get every shortcut)', () => {
    expect(matchesCombo(key('d', { metaKey: true }), 'Mod+D')).toBe(true);
    expect(matchesCombo(key('d', { ctrlKey: true }), 'Mod+D')).toBe(true);
    expect(matchesCombo(key('D', { ctrlKey: true }), 'Mod+D')).toBe(true);
  });

  it('modifiers must match exactly', () => {
    expect(matchesCombo(key('d', { ctrlKey: true, shiftKey: true }), 'Mod+D')).toBe(false);
    expect(matchesCombo(key('d'), 'Mod+D')).toBe(false);
    expect(matchesCombo(key('v', { metaKey: true }), 'V')).toBe(false);
    expect(matchesCombo(key('g', { metaKey: true, altKey: true }), 'Mod+G')).toBe(false);
  });

  it('matches brackets by code too (Shift turns ] into } on US layouts)', () => {
    expect(matchesCombo({ ...key('}', { metaKey: true, shiftKey: true }), code: 'BracketRight' }, 'Mod+Shift+]')).toBe(true);
    expect(matchesCombo({ ...key('{', { ctrlKey: true, shiftKey: true }), code: 'BracketLeft' }, 'Mod+Shift+[')).toBe(true);
  });

  it('matches named keys and Space', () => {
    expect(matchesCombo(key('Enter', { ctrlKey: true }), 'Mod+Enter')).toBe(true);
    expect(matchesCombo(key(' '), 'Space')).toBe(true);
    expect(matchesCombo(key('ArrowLeft', { shiftKey: true }), 'Shift+ArrowLeft')).toBe(true);
    expect(matchesCombo(key('ArrowLeft'), 'Shift+ArrowLeft')).toBe(false);
  });
});

describe('formatCombo / formatKeys', () => {
  it('uses Mac glyphs on macOS', () => {
    expect(formatCombo('Mod+Shift+G', true)).toBe('⌘⇧G');
    expect(formatCombo('Mod+Enter', true)).toBe('⌘⏎');
    expect(formatCombo('Backspace', true)).toBe('⌫');
    expect(formatCombo('Alt+X', true)).toBe('⌥X');
  });

  it('spells out Ctrl/Shift elsewhere', () => {
    expect(formatCombo('Mod+Shift+G', false)).toBe('Ctrl+Shift+G');
    expect(formatCombo('Mod+Enter', false)).toBe('Ctrl+Enter');
    expect(formatCombo('PageDown', false)).toBe('PgDn');
    expect(formatCombo('Alt+X', false)).toBe('Alt+X');
  });

  it('formats a command’s keys (first only, or all)', () => {
    const del = commandById('edit.delete');
    expect(formatKeys(del, { mac: true })).toBe('⌫');
    expect(formatKeys(del, { mac: false, all: true })).toBe('Backspace / Del');
    expect(formatKeys(commandById('slide.duplicate'), { mac: true })).toBe('');
    expect(formatKeys(undefined, { mac: true })).toBe('');
  });

  it('detects macOS from the platform string', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('iPad')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});

describe('registry integrity', () => {
  it('ids are unique and every command has a label', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COMMANDS) expect(c.label).toBeTruthy();
  });

  it('no two editor commands share a key combo', () => {
    const seen = new Map();
    for (const c of COMMANDS.filter((x) => x.scope === 'editor')) {
      for (const k of c.keys || []) {
        expect(seen.get(k), `${k} bound by ${seen.get(k)} and ${c.id}`).toBeUndefined();
        seen.set(k, c.id);
      }
    }
  });

  it('commandById returns undefined for an unknown id', () => {
    expect(commandById('nope')).toBeUndefined();
  });
});

describe('findKeyCommand', () => {
  it('finds the editor command for a key and respects its selection rule', () => {
    expect(findKeyCommand(key('d', { metaKey: true }), ctxWith({ sel: 1 }))?.id).toBe('edit.duplicate');
    expect(findKeyCommand(key('d', { metaKey: true }), ctxWith({ sel: 0 }))).toBeNull();
    expect(findKeyCommand(key('g', { ctrlKey: true }), ctxWith({ sel: 1 }))).toBeNull(); // group needs 2+
    expect(findKeyCommand(key('g', { ctrlKey: true }), ctxWith({ sel: 2 }))?.id).toBe('arrange.group');
    expect(findKeyCommand(key('v', { metaKey: true }), ctxWith({ sel: 0 }))?.id).toBe('edit.paste');
    expect(findKeyCommand(key('PageDown'), ctxWith())?.id).toBe('slide.next');
    expect(findKeyCommand({ ...key('}', { metaKey: true, shiftKey: true }), code: 'BracketRight' }, ctxWith({ sel: 1 }))?.id).toBe('arrange.front');
  });

  it('select-all needs elements on the slide', () => {
    expect(findKeyCommand(key('a', { metaKey: true }), ctxWith({ els: 0 }))).toBeNull();
    expect(findKeyCommand(key('a', { metaKey: true }), ctxWith({ els: 2 }))?.id).toBe('edit.selectAll');
  });

  it('skips a command whose action is not wired', () => {
    expect(findKeyCommand(key('m', { metaKey: true }), { sel: 0, els: 0, act: {} })).toBeNull();
  });

  it('ignores app- and presenter-scope keys (handled by their own surfaces)', () => {
    expect(findKeyCommand(key('Enter', { metaKey: true }), ctxWith())).toBeNull();
    expect(findKeyCommand(key('b'), ctxWith())).toBeNull();
  });

  it('running a nudge command passes the event (Shift = bigger step)', () => {
    const ctx = ctxWith({ sel: 1 });
    const e = key('ArrowLeft', { shiftKey: true });
    findKeyCommand(e, ctx).run(ctx, e);
    expect(ctx.act.nudge).toHaveBeenCalledWith(-1, 0, e);
  });
});

describe('menuItems', () => {
  it('builds Menu items with formatted kbd and runnable onClick', () => {
    const ctx = ctxWith({ sel: 1 });
    const items = menuItems(['edit.copy', '-', 'edit.delete'], ctx, { mac: true });
    expect(items).toEqual([
      expect.objectContaining({ label: 'Copy', kbd: '⌘C', icon: 'copy' }),
      '-',
      expect.objectContaining({ label: 'Delete', kbd: '⌫' }),
    ]);
    items[0].onClick();
    expect(ctx.act.copy).toHaveBeenCalled();
  });

  it('drops unavailable commands and collapses stray separators', () => {
    const items = menuItems(['-', 'edit.copy', '-', '-', 'arrange.group', '-', 'edit.paste', '-'], ctxWith({ sel: 0 }), { mac: false });
    expect(items).toEqual([expect.objectContaining({ label: 'Paste', kbd: 'Ctrl+V' })]);
  });

  it('passes through raw items and headers', () => {
    const raw = { icon: 'layers', label: 'Change layout', onClick: () => {} };
    expect(menuItems([{ header: 'Slide' }, raw], ctxWith(), { mac: true })).toEqual([{ header: 'Slide' }, raw]);
  });

  it('drops an unknown id', () => {
    expect(menuItems(['nope'], ctxWith(), { mac: true })).toEqual([]);
  });
});

describe('paletteCommands', () => {
  it('lists runnable editor commands, filtered by a case-insensitive query', () => {
    const ctx = ctxWith({ sel: 1 });
    const all = paletteCommands(ctx, '', { mac: true });
    expect(all.map((c) => c.id)).toContain('edit.duplicate');
    expect(all.map((c) => c.id)).not.toContain('view.palette'); // the palette doesn't list itself
    expect(all.every((c) => typeof c.run === 'function')).toBe(true);
    const dup = paletteCommands(ctx, 'DUPL', { mac: true });
    expect(dup.map((c) => c.label)).toEqual(['Duplicate', 'Duplicate slide']);
    expect(dup[0].kbd).toBe('⌘D');
    dup[0].run();
    expect(ctx.act.duplicate).toHaveBeenCalled();
  });

  it('omits commands not applicable now (group with one selected)', () => {
    expect(paletteCommands(ctxWith({ sel: 1 }), 'group', { mac: true }).map((c) => c.id)).toEqual(['arrange.ungroup']);
  });

  it('omits hidden key-only commands (individual nudges)', () => {
    expect(paletteCommands(ctxWith({ sel: 1 }), 'nudge', { mac: true })).toEqual([]);
  });
});

describe('shortcutGroups', () => {
  it('groups every bound shortcut (all scopes) for the Settings page', () => {
    const groups = shortcutGroups({ mac: true });
    const rows = Object.fromEntries(groups.flatMap((g) => g.rows));
    expect(rows.Duplicate).toBe('⌘D');
    expect(rows.Present).toBe('⌘⏎');
    expect(rows.Redo).toBe('⌘⇧Z / ⌘Y');
    expect(rows['Next slide (slide show)']).toBe('→ / Space');
    expect(rows['Nudge selection']).toBe('↑ ↓ ← → (⇧ ×5)');
    expect(Object.values(rows).every(Boolean)).toBe(true); // no unbound rows
    expect(groups.map((g) => g.g)).toEqual(['Edit', 'Arrange', 'Insert & tools', 'Slides', 'Slide show']);
  });

  it('spells modifiers out off-Mac', () => {
    const rows = Object.fromEntries(shortcutGroups({ mac: false }).flatMap((g) => g.rows));
    expect(rows['Bring to front']).toBe('Ctrl+Shift+]');
  });
});
