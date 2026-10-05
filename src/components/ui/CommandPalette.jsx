import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// ⌘K command palette: a filterable list of the editor commands that apply
// right now (from lib/commands.js). ↑/↓ move the highlight, Enter or a click
// runs the command and closes, Escape or a backdrop click closes.
// `getCommands(query)` returns [{ id, label, icon, kbd, run }].
export function CommandPalette({ getCommands, onClose }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  // Recomputed per query, not per hover (hover only moves the highlight).
  const commands = useMemo(() => getCommands(query), [getCommands, query]);
  const current = Math.min(active, Math.max(0, commands.length - 1));

  useEffect(() => { inputRef.current?.focus(); }, []);

  const run = (cmd) => { onClose(); cmd.run(); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.max(0, Math.min(current + 1, commands.length - 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(current - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (commands[current]) run(commands[current]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div className="modal small palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <Icon name="search" size={13} />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={commands[current] ? `palette-${commands[current].id}` : undefined}
            placeholder="Type a command…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
          />
        </div>
        <ul className="palette-list" id="palette-list" role="listbox">
          {commands.length === 0 && <li className="palette-empty">No matching commands</li>}
          {commands.map((c, i) => (
            <li
              key={c.id}
              id={`palette-${c.id}`}
              role="option"
              aria-selected={i === current}
              className={`ctx-item${i === current ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
            >
              <span className="ico">{c.icon && <Icon name={c.icon} size={13} />}</span>
              <span className="lbl">{c.label}</span>
              {c.kbd && <span className="kbd">{c.kbd}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
