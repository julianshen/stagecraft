import React, { useState, useEffect, useRef, useMemo } from 'react';
import Icon from '../ui/Icon.jsx';
import { Button, IconButton, FieldRow, InputGroup, Seg, ScaledSlide, Menu } from '../ui/Primitives.jsx';
import { callLLM } from '../../lib/llmClient.js';
import { flattenDeck } from '../../lib/deckOrder.js';
import Ruler from './Ruler.jsx';
import StatusBar from './StatusBar.jsx';
import CollabLayer from './CollabLayer.jsx';
import ThumbsPane from './ThumbsPane.jsx';
import CanvasSlide from './CanvasSlide.jsx';
import ShapeMenu from './menus/ShapeMenu.jsx';
import TextMenu from './menus/TextMenu.jsx';
import TableSizePicker from './menus/TableSizePicker.jsx';
import ChartTypePicker from './menus/ChartTypePicker.jsx';
import LayoutMenu from './menus/LayoutMenu.jsx';
import ThemeMenu from './menus/ThemeMenu.jsx';
import ComponentMenu from './menus/ComponentMenu.jsx';
import InspectorPane from './inspector/InspectorPane.jsx';
import FloatingInspector from './inspector/FloatingInspector.jsx';

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

  const [internalSel, setInternalSel] = useState(props.selection || { x: 80, y: 380, w: 820, h: 210, label: 'Title · H1' });
  const selection = props.selection || internalSel;
  const setSelection = (s) => {
    if (props.onSelectionChange) props.onSelectionChange(s);
    if (!props.selection) setInternalSel(s);
  };

  const [tool, setTool] = useState('select');
  const [inspectorTab, setInspectorTab] = useState('design');
  const [zoom, setZoom] = useState(62);
  const [showAI, setShowAI] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);

  const curIdx = flat.findIndex(f => f.id === curId);
  const cur = flat[Math.max(0, curIdx)];

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
          <ShapeMenu tool={tool} setTool={setTool}/>
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
          <IconButton name="align-left"/>
          <IconButton name="align-center"/>
          <IconButton name="align-right"/>
          <IconButton name="logic" title="Distribute"/>
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
                selected={selection}
                setSelected={setSelection}
                zoom={zoom}
              />
            )}
            {showCollabCursors && <CollabLayer collaborators={collaborators}/>}
          </div>
          <StatusBar zoom={zoom} setZoom={setZoom} selected={selection}/>

          {showTimeline && <TimelineDrawer onClose={()=>setShowTimeline(false)} />}
          {showAI && (slots.aiDrawer || <DefaultAIDrawer onClose={()=>setShowAI(false)} slideNum={curIdx+1} slide={cur} />)}
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
            selection={selection}
            setSelection={setSelection}
            extras={slots.inspectorExtra}
          />
        )}
        {layoutVariant === 'floating' && (
          <FloatingInspector
            tab={inspectorTab}
            setTab={setInspectorTab}
            selection={selection}
            setSelection={setSelection}
            extras={slots.inspectorExtra}
          />
        )}
      </div>
    </>
  );
}

