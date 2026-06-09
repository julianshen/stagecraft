import { useState, useRef } from 'react';
import Icon from '../ui/Icon.jsx';
import { Button, IconButton } from '../ui/Primitives.jsx';
import { themeTint, initials, relativeTime } from '../../lib/decksApi.js';

// Turn a deck-library metadata record into the card view-model the grid renders.
function toCard(meta) {
  const name = meta.name || 'Untitled deck';
  return {
    id: meta.id,
    name,
    slides: meta.slides ?? 0,
    edited: meta.updatedAt ? relativeTime(meta.updatedAt) : '—',
    tint: themeTint(meta.theme),
    cover: initials(name),
    active: !!meta.active,
  };
}

function DeckCover({ deck }) {
  return (
    <div style={{ width: '100%', height: '100%', background: deck.tint, position: 'relative', color: 'white', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', bottom: 10, left: 12, fontFamily: 'var(--f-mono)', fontSize: 9, opacity: 0.6 }}>{deck.slides} slides</div>
      <div style={{ position: 'absolute', top: 10, right: 12, fontFamily: 'var(--f-mono)', fontSize: 9, opacity: 0.7 }}>{deck.cover}</div>
      <div style={{ position: 'absolute', bottom: 14, right: 14, width: 34, height: 34, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.3)' }}/>
      <div style={{ position: 'absolute', bottom: 20, right: 24, width: 18, height: 18, borderRadius: '50%', background: 'rgba(255,255,255,0.8)' }}/>
      <div style={{ position: 'absolute', left: '10%', top: '45%', fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: 'white', lineHeight: 1.1, maxWidth: '65%' }}>{deck.name}</div>
    </div>
  );
}

export default function HomeView({ decks = [], onOpenDeck, onNewDeck, onOpenTemplates, onRenameDeck, onDeleteDeck }) {
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('grid');
  const [menuId, setMenuId] = useState(null);   // card whose actions menu is open
  const [confirmingDelete, setConfirmingDelete] = useState(false); // delete armed in the open menu
  const [renaming, setRenaming] = useState(null); // card being renamed inline
  const [renameValue, setRenameValue] = useState('');

  const toggleMenu = (id) => { setMenuId(menuId === id ? null : id); setConfirmingDelete(false); };

  const cards = decks.map(toCard);

  // A rename session ends exactly once. Enter/blur both route here, and clearing
  // `renaming` unmounts the input which fires another blur — the ref makes that
  // re-entry a no-op (a stale-closure state check wouldn't, since the unmounting
  // input's handler closes over the pre-clear `renaming`). Escape ends without
  // committing.
  const renameSettled = useRef(false);
  const startRename = (card) => { renameSettled.current = false; setMenuId(null); setRenaming(card.id); setRenameValue(card.name); };
  const endRename = (id, commit) => {
    if (renameSettled.current) return;
    renameSettled.current = true;
    const name = renameValue.trim();
    setRenaming(null);
    if (commit && name) onRenameDeck?.(id, name);
  };

  const sections = [
    { id: 'all',     label: 'All files',  count: cards.length, icon: 'grid' },
    { id: 'recent',  label: 'Recent',     count: cards.length, icon: 'history' },
    { id: 'starred', label: 'Starred',    count: 0,            icon: 'star' },
    { id: 'trash',   label: 'Trash',      count: 0,            icon: 'trash' },
  ];

  const newCards = [
    { id: 'blank',  title: 'Blank deck',    meta: '16:9 · 1920×1080', ico: 'plus',     primary: true },
    { id: 'ai',     title: 'Start with AI', meta: 'From a prompt',     ico: 'ai' },
    { id: 'tmpl',   title: 'From template', meta: '30+ templates',     ico: 'template' },
    { id: 'import', title: 'Import',        meta: '.pptx · .key',      ico: 'upload' },
  ];

  return (
    <div className="home">
      <aside className="home-side">
        <div className="group-label">Library</div>
        {sections.map(s => (
          <div
            key={s.id}
            className={`side-item ${filter === s.id ? 'active' : ''}`}
            onClick={() => setFilter(s.id)}
          >
            <Icon name={s.icon} size={14} />
            <span>{s.label}</span>
            <span className="count">{String(s.count).padStart(2, '0')}</span>
          </div>
        ))}
      </aside>

      <main className="home-main">
        <h1>Good afternoon.</h1>
        <p className="home-sub">You have <b>{cards.length} {cards.length === 1 ? 'deck' : 'decks'}</b> in your library.</p>

        <div className="home-actions">
          {newCards.map(c => (
            <div
              key={c.id}
              className={`new-card ${c.primary ? 'primary' : ''}`}
              onClick={() => c.id === 'tmpl' ? onOpenTemplates() : onNewDeck(c.id)}
            >
              <div className="preview">
                {c.primary
                  ? <div style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%' }}>
                      <div style={{ width: 48, height: 48, borderRadius: 12, border: '1.5px dashed rgba(255,255,255,0.3)', display: 'grid', placeItems: 'center' }}>
                        <Icon name={c.ico} size={20}/>
                      </div>
                    </div>
                  : <div style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: 'var(--ink-3)' }}>
                      <Icon name={c.ico} size={22}/>
                    </div>}
              </div>
              <div>
                <div className="title">{c.title}</div>
                <div className="meta">{c.meta}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="section-head">
          <h2>Your decks · {cards.length}</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Button variant="ghost" icon="filter">Filter</Button>
            <Button variant="ghost" icon="sort">Edited</Button>
            <div className="toggles">
              <IconButton name="grid"  active={view === 'grid'} onClick={() => setView('grid')}/>
              <IconButton name="list"  active={view === 'list'} onClick={() => setView('list')}/>
            </div>
          </div>
        </div>

        {cards.length === 0 ? (
          <div className="deck-empty" style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-3)' }}>
            <Icon name="frame" size={28}/>
            <p style={{ marginTop: 12 }}>No decks yet — create one to get started.</p>
            <Button variant="accent" icon="plus" onClick={() => onNewDeck()}>New deck</Button>
          </div>
        ) : view === 'grid' ? (
          <div className="deck-grid">
            {cards.map((d) => (
              <div key={d.id} className="deck-card" onClick={() => onOpenDeck(d.id)}>
                <div className="cover">
                  <DeckCover deck={d}/>
                </div>
                <div className="info">
                  <div className="title">
                    {renaming === d.id ? (
                      <input
                        autoFocus
                        className="deck-rename"
                        value={renameValue}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') endRename(d.id, true);
                          else if (e.key === 'Escape') endRename(d.id, false);
                        }}
                        onBlur={() => endRename(d.id, true)}
                        style={{ flex: 1, minWidth: 0, font: 'inherit', fontSize: 13, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--bg)', color: 'var(--ink)' }}
                      />
                    ) : (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    )}
                    {d.active && <span className="badge" style={{ background: 'var(--accent-wash)', color: 'var(--accent)' }}>LIVE</span>}
                    <div style={{ marginLeft: 'auto', position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                      <IconButton name="more-h" size={13} title={`Actions: ${d.name}`} onClick={() => toggleMenu(d.id)} />
                      {menuId === d.id && (
                        <div className="deck-menu" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 10, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: 'var(--shadow-2)', padding: 4, minWidth: 130 }}>
                          <button className="menu-item" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 0, color: 'var(--ink)', cursor: 'pointer', borderRadius: 4 }} onClick={() => startRename(d)}>Rename</button>
                          <button
                            className="menu-item"
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: confirmingDelete ? 'var(--accent-wash)' : 'none', border: 0, color: 'var(--danger)', cursor: 'pointer', borderRadius: 4, fontWeight: confirmingDelete ? 600 : 400 }}
                            onClick={() => {
                              if (confirmingDelete) { setMenuId(null); setConfirmingDelete(false); onDeleteDeck?.(d.id); }
                              else setConfirmingDelete(true); // arm — require a second click to confirm
                            }}
                          >{confirmingDelete ? 'Confirm delete' : 'Delete'}</button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="sub">
                    <span>{d.slides} slides</span>
                    <span style={{ color: 'var(--ink-4)' }}>·</span>
                    <span>{d.edited}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="deck-table">
            <div className="row header">
              <div>Name</div>
              <div>Slides</div>
              <div>Last edited</div>
              <div>Status</div>
            </div>
            {cards.map((d) => (
              <div key={d.id} className="row" onClick={() => onOpenDeck(d.id)}>
                <div className="name-cell">
                  <div className="mini" style={{ background: d.tint, color: 'white', display: 'grid', placeItems: 'center', fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 700 }}>{d.cover}</div>
                  <div>
                    <div style={{ fontWeight: 550 }}>{d.name}</div>
                    <div className="mono" style={{ fontSize: 10 }}>{d.id}.deck</div>
                  </div>
                </div>
                <div className="mono">{String(d.slides).padStart(2, '0')}</div>
                <div className="mono">{d.edited}</div>
                <div>
                  <span style={{
                    fontFamily: 'var(--f-mono)', fontSize: 10.5, padding: '2px 8px', borderRadius: 3,
                    background: d.active ? 'var(--accent-wash)' : 'var(--bg-2)',
                    color: d.active ? 'var(--accent)' : 'var(--ink-3)',
                  }}>
                    {d.active ? 'LIVE' : 'READY'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
