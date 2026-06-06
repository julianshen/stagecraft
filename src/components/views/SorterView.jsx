import { useState, useMemo } from 'react';
import SorterToolbar from '../sorter/SorterToolbar.jsx';
import SorterGrid from '../sorter/SorterGrid.jsx';
import SorterOutline from '../sorter/SorterOutline.jsx';

export default function SorterView({ deck, onBack, onOpenSlide }) {
  const [mode, setMode] = useState('grid'); // grid | outline

  const flat = useMemo(() => {
    const arr = [];
    deck.sections.forEach(sec => sec.slides.forEach(sid => {
      const s = deck.slides.find(x => x.id === sid);
      if (s) arr.push({ ...s, sectionId: sec.id, sectionName: sec.name });
    }));
    return arr;
  }, [deck]);

  const [active, setActive] = useState(null);

  return (
    <>
      <SorterToolbar mode={mode} setMode={setMode} onBack={onBack} />
      {mode === 'grid' ? (
        <SorterGrid deck={deck} flat={flat} active={active} setActive={setActive} onOpenSlide={onOpenSlide} />
      ) : (
        <SorterOutline deck={deck} flat={flat} active={active} setActive={setActive} onOpenSlide={onOpenSlide} />
      )}
    </>
  );
}