function TimelineDrawer({ onClose }) {
  return (
    <div className="timeline">
      <div className="timeline-head">
        <Icon name="play" size={12}/>
        <span style={{ fontFamily:'var(--f-mono)', fontSize:11 }}>0:00.480 / 0:02.400</span>
        <IconButton name="skip-back"/><IconButton name="play"/><IconButton name="skip-forward"/>
        <span style={{ flex:1 }}/>
        <button className="select"><Icon name="sparkle" size={12}/>Ease: expo.out</button>
        <IconButton name="x" onClick={onClose}/>
      </div>
      <div className="timeline-tracks">
        <div className="playhead" style={{ left: '28%' }}/>
        {[{n:'Title',k:'bar',a:5,b:35},{n:'KPI cards (6)',k:'stagger',a:10,b:55},{n:'Footnote',k:'kf',a:40},{n:'Chart bars',k:'bar',a:55,b:80}].map((t,i)=>(
          <div className="track" key={i}>
            <div className="label"><Icon name={i<2?'text':'shape'} size={11}/>{t.n}</div>
            <div className="lane">
              {t.k === 'bar' && <div className="kf-bar" style={{ left:`${t.a}%`, width:`${t.b-t.a}%` }}/>}
              {t.k === 'stagger' && Array.from({length:6}).map((_,j)=>(<div key={j} className="kf-bar" style={{ left:`${t.a + j*7}%`, width:'6%', height:5, top:13 }}/>))}
              {t.k === 'kf' && <div className="keyframe" style={{ left:`${t.a}%` }}/>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DefaultAIDrawer({ onClose, slideNum, slide }) {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const suggestions = [
    { icon:'magic',    t:'Rewrite as 3 columns' },
    { icon:'chart-bar',t:'Plot against plan' },
    { icon:'layers',   t:'Apply Executive theme' },
    { icon:'sparkle',  t:'Generate speaker notes' },
  ];

  async function handleSend(text) {
    const input = text || prompt;
    if (!input.trim()) return;
    setLoading(true);
    setResponse('');
    try {
      const ctx = slide ? `Current slide layout: ${slide.layout}, title: ${slide.title || ''}` : '';
      const result = await callLLM([
        { role: 'user', content: `${ctx}\n\n${input}` }
      ]);
      setResponse(result);
    } catch (err) {
      setResponse(`Error: ${err.message}`);
    }
    setLoading(false);
  }

  return (
    <div className="ai-drawer">
      <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--line)', display:'flex', alignItems:'center', gap:8 }}>
        <Icon name="ai" size={14} style={{ color:'var(--accent)' }}/>
        <span style={{ fontWeight:600, fontSize:13 }}>Co-pilot</span>
        <span style={{ fontFamily:'var(--f-mono)', fontSize:10.5, color:'var(--ink-4)', marginLeft:'auto' }}>slide {String(slideNum).padStart(2,'0')}</span>
        <IconButton name="x" onClick={onClose}/>
      </div>
      <div style={{ flex:1, padding:14, overflowY:'auto', display:'flex', flexDirection:'column', gap:12 }}>
        {!response && suggestions.map((s,i)=>(
          <div key={i} style={{ display:'grid', gridTemplateColumns:'28px 1fr', gap:10, padding:'10px 12px', border:'1px solid var(--line)', borderRadius:6, cursor:'pointer' }}
               onClick={() => handleSend(s.t)}>
            <div style={{ width:28, height:28, borderRadius:6, background:'var(--accent-wash)', color:'var(--accent)', display:'grid', placeItems:'center' }}>
              <Icon name={s.icon} size={13}/>
            </div>
            <div style={{ fontWeight:550, fontSize:12.5, alignSelf:'center' }}>{s.t}</div>
          </div>
        ))}
        {loading && (
          <div style={{ padding:12, color:'var(--ink-3)', fontSize:12, display:'flex', alignItems:'center', gap:8 }}>
            <Icon name="refresh" size={12} style={{ animation:'spin .65s linear infinite' }}/>
            Thinking…
          </div>
        )}
        {response && (
          <div style={{ padding:12, background:'var(--bg-2)', borderRadius:6, border:'1px solid var(--line)', fontSize:12.5, lineHeight:1.5, color:'var(--ink)', whiteSpace:'pre-wrap' }}>
            {response}
          </div>
        )}
      </div>
      <div style={{ padding:10, borderTop:'1px solid var(--line)' }}>
        <div className="input-group" style={{ height:36 }}>
          <span className="ico"><Icon name="ai" size={12}/></span>
          <input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Ask Co-pilot or describe an edit…"
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSend(); }}
          />
          <button
            style={{ padding:'0 8px', background:'var(--accent)', color:'white', borderRadius:3, fontSize:11, height:24 }}
            onClick={() => handleSend()}
            disabled={loading}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
