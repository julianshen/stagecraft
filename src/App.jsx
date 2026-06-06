import { useState, useEffect } from 'react';
import Icon from './components/ui/Icon.jsx';
import { Button } from './components/ui/Primitives.jsx';
import { ACCENTS, SAMPLE_DECK } from './data/deck.js';

import HomeView     from './components/views/HomeView.jsx';
import Editor       from './components/editor/Editor.jsx';
import SorterView   from './components/views/SorterView.jsx';
import SettingsView from './components/views/SettingsView.jsx';
import PresenterView from './components/views/PresenterView.jsx';

import ExportModal  from './components/modals/ExportModal.jsx';
import TemplatePicker from './components/modals/TemplatePicker.jsx';

import TweaksPanel, { TWEAK_DEFAULTS } from './components/TweaksPanel.jsx';

function viewIdx(v) { return v === 'home' ? 1 : v === 'editor' ? 2 : v === 'sorter' ? 3 : v === 'settings' ? 4 : 0; }
function viewName(v) { return v === 'home' ? 'Home' : v === 'editor' ? 'Editor' : v === 'sorter' ? 'Sorter' : v === 'settings' ? 'Settings' : 'Other'; }

export default function App() {
  // ---- tweaks state (persisted) ----
  const [tw, setTw] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('stagecraft.tw'));
      if (saved) return { ...TWEAK_DEFAULTS, ...saved };
    } catch {}
    return TWEAK_DEFAULTS;
  });

  useEffect(() => {
    try { localStorage.setItem('stagecraft.tw', JSON.stringify(tw)); } catch {}
  }, [tw]);

  // ---- view state ----
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('stagecraft.view') || 'editor'; } catch { return 'editor'; }
  });

  useEffect(() => {
    try { localStorage.setItem('stagecraft.view', view); } catch {}
  }, [view]);

  const [modal, setModal] = useState(null);     // 'templates' | 'export' | null
  const [presenting, setPresenting] = useState(false);

  // ---- deck state (lifted from Editor so it persists across view switches) ----
  const [deck, setDeck] = useState(() => JSON.parse(JSON.stringify(SAMPLE_DECK)));

  // ---- apply theme + density + accent ----
  useEffect(() => {
    document.documentElement.setAttribute('data-theme',   tw.theme);
    document.documentElement.setAttribute('data-density', tw.density);
    const accent = ACCENTS[tw.accent] || ACCENTS.indigo;
    document.documentElement.style.setProperty('--accent',      `oklch(0.62 ${accent.chroma} ${accent.hue})`);
    document.documentElement.style.setProperty('--accent-2',    `oklch(0.55 ${accent.chroma} ${accent.hue})`);
    document.documentElement.style.setProperty('--accent-wash', `oklch(0.62 ${accent.chroma} ${accent.hue} / ${tw.theme === 'dark' ? 0.18 : 0.08})`);
  }, [tw]);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey && e.key === 'Enter') { setPresenting(true); }
      if (e.key === 'Escape') { setModal(null); setPresenting(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (presenting) {
    return <PresenterView deck={deck} onExit={() => setPresenting(false)}/>;
  }

  return (
    <div className="app" data-screen-label={`${String(viewIdx(view)).padStart(2, '0')} ${viewName(view)}`}>
      {/* ---- top bar ---- */}
      <div className="topbar">
        <div className="logo">
          <div className="logo-mark">S</div>
          <span>Stagecraft</span>
        </div>

        <nav className="topbar-nav">
          <button className={`tab ${view === 'home'   ? 'active' : ''}`} onClick={() => setView('home')}>
            <Icon name="folder" size={13}/>Files
          </button>
          <button className={`tab ${view === 'editor' ? 'active' : ''}`} onClick={() => setView('editor')}>
            <Icon name="frame"  size={13}/>Editor
          </button>
          <button className={`tab ${view === 'sorter' ? 'active' : ''}`} onClick={() => setView('sorter')}>
            <Icon name="grid"   size={13}/>Sorter
          </button>
        </nav>

        <div className="topbar-title">
          {view === 'home' ? (
            <div className="input-group" style={{ height: 26, width: 320, background: 'var(--bg)' }}>
              <span className="ico"><Icon name="search" size={12}/></span>
              <input placeholder="Search decks and slides…"/>
              <span className="kbd">⌘K</span>
            </div>
          ) : view === 'settings' ? (
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>Settings</span>
          ) : (
            <>
              <span className="doc-name">Meet Stagecraft</span>
              <span className="saved">Saved · 12s</span>
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

      {/* ---- views ---- */}
      {view === 'home' && (
        <HomeView
          onOpenDeck={() => setView('editor')}
          onNewDeck={() => setView('editor')}
          onOpenTemplates={() => setModal('templates')}
        />
      )}

      {view === 'editor' && (
        <Editor
          deck={deck}
          onDeckChange={setDeck}
          accent={tw.accent}
          layoutVariant={tw.layout}
          density={tw.density}
          onPresent={() => setPresenting(true)}
          onOpenExport={() => setModal('export')}
          onOpenHome={() => setView('home')}
        />
      )}

      {view === 'sorter' && (
        <SorterView deck={deck} onBack={() => setView('editor')} onOpenSlide={() => setView('editor')}/>
      )}

      {view === 'settings' && (
        <SettingsView tw={tw} setTw={setTw}/>
      )}

      {/* ---- modals ---- */}
      {modal === 'templates' && (
        <TemplatePicker
          onClose={() => setModal(null)}
          onPick={() => { setModal(null); setView('editor'); }}
        />
      )}

      {modal === 'export' && (
        <ExportModal onClose={() => setModal(null)} deck={deck}/>
      )}

      {/* ---- tweaks panel (activated via postMessage) ---- */}
      <TweaksPanel state={tw} setState={setTw}/>
    </div>
  );
}
