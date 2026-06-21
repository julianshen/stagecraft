import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import ShapeMenu, { SHAPE_TOOLS } from './menus/ShapeMenu.jsx';
import TextMenu from './menus/TextMenu.jsx';
import TableSizePicker from './menus/TableSizePicker.jsx';
import ChartTypePicker from './menus/ChartTypePicker.jsx';
import LayoutMenu, { LAYOUT_OPTIONS } from './menus/LayoutMenu.jsx';
import ThemeMenu, { THEME_OPTIONS } from './menus/ThemeMenu.jsx';
import ComponentMenu from './menus/ComponentMenu.jsx';
import InspectorPane from './inspector/InspectorPane.jsx';
import FloatingInspector from './inspector/FloatingInspector.jsx';
import TimelineDrawer from './drawers/TimelineDrawer.jsx';
import DefaultAIDrawer from './drawers/DefaultAIDrawer.jsx';

const DEFAULT_TOOLS = [
  { id:'select', icon:'cursor',  title:'Select · V' },
];

const PEN_TOOLS = [
  { id:'pen',    icon:'pen',     title:'Pen · P' },
];

// Arrow key → unit nudge direction for the selection.
const NUDGE_DIR = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// Tool ids that draw an element on the canvas (the shape tools). When one is the
// active tool, a canvas sweep draws that shape rather than marquee-selecting.
const DRAW_TOOL_IDS = new Set(SHAPE_TOOLS.map((s) => s.id));

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

  // Delete/Backspace removes the selected element (unless typing in a field).
  // Callbacks go through a ref so the listener isn't re-bound every render (the
  // `callbacks` object is a fresh literal each parent render).
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  useEffect(() => {
    function onKey(e) {
      if (isTextEntryTarget(e.target)) return;
      const cb = callbacksRef.current;
      const cmd = e.metaKey || e.ctrlKey;
      const plain = cmd && !e.shiftKey && !e.altKey; // exact ⌘/Ctrl-<key>
      // Paste acts on the clipboard, so it needs no current selection.
      if (plain && (e.key === 'v' || e.key === 'V') && cb.onPasteElements) {
        e.preventDefault(); pasteElements(); return; // also exits draw mode (pasted elements are selected)
      }
      if (!props.selectedElementCount) return; // the rest act on the selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && cb.onDeleteElements) {
        e.preventDefault(); cb.onDeleteElements(); return;
      }
      if (plain && (e.key === 'd' || e.key === 'D') && cb.onDuplicateElements) {
        e.preventDefault(); duplicateElements(); return; // exits draw mode; don't swallow Ctrl+Shift+D etc.
      }
      if (plain && (e.key === 'c' || e.key === 'C') && cb.onCopyElements) {
        e.preventDefault(); cb.onCopyElements(); return;
      }
      if (plain && (e.key === 'x' || e.key === 'X') && cb.onCutElements) {
        e.preventDefault(); cb.onCutElements(); return;
      }
      // ⌘/Ctrl-G groups (needs 2+ to be meaningful); ⌘/Ctrl-Shift-G ungroups.
      if (plain && (e.key === 'g' || e.key === 'G') && props.selectedElementCount >= 2 && cb.onGroupElements) {
        e.preventDefault(); cb.onGroupElements(); return;
      }
      if (cmd && e.shiftKey && !e.altKey && (e.key === 'g' || e.key === 'G') && cb.onUngroupElements) {
        e.preventDefault(); cb.onUngroupElements(); return;
      }
      if (NUDGE_DIR[e.key] && !cmd && cb.onNudgeElements) {
        e.preventDefault();
        const [sx, sy] = NUDGE_DIR[e.key];
        const step = e.shiftKey ? GRID * 5 : GRID; // shift = larger nudge; both grid-aligned
        cb.onNudgeElements(sx * step, sy * step);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.selectedElementCount]);

  const [tool, setTool] = useState('select');
  const [inspectorTab, setInspectorTab] = useState('design');
  const [zoom, setZoom] = useState(62);
  const [showAI, setShowAI] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
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
  // boxes. Via the ref so the keyboard handler stays current without re-binding.
  const pasteElements = () => { callbacksRef.current.onPasteElements?.(); setTool('select'); };
  const duplicateElements = () => { callbacksRef.current.onDuplicateElements?.(); setTool('select'); };

  const curIdx = flat.findIndex(f => f.id === curId);
  const cur = flat[Math.max(0, curIdx)];

  // Arrange ops act on a multi-selection: align needs 2+, distribute 3+.
  const selCount = props.selectedElementCount || 0;
  const canAlign = selCount >= 2;
  const canDistribute = selCount >= 3;
  const canArrange = selCount === 1; // z-order moves one element through the stack

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
          <IconButton name="image" title="Image · I" onClick={() => imageInputRef.current?.click()}/>
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
          <IconButton name="chevron-up" title="Bring to front" disabled={!canArrange} onClick={() => callbacks.onArrangeElement && callbacks.onArrangeElement('front')}/>
          <IconButton name="chevron-down" title="Send to back" disabled={!canArrange} onClick={() => callbacks.onArrangeElement && callbacks.onArrangeElement('back')}/>
        </div>

        <div className="group">
          <IconButton name="magic" title="Auto-arrange"/>
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
            onReorder={callbacks.onReorderSlide}
          />
        )}

        <section className="canvas-area" onContextMenu={(e) => {
          // Position relative to the canvas, not e.target: offsetX/Y is measured
          // from whatever child (shape/text box) was right-clicked. (Outside-click
          // dismissal is handled by the document listener above.)
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setSubMenu(null);
          setCtxMenu({ x: e.clientX - r.left, y: e.clientY - r.top });
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
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onClose={()=>setCtxMenu(null)}
              items={[
                { header: 'Canvas' },
                { icon:'frame', label:'Paste', kbd:'⌘V', onClick: pasteElements },
                { icon:'magic', label:'Generate with AI', kbd:'⌘K', onClick: () => setShowAI(true) },
                '-',
                // Drill in: the shared Menu auto-closes on click, so reopen a
                // chooser submenu at the same spot (see subMenu state).
                { icon:'layers', label:'Change layout', onClick: () => setSubMenu({ x: ctxMenu.x, y: ctxMenu.y, kind: 'layout' }) },
                { icon:'palette', label:'Apply theme', onClick: () => setSubMenu({ x: ctxMenu.x, y: ctxMenu.y, kind: 'theme' }) },
                '-',
                { icon:'copy', label:'Duplicate slide', kbd:'⌘D', onClick: callbacks.onDuplicateSlide },
                { icon:'trash', label:'Delete slide', kbd:'⌫', onClick: () => callbacks.onDeleteSlide && callbacks.onDeleteSlide(curId) },
              ]}
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
            onAddComponent={callbacks.onAddComponent}
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
            onAddComponent={callbacks.onAddComponent}
          />
        )}
      </div>
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
