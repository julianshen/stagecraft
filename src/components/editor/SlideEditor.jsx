import React, { useState, useMemo, useEffect, useRef } from 'react';
import Icon from '../ui/Icon.jsx';
import { Button, IconButton, Menu } from '../ui/Primitives.jsx';
import { flattenDeck } from '../../lib/deckOrder.js';
import Ruler from './Ruler.jsx';
import StatusBar from './StatusBar.jsx';
import CollabLayer from './CollabLayer.jsx';
import ThumbsPane from './ThumbsPane.jsx';
import CanvasSlide from './CanvasSlide.jsx';
import { clampElement } from '../../lib/elements.js';
import ShapeMenu from './menus/ShapeMenu.jsx';
import TextMenu from './menus/TextMenu.jsx';
import TableSizePicker from './menus/TableSizePicker.jsx';
import ChartTypePicker from './menus/ChartTypePicker.jsx';
import LayoutMenu from './menus/LayoutMenu.jsx';
import ThemeMenu from './menus/ThemeMenu.jsx';
import ComponentMenu from './menus/ComponentMenu.jsx';
import InspectorPane from './inspector/InspectorPane.jsx';
import FloatingInspector from './inspector/FloatingInspector.jsx';
import TimelineDrawer from './drawers/TimelineDrawer.jsx';
import DefaultAIDrawer from './drawers/DefaultAIDrawer.jsx';

const DEFAULT_TOOLS = [
  { id:'select', icon:'cursor',  title:'Select · V' },
];

const PEN_IMAGE_TOOLS = [
  { id:'pen',    icon:'pen',     title:'Pen · P' },
  { id:'image',  icon:'image',   title:'Image · I' },
];


export default function SlideEditor(props) {
  const {
    deck,
    renderSlide,
    comments = [],
    layoutVariant = 'default',
    showCollabCursors = false,
    collaborators = [],
    tools = DEFAULT_TOOLS,
    slots = {},
    callbacks = {},
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

  // Inspector Data-tab edits commit to the CURRENT slide through the Co-pilot's
  // validated patch path. The editors are built to emit gate-valid payloads, so
  // a rejection means the editor and the schema gate have drifted — warn loudly
  // instead of leaving the user with a silently frozen input.
  const applyPatchToCurrent = (patch) => {
    const applied = callbacks.onApplyAIPatch?.(patch, cur?.id);
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
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!props.selectedElementCount || !callbacksRef.current.onDeleteElements) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      callbacksRef.current.onDeleteElements();
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

  const curIdx = flat.findIndex(f => f.id === curId);
  const cur = flat[Math.max(0, curIdx)];

  // Arrange ops act on a multi-selection: align needs 2+, distribute 3+.
  const selCount = props.selectedElementCount || 0;
  const canAlign = selCount >= 2;
  const canDistribute = selCount >= 3;

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
          {tools.map(t => (
            <IconButton
              key={t.id}
              name={t.icon}
              active={tool === t.id}
              onClick={() => setTool(t.id)}
              title={t.title}
            />
          ))}
          <ShapeMenu tool={tool} setTool={setTool} onPick={(id) => callbacks.onAddElement && callbacks.onAddElement(id)}/>
          <IconButton name="text" title="Text box" onClick={() => callbacks.onAddElement && callbacks.onAddElement('text')}/>
          {PEN_IMAGE_TOOLS.map(t => (
            <IconButton
              key={t.id}
              name={t.icon}
              active={tool === t.id}
              onClick={() => setTool(t.id)}
              title={t.title}
            />
          ))}
          <ComponentMenu onPick={(id) => callbacks.onAddComponent && callbacks.onAddComponent(id)}/>
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

        <section className="canvas-area" onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }); }} onClick={()=>setCtxMenu(null)}>
          <Ruler/>
          <div className="canvas-inner">
            <div className="canvas-backdrop"/>
            {cur && (
              <CanvasSlide
                slide={cur}
                deckCtx={{ ...deckCtx, num: curIdx + 1 }}
                renderSlide={renderSlide}
                selectedIds={props.selectedElementIds}
                onSelectElement={onSelectElement}
                onUpdateElements={callbacks.onUpdateElements}
                onMarqueeSelect={callbacks.onMarqueeSelect}
                zoom={zoom}
              />
            )}
            {showCollabCursors && <CollabLayer collaborators={collaborators}/>}
          </div>
          <StatusBar zoom={zoom} setZoom={setZoom} selected={selectedElement}/>

          {showTimeline && <TimelineDrawer onClose={()=>setShowTimeline(false)} />}
          {showAI && (slots.aiDrawer || <DefaultAIDrawer onClose={()=>setShowAI(false)} slideNum={curIdx+1} slide={cur} onApplyPatch={callbacks.onApplyAIPatch} />)}
          {ctxMenu && (
            <Menu
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onClose={()=>setCtxMenu(null)}
              items={[
                { header: 'Canvas' },
                { icon:'frame', label:'Paste slide', kbd:'⌘V' },
                { icon:'magic', label:'Generate with AI', kbd:'⌘K' },
                '-',
                { icon:'layers', label:'Change layout' },
                { icon:'palette', label:'Apply theme' },
                '-',
                { icon:'copy', label:'Duplicate slide', kbd:'⌘D', onClick: callbacks.onDuplicateSlide },
                { icon:'trash', label:'Delete slide', kbd:'⌫', onClick: () => callbacks.onDeleteSlide && callbacks.onDeleteSlide(curId) },
              ]}
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
          />
        )}
      </div>
    </>
  );
}
