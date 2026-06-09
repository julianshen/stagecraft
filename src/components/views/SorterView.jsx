import { useState, useMemo } from 'react';
import SorterToolbar from '../sorter/SorterToolbar.jsx';
import SorterGrid from '../sorter/SorterGrid.jsx';
import SorterOutline from '../sorter/SorterOutline.jsx';
import { flattenDeck, moveSlide, addSection, renameSection, deleteSection } from '../../lib/deckOrder.js';

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
  const sectionOps = editable
    ? {
        onReorder: (slideId, toSectionId, toIndex) => onDeckChange((prev) => moveSlide(prev, slideId, toSectionId, toIndex)),
        onRenameSection: (id, name) => onDeckChange((prev) => renameSection(prev, id, name)),
        onDeleteSection: (id) => onDeckChange((prev) => deleteSection(prev, id)),
      }
    : {};

  return (
    <>
      <SorterToolbar mode={mode} setMode={setMode} onBack={onBack} onAddSection={onAddSection} />
      {mode === 'grid' ? (
        <SorterGrid deck={safeDeck} flat={flat} active={active} setActive={setActive} onOpenSlide={onOpenSlide} editable={editable} {...sectionOps} />
      ) : (
        <SorterOutline deck={safeDeck} flat={flat} active={active} setActive={setActive} onOpenSlide={onOpenSlide} />
      )}
    </>
  );
}
