import { useState, useEffect } from 'react';
import { ACCENTS, SAMPLE_DECK } from './data/deck.js';
import TopBar from './components/TopBar.jsx';

import HomeView     from './components/views/HomeView.jsx';
import Editor       from './components/editor/Editor.jsx';
import SorterView   from './components/views/SorterView.jsx';
import SettingsView from './components/views/SettingsView.jsx';
import PresenterView from './components/views/PresenterView.jsx';

import ExportModal  from './components/modals/ExportModal.jsx';
import TemplatePicker from './components/modals/TemplatePicker.jsx';

import TweaksPanel, { TWEAK_DEFAULTS } from './components/TweaksPanel.jsx';
import { useDeckSync } from './hooks/useDeckSync.js';
import { listDecks, createDeck, openDeck } from './lib/decksApi.js';

const VIEW_LABELS = { home: 'Home', editor: 'Editor', sorter: 'Sorter', settings: 'Settings' };
const VIEW_ORDER = ['home', 'editor', 'sorter', 'settings'];

function viewIdx(v) { const i = VIEW_ORDER.indexOf(v); return i >= 0 ? i + 1 : 0; }
function viewName(v) { return VIEW_LABELS[v] || 'Other'; }

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

  // Two-way sync with the in-memory MCP server: push local edits and adopt
  // external (MCP/agent) edits live. Runs app-wide so it works in every view.
  // Returns `adoptDeck(deck, rev)` for adopting an authoritative server deck
  // (e.g. on open) without echoing it back as a fresh edit.
  const adoptDeck = useDeckSync(deck, setDeck);

  // ---- deck library (multi-deck) ----
  const [decks, setDecks] = useState([]);
  // Refresh the library whenever Home is shown (badges/edited times stay current).
  useEffect(() => {
    if (view !== 'home') return;
    let cancelled = false;
    listDecks().then((d) => { if (!cancelled && Array.isArray(d)) setDecks(d); }).catch(() => { /* server absent */ });
    return () => { cancelled = true; };
  }, [view]);

  // Open a saved deck: activate it server-side, adopt its content, go to the
  // editor. Stay on Home if the request fails.
  const handleOpenDeck = async (id) => {
    try {
      const { deck: opened, rev } = await openDeck(id);
      if (!opened) return;          // no content — stay on Home rather than show a stale deck
      adoptDeck(opened, rev, id);   // tag subsequent writes for this deck
      setView('editor');
    } catch { /* server error — stay on Home */ }
  };
  // Create a blank deck (server creates + activates it), then open it.
  const handleNewDeck = async () => {
    try {
      const meta = await createDeck();
      if (meta?.id) await handleOpenDeck(meta.id);
    } catch { /* server error — stay on Home */ }
  };

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
      <TopBar view={view} setView={setView} deckTitle={deck?.title || 'Untitled deck'} setModal={setModal} onPresent={() => setPresenting(true)} />

      {/* ---- views ---- */}
      {view === 'home' && (
        <HomeView
          decks={decks}
          onOpenDeck={handleOpenDeck}
          onNewDeck={handleNewDeck}
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
