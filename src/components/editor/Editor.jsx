import { useState, useEffect, useRef, useCallback } from 'react';
import SlideEditor from './SlideEditor.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';
import { createTableSlide, createChartSlide, createTextSlide, createComponentSlide } from '../../lib/slideFactories.js';
import { getFlatSlideIds, reconcileCurId, applySlidePatch, sanitizeSlidePatch } from '../../lib/deckUtils.js';
import { createElement, updateSlideElements, alignElements, distributeElements } from '../../lib/elements.js';
import { moveSlide, duplicateSlide, appendSlide } from '../../lib/deckOrder.js';

export default function Editor({ deck, onDeckChange, accent, layoutVariant, density, onPresent, onOpenExport }) {
  // Open on the first slide — for a freshly created deck that's the cover the
  // user just named. (Previously flat[3], a heuristic tuned to the sample deck.)
  const [curId, setCurId] = useState(() => getFlatSlideIds(deck)[0] || null);

  // Always-latest deck, so callbacks captured by an earlier render (e.g. the
  // Co-pilot's apply handler held across an in-flight request) read current state.
  const deckRef = useRef(deck);
  deckRef.current = deck;

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
    // appendSlide keeps a closing 'thanks' slide last (template skeletons end
    // with one), so inserts land before the closer instead of after the end.
    onDeckChange(prev => appendSlide(prev, slide));
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

  // Duplicate the current slide (deep clone with fresh ids, inserted after it)
  // and select the copy. Decide against the render-time deck via duplicateSlide
  // (its null contract is the single source of truth for "nothing to duplicate"),
  // then re-apply through the updater against the freshest deck with the SAME id
  // so selection matches — matching the other mutations and avoiding a
  // stale-closure overwrite racing the sync poll. Bailing on a null result means
  // we never select a phantom id when the op is a no-op.
  function duplicateCurrentSlide() {
    const result = duplicateSlide(deck, curId);
    if (!result) return;
    const { newId } = result;
    onDeckChange(prev => duplicateSlide(prev, curId, newId)?.deck ?? prev);
    setCurId(newId);
  }

  // Apply an AI-generated patch to a specific slide (Co-pilot edits). The target
  // defaults to the current slide but is passed explicitly by the Co-pilot so an
  // in-flight edit lands on the slide it was generated for, not whatever is
  // selected by the time the model responds.
  // Returns the patch keys that actually applied, computed against the LATEST
  // slide (deckRef) — its current layout decides which fields survive, and a
  // slide deleted mid-request yields [] (no false success). The apply is
  // re-guarded inside the updater against `prev` so a removed slide is a no-op.
  function applyAIPatch(patch, targetId = curId) {
    if (!targetId || !patch) return [];
    const target = (deckRef.current?.slides || []).find(s => s.id === targetId);
    if (!target) return [];
    const applied = Object.keys(sanitizeSlidePatch(patch, target.layout));
    if (applied.length) {
      onDeckChange(prev =>
        (prev.slides || []).some(s => s.id === targetId) ? applySlidePatch(prev, targetId, patch) : prev
      );
    }
    return applied;
  }

  // ---- canvas elements (free-form overlay) ----
  const [selElIds, setSelElIds] = useState([]);
  // Deselect when switching slides.
  useEffect(() => { setSelElIds([]); }, [curId]);

  const currentSlide = (deck.slides || []).find(s => s.id === curId) || null;
  const slideElements = currentSlide?.elements || [];
  const selectedElements = slideElements.filter(e => selElIds.includes(e.id));
  // PropsPanel binds to a single element; expose the one selected (else null).
  const selectedElement = selectedElements.length === 1 ? selectedElements[0] : null;

  // Drop ids whose elements vanished (e.g. removed by a live edit).
  useEffect(() => {
    const live = selElIds.filter(id => slideElements.some(e => e.id === id));
    if (live.length !== selElIds.length) setSelElIds(live);
  }, [slideElements, selElIds]);

  // Select an element; with `additive` (shift-click) toggle it within the set.
  function selectElement(id, additive = false) {
    if (id == null) { setSelElIds([]); return; }
    setSelElIds(prev => additive
      ? (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
      : [id]);
  }
  // Replace the selection with the elements swept by a marquee.
  function marqueeSelect(ids) {
    setSelElIds(ids || []);
  }

  function addElement(type) {
    if (!curId) return;
    const id = `el-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
    onDeckChange(prev => updateSlideElements(prev, curId, els => [...els, createElement(type, { id })]));
    setSelElIds([id]);
  }
  function updateElement(id, patch) {
    onDeckChange(prev => updateSlideElements(prev, curId, els => els.map(e => (e.id === id ? { ...e, ...patch } : e))));
  }
  // Batch path for a multi-element drag: one deck commit (and one PUT) for the
  // whole gesture. `updates` is a Map id→element.
  function updateElements(updates) {
    if (!updates || updates.size === 0) return;
    onDeckChange(prev => updateSlideElements(prev, curId, els =>
      els.map(e => (updates.has(e.id) ? { ...e, ...updates.get(e.id) } : e))));
  }
  function deleteSelectedElements() {
    if (!selElIds.length) return;
    const ids = new Set(selElIds);
    onDeckChange(prev => updateSlideElements(prev, curId, els => els.filter(e => !ids.has(e.id))));
    setSelElIds([]);
  }
  // Align the current multi-selection along an edge (no-op for <2 selected).
  function alignSelected(edge) {
    if (selElIds.length < 2) return;
    const ids = new Set(selElIds);
    onDeckChange(prev => updateSlideElements(prev, curId, els => {
      const aligned = alignElements(els.filter(e => ids.has(e.id)), edge);
      const byId = new Map(aligned.map(e => [e.id, e]));
      return els.map(e => byId.get(e.id) || e);
    }));
  }
  // Evenly distribute the multi-selection (no-op for <3). The axis is picked
  // from the selection's bounding box: a wider-than-tall spread distributes
  // horizontally, otherwise vertically.
  function distributeSelected() {
    const ids = new Set(selElIds);
    const sel = slideElements.filter(e => ids.has(e.id));
    if (sel.length < 3) return; // guard on live elements, not (possibly stale) ids
    const spanX = Math.max(...sel.map(e => e.x + e.w)) - Math.min(...sel.map(e => e.x));
    const spanY = Math.max(...sel.map(e => e.y + e.h)) - Math.min(...sel.map(e => e.y));
    const axis = spanX >= spanY ? 'h' : 'v';
    onDeckChange(prev => updateSlideElements(prev, curId, els => {
      const distributed = distributeElements(els.filter(e => ids.has(e.id)), axis);
      const byId = new Map(distributed.map(e => [e.id, e]));
      return els.map(e => byId.get(e.id) || e);
    }));
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
      selectedElement={selectedElement}
      selectedElementIds={selElIds}
      selectedElementCount={selectedElements.length}
      onSelectElement={selectElement}
      callbacks={{
        onAddElement: addElement,
        onUpdateElement: updateElement,
        onUpdateElements: updateElements,
        onDeleteElements: deleteSelectedElements,
        onAlignElements: alignSelected,
        onDistributeElements: distributeSelected,
        onMarqueeSelect: marqueeSelect,
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
        onDuplicateSlide: duplicateCurrentSlide,
        onReorderSlide: (slideId, toSectionId, toIndex) => onDeckChange(prev => moveSlide(prev, slideId, toSectionId, toIndex)),
        onApplyAIPatch: applyAIPatch,
      }}
    />
  );
}
