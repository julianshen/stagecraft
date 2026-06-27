import { useReducer, useEffect } from 'react';
import Icon from './ui/Icon.jsx';
import { Button } from './ui/Primitives.jsx';

function savedAgo(ts, now = Date.now()) {
  if (!ts) return '';
  const sec = Math.floor(Math.max(0, now - ts) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

export default function TopBar({ view, setView, deckTitle, setModal, onPresent, savedAt, searchQuery, onSearchChange }) {
  const [, tick] = useReducer(n => n + 1, 0);
  useEffect(() => {
    if (!savedAt || view === 'home' || view === 'settings') return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [savedAt, view]);
  const agoLabel = savedAgo(savedAt);
  return (
    <div className="topbar">
      <div className="logo">
        <div className="logo-mark">S</div>
        <span>Stagecraft</span>
      </div>

      <nav className="topbar-nav">
        <button className={`tab ${view === 'home' ? 'active' : ''}`} onClick={() => setView('home')}>
          <Icon name="folder" size={13} />Files
        </button>
        <button className={`tab ${view === 'editor' ? 'active' : ''}`} onClick={() => setView('editor')}>
          <Icon name="frame" size={13} />Editor
        </button>
        <button className={`tab ${view === 'sorter' ? 'active' : ''}`} onClick={() => setView('sorter')}>
          <Icon name="grid" size={13} />Sorter
        </button>
      </nav>

      <div className="topbar-title">
        {view === 'home' ? (
          <div className="input-group" style={{ height: 26, width: 320, background: 'var(--bg)' }}>
            <span className="ico"><Icon name="search" size={12} /></span>
            <input
              placeholder="Search decks and slides…"
              value={searchQuery ?? ''}
              onChange={(e) => onSearchChange?.(e.target.value)}
            />
            <span className="kbd">⌘K</span>
          </div>
        ) : view === 'settings' ? (
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>Settings</span>
        ) : (
          <>
            <span className="doc-name">{deckTitle}</span>
            <span className="saved">{agoLabel ? `Saved · ${agoLabel}` : 'Saved'}</span>
          </>
        )}
      </div>

      <div className="topbar-right">
        <Button
          variant="ghost"
          icon="settings"
          title="Settings"
          onClick={() => setView(view === 'settings' ? 'editor' : 'settings')}
          style={view === 'settings' ? { background: 'var(--accent-wash)', color: 'var(--accent)' } : undefined}
        >
          Settings
        </Button>
      </div>
    </div>
  );
}
