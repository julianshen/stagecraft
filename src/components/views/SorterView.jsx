import { useState, useMemo } from 'react';
import SorterToolbar from '../sorter/SorterToolbar.jsx';
import SorterGrid from '../sorter/SorterGrid.jsx';
import SorterOutline from '../sorter/SorterOutline.jsx';

const EMPTY_DECK = { sections: [], slides: [] };

export default function SorterView({ deck, onBack, onOpenSlide }) {
  const [mode, setMode] = useState('grid'); // grid | outline

  // Normalize once so neither this view nor its children (which call
  // deck.sections.map) crash on a null or partially-populated deck.
  const safeDeck = deck || EMPTY_DECK;

  const flat = useMemo(() => {
    const arr = [];
    (safeDeck.sections || []).forEach(sec => (sec?.slides || []).forEach(sid => {
      const s = (safeDeck.slides || []).find(x => x.id === sid);
      if (s) arr.push({ ...s, sectionId: sec.id, sectionName: sec.name });
    }));
    return arr;
  }, [safeDeck]);

  const [active, setActive] = useState(null);

  return (
    <>
      <SorterToolbar mode={mode} setMode={setMode} onBack={onBack} />
      {mode === 'grid' ? (
        <SorterGrid deck={safeDeck} flat={flat} active={active} setActive={setActive} onOpenSlide={onOpenSlide} />
      ) : (
        <SorterOutline deck={safeDeck} flat={flat} active={active} setActive={setActive} onOpenSlide={onOpenSlide} />
      )}
    </>
  );
}
