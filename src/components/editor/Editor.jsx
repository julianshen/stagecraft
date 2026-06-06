import { useState, useEffect, useRef, useCallback } from 'react';
import SlideEditor from './SlideEditor.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';
import { createTableSlide, createChartSlide, createTextSlide, createComponentSlide } from '../../lib/slideFactories.js';
import { getFlatSlideIds } from '../../lib/deckUtils.js';

export default function Editor({ deck, onDeckChange, accent, layoutVariant, density, onPresent, onOpenExport }) {
  const [curId, setCurId] = useState(() => {
    const flat = getFlatSlideIds(deck);
    return flat[3] || flat[0] || null;
  });

  // Reposition cursor when the current slide is deleted
  const deletingRef = useRef(null);
  useEffect(() => {
    if (deletingRef.current) {
      const { id, idx } = deletingRef.current;
      deletingRef.current = null;
      if (curId === id) {
        const flat = getFlatSlideIds(deck);
        const fallback = flat[idx] || flat[idx - 1] || flat[0] || null;
        if (fallback) setCurId(fallback);
      }
    }
  }, [deck]);

  // Sync deck state to the Vite MCP server
  useEffect(() => {
    fetch('/api/deck', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deck),
    }).catch(() => {}); // silently ignore if server isn't running
  }, [deck]);

  function pushSlide(slide) {
    onDeckChange(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.slides.push(slide);
      next.sections[next.sections.length - 1].slides.push(slide.id);
      return next;
    });
    setCurId(slide.id);
  }

  function addTable(rows, cols) { pushSlide(createTableSlide(rows, cols)); }
  function addChart(type) { pushSlide(createChartSlide(type)); }
  function addText(style) { pushSlide(createTextSlide(style)); }
  function addComponent(id) { pushSlide(createComponentSlide(id)); }

  function changeLayout(layout) {
    if (!curId) return;
    onDeckChange(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const s = next.slides.find(x => x.id === curId);
      if (s) s.layout = layout;
      return next;
    });
  }

  function changeTheme(theme) {
    onDeckChange(prev => ({ ...prev, theme }));
  }

  function deleteSlide(slideId) {
    const flat = getFlatSlideIds(deck);
    deletingRef.current = { id: slideId, idx: flat.indexOf(slideId) };

    onDeckChange(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.slides = next.slides.filter(s => s.id !== slideId);
      next.sections = (next.sections || []).map(sec => ({
        ...sec,
        slides: sec.slides.filter(sid => sid !== slideId),
      }));
      return next;
    });
  }

  const renderSlide = useCallback((slide, ctx) => (
    <Slide slide={slide} deck={ctx.deck} sectionName={ctx.sectionName} num={ctx.num} total={ctx.total} />
  ), []);

  return (
    <SlideEditor
      deck={deck}
      currentSlideId={curId || undefined}
      onCurrentSlideChange={setCurId}
      renderSlide={renderSlide}
      layoutVariant={layoutVariant}
      theme={{ accent, density }}
      callbacks={{
        onPresent,
        onExport: onOpenExport,
        onAddTable: addTable,
        onAddChart: addChart,
        onAddComponent: addComponent,
        onAddText: addText,
        onChangeLayout: changeLayout,
        onChangeTheme: changeTheme,
        onNewSlide: () => addComponent('text'),
        onDeleteSlide: deleteSlide,
      }}
    />
  );
}
