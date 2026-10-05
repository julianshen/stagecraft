import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Icon from '../ui/Icon.jsx';
import { Button, IconButton, Menu } from '../ui/Primitives.jsx';
import { flattenDeck } from '../../lib/deckOrder.js';
import Ruler from './Ruler.jsx';
import StatusBar from './StatusBar.jsx';
import CollabLayer from './CollabLayer.jsx';
import ThumbsPane from './ThumbsPane.jsx';
import CanvasSlide from './CanvasSlide.jsx';
import FormatToolbar from './FormatToolbar.jsx';
import Toaster from '../ui/Toaster.jsx';
import { useToasts } from '../../hooks/useToasts.js';
import { clampElement, GRID } from '../../lib/elements.js';
import { readImageFile } from '../../lib/imageFile.js';
import { isTextEntryTarget } from '../../lib/domEvents.js';
import { dispatchKey, menuItems, paletteCommands, tooltip } from '../../lib/commands.js';
import CommandPalette from '../ui/CommandPalette.jsx';
import ShapeMenu, { SHAPE_TOOLS } from './menus/ShapeMenu.jsx';
import TextMenu from './menus/TextMenu.jsx';
import TableSizePicker from './menus/TableSizePicker.jsx';
import ChartTypePicker from './menus/ChartTypePicker.jsx';
import LayoutMenu from './menus/LayoutMenu.jsx';
import { LAYOUT_OPTIONS } from './menus/LayoutGrid.jsx';
import ThemeMenu, { THEME_OPTIONS } from './menus/ThemeMenu.jsx';
import ComponentMenu from './menus/ComponentMenu.jsx';
import InspectorPane from './inspector/InspectorPane.jsx';
import FloatingInspector from './inspector/FloatingInspector.jsx';
import TimelineDrawer from './drawers/TimelineDrawer.jsx';
import DefaultAIDrawer from './drawers/DefaultAIDrawer.jsx';

// Toolbar tooltips naming each command's real, bound shortcut (from the registry).
const TIPS = {
  image: tooltip('Image', 'insert.image'),
  front: tooltip('Bring to front', 'arrange.front'),
  back: tooltip('Send to back', 'arrange.back'),
  newSlide: tooltip('New slide', 'slide.new'),
};

const DEFAULT_TOOLS = [
  { id:'select', icon:'cursor',  title: tooltip('Select', 'tool.select') },
];

const PEN_TOOLS = [
  { id:'pen',    icon:'pen',     title: tooltip('Pen', 'tool.pen') },
];

// Right-click menus, as registry command ids ('-' = separator). The canvas menu
// adds the layout/theme drill-in choosers between the edit and slide groups.
const ELEMENT_MENU = ['edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate', 'edit.delete', '-',
  'arrange.front', 'arrange.back', '-', 'arrange.group', 'arrange.ungroup'];
const SLIDE_MENU = ['slide.new', 'slide.duplicate', 'slide.delete'];

// Tool ids that draw an element on the canvas (the shape tools + the pen). When
// one is the active tool, a canvas gesture draws (a shape box, or a freehand pen
// stroke) rather than marquee-selecting.
const DRAW_TOOL_IDS = new Set([...SHAPE_TOOLS, ...PEN_TOOLS].map((t) => t.id));

// The context menu's "Change layout" / "Apply theme" drill-in choosers, built
// from the same option lists the toolbar menus use. One config so the two
// choosers don't duplicate the option→item mapping (theme options carry no icon
// of their own, so they fall back to the menu's palette icon).
const SUBMENU_CHOOSERS = {
  layout: { header: 'Change layout', options: LAYOUT_OPTIONS, cb: 'onChangeLayout' },
  theme: { header: 'Apply theme', options: THEME_OPTIONS, cb: 'onChangeTheme' },
};
const subMenuItems = (kind, callbacks) => {
  const { header, options, cb } = SUBMENU_CHOOSERS[kind];
  return [{ header }, ...options.map((o) => ({
    icon: o.icon || 'palette', label: o.label, onClick: () => callbacks?.[cb]?.(o.id),
  }))];
};

