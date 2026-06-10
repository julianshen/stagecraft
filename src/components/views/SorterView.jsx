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
  // A failed/empty AI rearrange used to be a silent no-op, indistinguishable from
  // "already optimal" — surface it. Null = nothing to show (success or genuinely
  // no change); a string is shown by the toolbar and cleared on the next attempt.
  const [rearrangeError, setRearrangeError] = useState(null);
  const onRearrange = editable ? async () => {
    setRearrangeError(null); // any fresh attempt clears stale feedback, even a no-op one
    if (rearranging || flat.length < 2) return; // nothing to reorder → skip the API call
    // Signature of the section structure the model reasoned about: both the slide
    // order AND its section membership (applySlideOrder re-chunks by section size,
    // so a cross-section move with an unchanged flat order would otherwise slip
    // through). `/` and `|` can't appear in generated ids.
    const sig = (d) => flattenDeck(d).map((s) => `${s.sectionId}/${s.id}`).join('|');
    const before = sig(safeDeck);
    setRearranging(true);
    // One honest message: the proxy collapses a provider/auth error into a 200
    // whose text fails to parse → null (same as a genuinely bad reply), so a
    // failure can't be reliably told apart from a transport throw at this layer.
    // No API key is the most likely cause, so point at the AI settings.
    const failMsg = 'Couldn’t rearrange — check your AI settings and try again.';
    try {
      const order = await suggestSlideOrder(safeDeck);
      if (!order) { setRearrangeError(failMsg); return; }
      // The Sorter stays editable during the request — if a manual drag/rename
      // /delete or an MCP edit changed the structure while it was in flight, the
      // AI order is stale; drop it rather than clobber the fresh intent.
      onDeckChange((prev) => (sig(prev) === before ? applySlideOrder(prev, order) : prev));
    } catch {
      setRearrangeError(failMsg);
    } finally { setRearranging(false); }
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
      <SorterToolbar mode={mode} setMode={setMode} onBack={onBack} onAddSection={onAddSection} onRearrange={onRearrange} rearranging={rearranging} rearrangeError={rearrangeError} />
      {mode === 'grid' ? (
        <SorterGrid deck={safeDeck} flat={flat} active={active} setActive={setActive} onOpenSlide={onOpenSlide} editable={editable} {...sectionOps} />
      ) : (
        <SorterOutline deck={safeDeck} flat={flat} active={active} setActive={setActive} onOpenSlide={onOpenSlide} />
      )}
    </>
  );
}
