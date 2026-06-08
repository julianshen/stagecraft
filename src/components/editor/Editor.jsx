import { useState, useEffect, useRef, useCallback } from 'react';
import SlideEditor from './SlideEditor.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';
import { createTableSlide, createChartSlide, createTextSlide, createComponentSlide } from '../../lib/slideFactories.js';
import { getFlatSlideIds, reconcileCurId, applySlidePatch } from '../../lib/deckUtils.js';

export default function Editor({ deck, onDeckChange, accent, layoutVariant, density, onPresent, onOpenExport }) {
  const [curId, setCurId] = useState(() => {
    const flat = getFlatSlideIds(deck);
    return flat[3] || flat[0] || null;
  });

  // Reconcile the selection whenever the deck changes — both for a local delete
  // (keep position) and when a live MCP/agent edit removes the selected slide.
  const deletingRef = useRef(null);
  useEffect(() => {
    const deleting = deletingRef.current;
    deletingRef.current = null;
    const next = reconcileCurId(getFlatSlideIds(deck), curId, deleting);
    if (next !== curId) setCurId(next);
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

  // Apply an AI-generated patch to a specific slide (Co-pilot edits). The target
  // defaults to the current slide but is passed explicitly by the Co-pilot so an
  // in-flight edit lands on the slide it was generated for, not whatever is
  // selected by the time the model responds.
  // Returns whether the target slide still exists (and was patched) so the
  // Co-pilot doesn't report success for a slide deleted mid-request.
  function applyAIPatch(patch, targetId = curId) {
    if (!targetId || !patch) return false;
    const exists = (deck.slides || []).some(s => s.id === targetId);
    if (exists) onDeckChange(prev => applySlidePatch(prev, targetId, patch));
    return exists;
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
        onApplyAIPatch: applyAIPatch,
      }}
    />
  );
}