export default function SlideEditor(props) {
  const {
    deck,
    renderSlide,
    renderCanvasSlide, // canvas-only variant with inline text editing; falls back to renderSlide
    comments = [],
    layoutVariant = 'default',
    showCollabCursors = false,
    collaborators = [],
    tools = DEFAULT_TOOLS,
    slots = {},
    callbacks = {},
    canUndo = false,
    canRedo = false,
    theme = {},
  } = props;

  const flat = useMemo(() => flattenDeck(deck), [deck]);

  const [internalCurId, setInternalCurId] = useState(props.currentSlideId || (flat[3] && flat[3].id) || flat[0]?.id);
  const curId = props.currentSlideId || internalCurId;
  const setCurId = (id) => {
    if (props.onCurrentSlideChange) props.onCurrentSlideChange(id);
    if (!props.currentSlideId) setInternalCurId(id);
  };

  // Selected canvas element (owned by Editor, passed in). PropsPanel edits it by
  // handing back the full updated element, which we forward as a patch.
  const selectedElement = props.selectedElement || null;
  const onSelectElement = props.onSelectElement || (() => {});
  // Properties-panel edits hand back the full element; clamp to bounds (typed
  // values bypass the drag clamps) before forwarding as a patch.
  const updateSelEl = (el) => { if (el?.id) callbacks.onUpdateElement?.(el.id, clampElement(el)); };

  // Transient notifications (image-insert errors today; reusable surface).
  const { toasts, notify, dismiss } = useToasts();

  // Image insert: the toolbar's Image button opens this hidden picker; the
  // chosen file is embedded as a data URL and added as an `image` element.
  const imageInputRef = useRef(null);
  const onImageFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so re-picking the same file fires onChange again
    if (file) {
      readImageFile(file)
        .then((src) => insertElement('image', { src }))
        .catch((err) => {
          // Toast the friendly message for the user; keep the raw error in the
          // console for debugging (stack/name a plain message would drop).
          console.error('Could not read the image file', err);
          const msg = err?.message || (typeof err === 'string' ? err : 'Could not read the image file');
          notify(msg, { tone: 'error' });
        });
    }
  };

  // Inspector Data-tab edits commit to the CURRENT slide through the Co-pilot's
  // validated patch path. Undefined when the host wired no patch callback, so
  // DataPanel shows its "unavailable" hint instead of silently frozen inputs.
  // The editors emit gate-valid payloads, so a dropped field means the editor
  // and the schema gate have drifted — warn loudly.
  const applyPatchToCurrent = !callbacks.onApplyAIPatch ? undefined : (patch) => {
    const applied = callbacks.onApplyAIPatch(patch, cur?.id);
    if (applied) {
      const dropped = Object.keys(patch).filter((k) => !applied.includes(k));
      if (dropped.length) console.warn('Inspector patch fields not applied (schema-gate drift, or the slide was removed):', dropped);
    }
    return applied;
  };

  const [tool, setTool] = useState('select');
  const [inspectorTab, setInspectorTab] = useState('design');
  const [zoom, setZoom] = useState(62);
  const [showAI, setShowAI] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  // Open right-click menu: { x, y, kind: 'canvas' | 'element' | 'slide', fixed? }.
  const [ctxMenu, setCtxMenu] = useState(null);
  const [showPalette, setShowPalette] = useState(false);
  // Drill-in chooser for the context menu's "Change layout" / "Apply theme":
  // { x, y, kind } — the shared Menu closes on every item click, so we open a
  // second Menu at the same spot rather than nesting.
  const [subMenu, setSubMenu] = useState(null);
  // Dismiss the context menu (and its chooser) on any click outside a menu —
  // the toolbar, inspector, or empty canvas. A click on a `.ctx` item is the
  // item's own job (it commits, then closes), so leave those alone.
  useEffect(() => {
    if (!ctxMenu && !subMenu) return undefined;
    const close = (e) => { if (!e.target.closest('.ctx')) { setCtxMenu(null); setSubMenu(null); } };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [ctxMenu, subMenu]);

  // Insert an element and return to the Select tool. Every element-insert path
  // (a drawn shape, the Text Box / Image buttons) routes through here, so an
  // insert never leaves the canvas stuck in a shape draw mode (which hides the
  // selection frame + disables hit boxes — the inserted element couldn't be moved).
  const insertElement = (type, opts) => { callbacks.onAddElement?.(type, opts); setTool('select'); };
  // Paste and duplicate also create a fresh selection, so they exit draw mode
  // too — otherwise the new elements sit under a hidden frame + disabled hit
  // boxes.
  const pasteElements = () => { callbacks.onPasteElements?.(); setTool('select'); };
  const duplicateElements = () => { callbacks.onDuplicateElements?.(); setTool('select'); };

  const curIdx = flat.findIndex(f => f.id === curId);
  const cur = flat[Math.max(0, curIdx)];

  // Arrange ops act on a multi-selection: align + auto-arrange need 2+, distribute 3+.
  const selCount = props.selectedElementCount || 0;
  const canAlign = selCount >= 2;
  const canDistribute = selCount >= 3;
  const canArrange = selCount === 1; // z-order moves one element through the stack

  // The command context (lib/commands.js): what's selected, and the editor
  // actions commands invoke. An action is a function only when its callback is
  // wired, so commands for unwired actions never show or fire. Rebuilt each
  // render and read through a ref, so the key listener binds once.
  const cb = callbacks;
  const wired = (fn, action) => (fn ? action : undefined);
  const goToSlide = (delta) => {
    const next = flat[curIdx + delta];
    if (curIdx >= 0 && next) setCurId(next.id);
  };
  const cmdCtx = {
    scope: 'editor',
    sel: selCount,
    els: cur?.elements?.length || 0,
    act: {
      cut: cb.onCutElements,
      copy: cb.onCopyElements,
      paste: wired(cb.onPasteElements, pasteElements),
      duplicate: wired(cb.onDuplicateElements, duplicateElements),
      deleteSelection: cb.onDeleteElements,
      selectAll: wired(cb.onMarqueeSelect, () => cb.onMarqueeSelect((cur?.elements || []).map((e) => e.id))),
      front: wired(cb.onArrangeElement, () => cb.onArrangeElement('front')),
      back: wired(cb.onArrangeElement, () => cb.onArrangeElement('back')),
      group: cb.onGroupElements,
      ungroup: cb.onUngroupElements,
      // Shift = a larger nudge; both grid-aligned.
      nudge: wired(cb.onNudgeElements, (dx, dy, e) => { const step = e?.shiftKey ? GRID * 5 : GRID; cb.onNudgeElements(dx * step, dy * step); }),
      newSlide: cb.onNewSlide,
      duplicateSlide: cb.onDuplicateSlide,
      deleteSlide: wired(cb.onDeleteSlide, () => cb.onDeleteSlide(curId)),
      selectTool: () => setTool('select'),
      penTool: () => setTool('pen'),
      insertTextBox: () => insertElement('text'),
      insertImage: () => imageInputRef.current?.click(),
      copilot: () => setShowAI(true),
      palette: () => setShowPalette(true),
      prevSlide: () => goToSlide(-1),
      nextSlide: () => goToSlide(1),
    },
  };
  const cmdCtxRef = useRef(cmdCtx);
  cmdCtxRef.current = cmdCtx;

  // One key handler for every editor shortcut, dispatched through the registry
  // (ignored while typing in a field, and while the palette is open).
  useEffect(() => {
    if (showPalette) return undefined;
    const onKey = (e) => { if (!isTextEntryTarget(e.target)) dispatchKey(e, cmdCtxRef.current); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPalette]);

  // A thumbnail right-click makes that slide current and opens the slide menu
  // at the pointer (fixed-positioned: the thumbs pane is outside the canvas).
  // The latest handler sits in a ref behind a stable wrapper, so the memoized
  // thumbs never re-render for it.
  const thumbMenuRef = useRef(null);
  thumbMenuRef.current = (e, slideId) => {
    e.preventDefault();
    setCurId(slideId);
    setSubMenu(null);
    setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'slide', fixed: true });
  };
  const onThumbContextMenu = useCallback((e, slideId) => thumbMenuRef.current(e, slideId), []);

  const menuFor = (kind) => {
    if (kind === 'element') return menuItems(ELEMENT_MENU, cmdCtx);
    if (kind === 'slide') return menuItems([{ header: 'Slide' }, ...SLIDE_MENU], cmdCtx);
    return menuItems([
      { header: 'Canvas' }, 'edit.paste', 'edit.selectAll', 'copilot.open', '-',
      // Drill in: the shared Menu auto-closes on click, so reopen a chooser
      // submenu at the same spot (see subMenu state).
      { icon:'layers', label:'Change layout', onClick: () => setSubMenu({ x: ctxMenu.x, y: ctxMenu.y, kind: 'layout' }) },
      { icon:'palette', label:'Apply theme', onClick: () => setSubMenu({ x: ctxMenu.x, y: ctxMenu.y, kind: 'theme' }) },
      '-', ...SLIDE_MENU,
    ], cmdCtx);
  };

  const deckCtx = useMemo(() => ({
    deck,
    sectionName: cur?.sectionName,
    num: (curIdx < 0 ? 0 : curIdx) + 1,
    total: flat.length,
  }), [deck, cur, curIdx, flat.length]);

  return (
    <>
      {/* ---------------- Toolbar ---------------- */}
      <div className="toolbar">
        <div className="group">
          <IconButton name="undo" title="Undo" disabled={!canUndo} onClick={() => callbacks.onUndo && callbacks.onUndo()}/>
          <IconButton name="redo" title="Redo" disabled={!canRedo} onClick={() => callbacks.onRedo && callbacks.onRedo()}/>
        </div>
        <div className="group">
          {tools.map(t => (
            <IconButton
              key={t.id}
              name={t.icon}
              active={tool === t.id}
              onClick={() => setTool(t.id)}
              title={t.title}
            />
          ))}
          {/* Picking a shape only activates the draw tool (ShapeMenu sets `tool`);
              the element is created by drawing on the canvas, not on pick. */}
          <ShapeMenu tool={tool} setTool={setTool}/>
          <IconButton name="text" title="Text box" onClick={() => insertElement('text')}/>
          {/* Image is an insert action (like Text), not a tool toggle — it opens
              the file picker and adds the picked file as an element. */}
          <IconButton name="image" title={TIPS.image} onClick={() => imageInputRef.current?.click()}/>
          {PEN_TOOLS.map(t => (
            <IconButton
              key={t.id}
              name={t.icon}
              active={tool === t.id}
              onClick={() => setTool(t.id)}
              title={t.title}
            />
          ))}
          <ComponentMenu onPick={(id) => callbacks.onAddComponent && callbacks.onAddComponent(id)}/>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onImageFile}
          />
        </div>

        <div className="group">
          <TextMenu onPick={(style) => callbacks.onAddText && callbacks.onAddText(style)} />
          <TableSizePicker onPick={(rows, cols) => callbacks.onAddTable && callbacks.onAddTable(rows, cols)} />
          <ChartTypePicker onPick={(type) => callbacks.onAddChart && callbacks.onAddChart(type)} />
        </div>

        <div className="group">
          <LayoutMenu current={cur?.layout} onPick={(id) => callbacks.onChangeLayout && callbacks.onChangeLayout(id)} />
          <ThemeMenu current={deck.theme} onPick={(id) => callbacks.onChangeTheme && callbacks.onChangeTheme(id)} />
        </div>

        <div className="group">
          <IconButton name="align-left" title="Align left" disabled={!canAlign} onClick={() => callbacks.onAlignElements && callbacks.onAlignElements('left')}/>
          <IconButton name="align-center" title="Align center" disabled={!canAlign} onClick={() => callbacks.onAlignElements && callbacks.onAlignElements('hcenter')}/>
          <IconButton name="align-right" title="Align right" disabled={!canAlign} onClick={() => callbacks.onAlignElements && callbacks.onAlignElements('right')}/>
          <IconButton name="align-top" title="Align top" disabled={!canAlign} onClick={() => callbacks.onAlignElements && callbacks.onAlignElements('top')}/>
          <IconButton name="align-middle" title="Align middle" disabled={!canAlign} onClick={() => callbacks.onAlignElements && callbacks.onAlignElements('vmiddle')}/>
          <IconButton name="align-bottom" title="Align bottom" disabled={!canAlign} onClick={() => callbacks.onAlignElements && callbacks.onAlignElements('bottom')}/>
          <IconButton name="logic" title="Distribute" disabled={!canDistribute} onClick={() => callbacks.onDistributeElements && callbacks.onDistributeElements()}/>
          <IconButton name="chevron-up" title={TIPS.front} disabled={!canArrange} onClick={() => callbacks.onArrangeElement && callbacks.onArrangeElement('front')}/>
          <IconButton name="chevron-down" title={TIPS.back} disabled={!canArrange} onClick={() => callbacks.onArrangeElement && callbacks.onArrangeElement('back')}/>
        </div>

        <div className="group">
          <IconButton name="magic" title="Auto-arrange" disabled={!canAlign} onClick={() => callbacks.onAutoArrange && callbacks.onAutoArrange()}/>
          <IconButton name="timeline" active={showTimeline} onClick={()=>setShowTimeline(v=>!v)} title="Animation timeline"/>
          <IconButton name="history" title="Version history"/>
        </div>

        {slots.toolbarExtras}

        <div className="spacer" />

        <div className="group no-divider" style={{ border:0 }}>
          {callbacks.onComment && (
            <Button variant="ghost" icon="comment-dot" onClick={callbacks.onComment}>
              Comments
              {comments.length > 0 && (
                <span style={{ marginLeft:6, fontFamily:'var(--f-mono)', fontSize:10.5, padding:'0 5px', background:'var(--warn)', color:'white', borderRadius:8, fontWeight:600 }}>{comments.length}</span>
              )}
            </Button>
          )}
          <Button variant="ghost" icon="ai" onClick={()=>setShowAI(v=>!v)}>Co-pilot</Button>
          {callbacks.onExport && <Button variant="ghost" icon="download" onClick={callbacks.onExport}>Export</Button>}
          {callbacks.onPresent && <Button variant="accent" icon="play" onClick={callbacks.onPresent}>Present</Button>}
        </div>
      </div>

      {/* ---------------- Body ---------------- */}
      <div className={`body ${layoutVariant === 'floating' ? 'layout-floating' : layoutVariant === 'left-only' ? 'layout-left' : ''}`}>
        {layoutVariant !== 'floating' && (
          <ThumbsPane
            flat={flat}
            sections={deck.sections}
            curId={curId}
            onPick={setCurId}
            renderSlide={renderSlide}
            deckCtx={deckCtx}
            comments={comments}
            onNewSlide={callbacks.onNewSlide}
            newSlideTitle={TIPS.newSlide}
            onThumbContextMenu={onThumbContextMenu}
            onAddSection={callbacks.onAddSection}
            onRenameSection={callbacks.onRenameSection}
            onDeleteSection={callbacks.onDeleteSection}
            onReorder={callbacks.onReorderSlide}
          />
        )}

        <section className="canvas-area" onContextMenu={(e) => {
          // Position relative to the canvas, not e.target: offsetX/Y is measured
          // from whatever child (shape/text box) was right-clicked. (Outside-click
          // dismissal is handled by the document listener above.)
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          // On an element: select it (unless it's already part of the
          // selection, so a multi-selection survives) and offer element commands.
          const elId = e.target.closest?.('[data-el-id]')?.getAttribute('data-el-id');
          if (elId && !(props.selectedElementIds || []).includes(elId)) onSelectElement(elId);
          setSubMenu(null);
          setCtxMenu({ x: e.clientX - r.left, y: e.clientY - r.top, kind: elId ? 'element' : 'canvas' });
        }}>
          <Ruler/>
          <div className="canvas-inner">
            <div className="canvas-backdrop"/>
            {cur && (
              <CanvasSlide
                slide={cur}
                deckCtx={{ ...deckCtx, num: curIdx + 1 }}
                renderSlide={renderCanvasSlide || renderSlide}
                selectedIds={props.selectedElementIds}
                onSelectElement={onSelectElement}
                onUpdateElements={callbacks.onUpdateElements}
                onMarqueeSelect={callbacks.onMarqueeSelect}
                drawTool={DRAW_TOOL_IDS.has(tool) ? tool : null}
                onDrawElement={insertElement}
                zoom={zoom}
              />
            )}
            {showCollabCursors && <CollabLayer collaborators={collaborators}/>}
          </div>
          {callbacks.onFormatField && <FormatToolbar currentSlide={cur} onFormat={callbacks.onFormatField} />}
          <StatusBar zoom={zoom} setZoom={setZoom} selected={selectedElement}/>

          {showTimeline && <TimelineDrawer onClose={()=>setShowTimeline(false)} />}
          {showAI && (slots.aiDrawer || <DefaultAIDrawer onClose={()=>setShowAI(false)} slideNum={curIdx+1} slide={cur} onApplyPatch={callbacks.onApplyAIPatch} />)}
          {ctxMenu && (
            <Menu
              style={{ left: ctxMenu.x, top: ctxMenu.y, ...(ctxMenu.fixed && { position: 'fixed' }) }}
              onClose={()=>setCtxMenu(null)}
              items={menuFor(ctxMenu.kind)}
            />
          )}
          {subMenu && (
            <Menu
              style={{ left: subMenu.x, top: subMenu.y }}
              onClose={()=>setSubMenu(null)}
              items={subMenuItems(subMenu.kind, callbacks)}
            />
          )}
          {slots.belowCanvas}
        </section>

        {layoutVariant !== 'floating' && layoutVariant !== 'left-only' && (
          <InspectorPane
            tab={inspectorTab}
            setTab={setInspectorTab}
            selection={selectedElement}
            setSelection={updateSelEl}
            count={props.selectedElementCount}
            extras={slots.inspectorExtra}
            slide={cur}
            onApplyPatch={applyPatchToCurrent}
            deck={deck}
            onChangeTheme={callbacks.onChangeTheme}
            onChangeLayout={callbacks.onChangeLayout}
            onAddComponent={callbacks.onAddComponent}
            onChangeHeadingScale={callbacks.onChangeHeadingScale}
          />
        )}
        {layoutVariant === 'floating' && (
          <FloatingInspector
            tab={inspectorTab}
            setTab={setInspectorTab}
            selection={selectedElement}
            setSelection={updateSelEl}
            count={props.selectedElementCount}
            extras={slots.inspectorExtra}
            slide={cur}
            onApplyPatch={applyPatchToCurrent}
            deck={deck}
            onChangeTheme={callbacks.onChangeTheme}
            onChangeLayout={callbacks.onChangeLayout}
            onAddComponent={callbacks.onAddComponent}
            onChangeHeadingScale={callbacks.onChangeHeadingScale}
          />
        )}
      </div>
      {showPalette && (
        <CommandPalette
          getCommands={(q) => paletteCommands(cmdCtx, q)}
          onClose={() => setShowPalette(false)}
        />
      )}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
