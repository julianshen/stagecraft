import { useState, useEffect, useRef, useCallback } from 'react';
import SlideEditor from './SlideEditor.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';
import { createTableSlide, createChartSlide, createTextSlide, createComponentSlide } from '../../lib/slideFactories.js';
import { getFlatSlideIds, reconcileCurId, applySlidePatch } from '../../lib/deckUtils.js';
import { createElement, updateSlideElements, alignElements, distributeElements, autoArrangeElements, reorderElement, duplicateElements, cloneElements, moveElement, expandToGroups, groupElements, ungroupElements, GRID } from '../../lib/elements.js';
import { moveSlide, duplicateSlide, appendSlide } from '../../lib/deckOrder.js';
import { fieldPatch, prepareAIPatch, applyPreparedPatch } from '../../lib/slideEdit.js';

export default function Editor({ deck, onDeckChange, accent, layoutVariant, density, onPresent, onOpenExport, onUndo, onRedo, canUndo, canRedo }) {
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
    if (!curId || currentSlide?.layout === layout) return; // skip a no-op re-select (avoids churn + a redundant PUT)
    // Route through the shared patch gate so switching layout drops collections
    // that don't fit the new layout (mergeSlide), exactly like the AI/inline edit
    // path — otherwise carried-over items render blank and the inspector can't
    // edit them (the gate rejects a mixed-shape collection on commit).
    onDeckChange(prev => applySlidePatch(prev, curId, { layout }));
  }

  function changeTheme(theme) {
    onDeckChange(prev => ({ ...prev, theme }));
  }

  // Deck-level heading scale (a title-size multiplier) — same deck-mutation path as
  // changeTheme; the renderer/export clamp it on read via resolveHeadingScale.
  function changeHeadingScale(headingScale) {
    onDeckChange(prev => ({ ...prev, headingScale }));
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
    // Prepare the patch (mint element ids → validate → clamp; see prepareAIPatch)
    // outside the reducer so id-minting is StrictMode-safe, then apply it against
    // the freshest deck — preserving the slide's existing images (applyPreparedPatch).
    const { patch: p, applied } = prepareAIPatch(patch, target.layout, genElId);
    if (applied.length) {
      onDeckChange(prev => applyPreparedPatch(prev, targetId, p));
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

  // Format a template text field on the current slide: set one fmt prop for the
  // field's path-key. Routes through the validated patch path (fieldPatch builds
  // the rebuilt `fmt` map; applyAIPatch sanitizes + merges it) so formatting
  // shares the same gate as inline edits and Co-pilot patches.
  function formatField(fmtKey, prop, value) {
    if (!currentSlide) return;
    applyAIPatch(fieldPatch(currentSlide, ['fmt', fmtKey, prop], value), currentSlide.id);
  }

  // Drop ids whose elements vanished (e.g. removed by a live edit).
  useEffect(() => {
    const live = selElIds.filter(id => slideElements.some(e => e.id === id));
    if (live.length !== selElIds.length) setSelElIds(live);
  }, [slideElements, selElIds]);

  // Select an element; with `additive` (shift-click) toggle it within the set.
  // Selecting any element pulls in its whole group, so a group always moves /
  // deletes / duplicates as a unit. Shift-click toggles the whole group in/out.
  function selectElement(id, additive = false) {
    if (id == null) { setSelElIds([]); return; }
    const group = expandToGroups(slideElements, [id]); // ≥ [id] for any real element; its whole group if grouped
    setSelElIds(prev => {
      if (!additive) return group;
      const allIn = group.every(m => prev.includes(m));
      return allIn ? prev.filter(x => !group.includes(x)) : [...new Set([...prev, ...group])];
    });
  }
  // Replace the selection with the marquee-swept elements, expanded to whole
  // groups (touching one member selects the group).
  function marqueeSelect(ids) {
    setSelElIds(expandToGroups(slideElements, ids || []));
  }

  // Fresh prefixed id (element / group), minted outside any reducer so a
  // StrictMode double-run is deterministic. randomUUID with a time+random fallback.
  const genId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
  const genElId = () => genId('el');
  function addElement(type, opts = {}) {
    if (!curId) return;
    const id = genElId();
    onDeckChange(prev => updateSlideElements(prev, curId, els => [...els, createElement(type, { ...opts, id })]));
    setSelElIds([id]);
  }
  // Duplicate the selection: offset clones with fresh ids, then select them.
  // Gate on the LIVE selected elements (still present), so the generated id
  // count matches the clones actually made and no phantom id gets selected; the
  // ids are minted up front so the reducer is deterministic under a StrictMode
  // double-run.
  function duplicateSelectedElements() {
    const live = slideElements.filter(e => selElIds.includes(e.id));
    if (!live.length) return;
    const newIds = live.map(genElId);
    onDeckChange(prev => updateSlideElements(prev, curId, els => duplicateElements(els, selElIds, newIds)));
    setSelElIds(newIds);
  }
  const genGroupId = () => genId('grp');
  // Group the selection under one fresh id (needs 2+ live members); selecting any
  // member then re-selects the whole group. Ungroup strips the id back off. The
  // export is unaffected — a group is a canvas relationship, not slide geometry.
  function groupSelectedElements() {
    // Expand at the mutation boundary too (not just at selection) so it's self-
    // defending — and `ids` are the live, whole-group members regrouped as one.
    const ids = expandToGroups(slideElements, selElIds);
    if (ids.length < 2) return;
    const gid = genGroupId();
    onDeckChange(prev => updateSlideElements(prev, curId, els => groupElements(els, ids, gid)));
  }
  function ungroupSelectedElements() {
    const ids = expandToGroups(slideElements, selElIds);
    if (!ids.length) return;
    onDeckChange(prev => updateSlideElements(prev, curId, els => ungroupElements(els, ids)));
  }
  // Keyboard nudge: move the whole selection by (dx, dy) (grid-snapped + clamped
  // by moveElement), committed as one batch update. Elements already pinned at
  // the boundary (no coordinate change) are dropped, so a fully-clamped nudge
  // commits nothing.
  function nudgeSelectedElements(dx, dy) {
    const ids = new Set(selElIds);
    const updates = new Map();
    slideElements.forEach(el => {
      if (!ids.has(el.id)) return;
      const moved = moveElement(el, dx, dy);
      if (moved.x !== el.x || moved.y !== el.y) updates.set(el.id, moved);
    });
    updateElements(updates);
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
  // Clipboard for cross-slide copy/paste — an in-app clipboard (survives slide
  // switches, not a reload), holding id-less element data.
  const clipboardRef = useRef([]);
  function copySelectedElements() {
    const sel = slideElements.filter(e => e && selElIds.includes(e.id));
    if (!sel.length) return false;
    clipboardRef.current = sel.map(({ id, ...rest }) => rest); // strip ids; keep geometry
    return true;
  }
  function cutSelectedElements() {
    if (copySelectedElements()) deleteSelectedElements();
  }
  // Paste the clipboard onto the current slide: offset clones with fresh ids,
  // selected; the clipboard then advances so repeated pastes cascade.
  function pasteElements() {
    const clip = clipboardRef.current;
    if (!clip.length || !curId) return;
    const newIds = clip.map(genElId);
    const clones = cloneElements(clip, newIds);
    onDeckChange(prev => updateSlideElements(prev, curId, els => [...els, ...clones]));
    setSelElIds(newIds);
    clipboardRef.current = clip.map(c => ({ ...c, x: c.x + GRID * 2, y: c.y + GRID * 2 }));
  }
  // Run a pure layout op on the current multi-selection and commit it: filter to
  // the live selected elements, bail if fewer than `minCount` remain, then map the
  // op's output back into slide.elements by id (untouched elements pass through).
  // Shared by align / distribute / auto-arrange — all guard on live elements, so a
  // stale id can't push a no-op commit (and a vanished element can't be arranged).
  function transformSelection(minCount, op) {
    const ids = new Set(selElIds);
    const sel = slideElements.filter(e => ids.has(e.id));
    if (sel.length < minCount) return;
    onDeckChange(prev => updateSlideElements(prev, curId, els => {
      const byId = new Map(op(els.filter(e => ids.has(e.id))).map(e => [e.id, e]));
      return els.map(e => byId.get(e.id) || e);
    }));
  }
  // Align the multi-selection to a shared edge (no-op for <2 selected).
  function alignSelected(edge) {
    transformSelection(2, els => alignElements(els, edge));
  }
  // Evenly distribute the multi-selection (no-op for <3). The axis is picked from
  // the selection's bounding box: a wider-than-tall spread distributes
  // horizontally, otherwise vertically.
  function distributeSelected() {
    transformSelection(3, (els) => {
      const spanX = Math.max(...els.map(e => e.x + e.w)) - Math.min(...els.map(e => e.x));
      const spanY = Math.max(...els.map(e => e.y + e.h)) - Math.min(...els.map(e => e.y));
      return distributeElements(els, spanX >= spanY ? 'h' : 'v');
    });
  }
  // Tidy the multi-selection into a grid (no-op for <2). The layout math lives in
  // autoArrangeElements; positions derive from the selection's own centroid.
  function autoArrangeSelected() {
    transformSelection(2, autoArrangeElements);
  }
  // Z-order the single selected element ('front'|'back'); paint order = array order.
  function arrangeElement(op) {
    if (selElIds.length !== 1) return;
    const id = selElIds[0];
    onDeckChange(prev => updateSlideElements(prev, curId, els => reorderElement(els, id, op)));
  }

  const renderSlide = useCallback((slide, ctx) => (
    <Slide slide={slide} deck={ctx.deck} sectionName={ctx.sectionName} num={ctx.num} total={ctx.total} />
  ), []);

  // Canvas-only variant: slide text is editable in place. A commit emits the
  // field's path + value; we build the patch here (fieldPatch) and route it
  // through applyAIPatch (the Co-pilot's validated path), tagged to the exact
  // slide rendered. Thumbnails/sorter/presenter keep the read-only render.
  const renderCanvasSlide = (slide, ctx) => (
    <Slide
      slide={slide} deck={ctx.deck} sectionName={ctx.sectionName} num={ctx.num} total={ctx.total}
      editable onEditField={(path, value) => applyAIPatch(fieldPatch(slide, path, value), slide.id)}
      onApplyPatch={(patch) => applyAIPatch(patch, slide.id)}
    />
  );

  return (
    <SlideEditor
      deck={deck}
      currentSlideId={curId || undefined}
      onCurrentSlideChange={setCurId}
      renderSlide={renderSlide}
      renderCanvasSlide={renderCanvasSlide}
      layoutVariant={layoutVariant}
      theme={{ accent, density }}
      selectedElement={selectedElement}
      selectedElementIds={selElIds}
      selectedElementCount={selectedElements.length}
      onSelectElement={selectElement}
      canUndo={canUndo}
      canRedo={canRedo}
      callbacks={{
        onUndo,
        onRedo,
        onAddElement: addElement,
        onUpdateElement: updateElement,
        onUpdateElements: updateElements,
        onDeleteElements: deleteSelectedElements,
        onAlignElements: alignSelected,
        onDistributeElements: distributeSelected,
        onAutoArrange: autoArrangeSelected,
        onArrangeElement: arrangeElement,
        onDuplicateElements: duplicateSelectedElements,
        onGroupElements: groupSelectedElements,
        onUngroupElements: ungroupSelectedElements,
        onNudgeElements: nudgeSelectedElements,
        onCopyElements: copySelectedElements,
        onCutElements: cutSelectedElements,
        onPasteElements: pasteElements,
        onMarqueeSelect: marqueeSelect,
        onPresent,
        onExport: onOpenExport,
        onAddTable: addTable,
        onAddChart: addChart,
        onAddComponent: addComponent,
        onAddText: addText,
        onChangeLayout: changeLayout,
        onChangeTheme: changeTheme,
        onChangeHeadingScale: changeHeadingScale,
        onNewSlide: () => addComponent('text'),
        onDeleteSlide: deleteSlide,
        onDuplicateSlide: duplicateCurrentSlide,
        onReorderSlide: (slideId, toSectionId, toIndex) => onDeckChange(prev => moveSlide(prev, slideId, toSectionId, toIndex)),
        onApplyAIPatch: applyAIPatch,
        onFormatField: formatField,
      }}
    />
  );
}
