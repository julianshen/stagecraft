import { useState, useMemo } from 'react';
import SorterToolbar from '../sorter/SorterToolbar.jsx';
import SorterGrid from '../sorter/SorterGrid.jsx';
import SorterOutline from '../sorter/SorterOutline.jsx';
import { flattenDeck, moveSlide, addSection, renameSection, deleteSection, applySlideOrder } from '../../lib/deckOrder.js';
import { suggestSlideOrder } from '../../lib/llmClient.js';

const EMPTY_DECK = { sections: [], slides: [] };

export default function SorterView({ deck, onBack, onOpenSlide, onDeckChange }) {
  const [mode, setMode] = useState('grid'); // grid | outline

  // Normalize once so neither this view nor its children (which call
  // deck.sections.map) crash on a null or partially-populated deck.
  const safeDeck = deck || EMPTY_DECK;

  const flat = useMemo(() => flattenDeck(safeDeck), [safeDeck]);

  const [active, setActive] = useState(null);

  // Editing is available only when the host wired a deck setter. Each handler
  // commits through the functional updater form (like the editor's mutations)
  // against the freshest deck, so a concurrent MCP/agent edit isn't clobbered.
  // `editable` lets the children render read-only when there's no setter.
  const editable = typeof onDeckChange === 'function';
  // "Add section" is a toolbar-only op; the grid gets the per-section ops.
  const onAddSection = editable ? () => onDeckChange((prev) => addSection(prev)?.deck ?? prev) : undefined;

  // Rearrange with AI: ask the model for a slide order, then apply it through
  // the freshest-deck updater. applySlideOrder tolerates the model dropping or
  // duplicating ids, and any AI error (no key, bad reply) just leaves the deck
  // untouched. `rearranging` drives the toolbar's busy label.
  const [rearranging, setRearranging] = useState(false);
  const onRearrange = editable ? async () => {
    if (rearranging || flat.length < 2) return; // nothing to reorder → skip the API call
    // Signature of the section structure the model reasoned about: both the slide
    // order AND its section membership (applySlideOrder re-chunks by section size,
    // so a cross-section move with an unchanged flat order would otherwise slip
    // through). `/` and `|` can't appear in generated ids.
    const sig = (d) => flattenDeck(d).map((s) => `${s.sectionId}/${s.id}`).join('|');
    const before = sig(safeDeck);
    setRearranging(true);
    try {
      const order = await suggestSlideOrder(safeDeck);
      // The Sorter stays editable during the request — if a manual drag/rename
      // /delete or an MCP edit changed the structure while it was in flight, the
      // AI order is stale; drop it rather than clobber the fresh intent.
      if (order) onDeckChange((prev) => (sig(prev) === before ? applySlideOrder(prev, order) : prev));
    } catch { /* AI errors are non-fatal — the deck just isn't reordered */ }
    finally { setRearranging(false); }
  } : undefined;
  const sectionOps = editable
    ? {
        onReorder: (slideId, toSectionId, toIndex) => onDeckChange((prev) => moveSlide(prev, slideId, toSectionId, toIndex)),
        onRenameSection: (id, name) => onDeckChange((prev) => renameSection(prev, id, name)),
        onDeleteSection: (id) => onDeckChange((prev) => deleteSection(prev, id)),
      }
    : {};

  return (
    <>
      <SorterToolbar mode={mode} setMode={setMode} onBack={onBack} onAddSection={onAddSection} onRearrange={onRearrange} rearranging={rearranging} />
      {mode === 'grid' ? (
        <SorterGrid deck={safeDeck} flat={flat} active={active} setActive={setActive} onOpenSlide={onOpenSlide} editable={editable} {...sectionOps} />
      ) : (
        <SorterOutline deck={safeDeck} flat={flat} active={active} setActive={setActive} onOpenSlide={onOpenSlide} />
      )}
    </>
  );
}
