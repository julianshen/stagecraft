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

// ---- inspector pieces ----
function InspectorPane({ tab, setTab, selection, setSelection, extras }) {
  return (
    <aside className="rightpane">
      <div className="inspector-tabs">
        {['design','props','anim'].map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={()=>setTab(t)}>
            {t === 'design' ? 'Design' : t === 'props' ? 'Properties' : 'Animate'}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {tab === 'design' && <DesignPanel/>}
        {tab === 'props' && <PropsPanel selected={selection} setSelected={setSelection}/>}
        {tab === 'anim' && <AnimPanel/>}
        {extras}
      </div>
    </aside>
  );
}

function FloatingInspector({ tab, setTab, selection, setSelection, extras }) {
  return (
    <div style={{ position:'fixed', right:16, top:120, width:300, background:'var(--panel)', border:'1px solid var(--line)', borderRadius:10, boxShadow:'var(--shadow-2)', zIndex:40, display:'flex', flexDirection:'column', maxHeight:'calc(100vh - 200px)' }}>
      <div className="inspector-tabs">
        {['design','props','anim'].map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={()=>setTab(t)}>
            {t === 'design' ? 'Design' : t === 'props' ? 'Props' : 'Anim'}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {tab === 'design' && <DesignPanel/>}
        {tab === 'props' && <PropsPanel selected={selection} setSelected={setSelection}/>}
        {tab === 'anim' && <AnimPanel/>}
        {extras}
      </div>
    </div>
  );
}

function DesignPanel() {
  return (
    <>
      <div className="pane-section">
        <h4>Layout</h4>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:6 }}>
          {['frame','columns','rows','template','layers','list','outline','grid'].map((l,i) => (
            <button key={l} title={l} style={{ aspectRatio:'4/3', background:i===0?'var(--accent-wash)':'var(--bg)', border:'1px solid var(--line)', borderRadius:4, color: i===0 ? 'var(--accent)' : 'var(--ink-3)', display:'grid', placeItems:'center', cursor:'pointer' }}>
              <Icon name={l} size={14}/>
            </button>
          ))}
        </div>
      </div>
      <div className="pane-section">
        <h4>Theme</h4>
        <div className="swatch-grid">
          {['oklch(0.22 0.01 85)','white','oklch(0.95 0.01 85)','oklch(0.62 0.17 265)','oklch(0.62 0.13 155)','oklch(0.7 0.15 75)','oklch(0.6 0.2 25)','oklch(0.6 0.18 335)'].map((c,i) => (
            <div key={i} className={`swatch ${i===3?'active':''}`} style={{ background:c }}/>
          ))}
        </div>
      </div>
      <div className="pane-section">
        <h4>Tokens</h4>
        <div className="tokens-row"><div className="swatch-s" style={{ background:'oklch(0.22 0.01 85)' }}/><div className="name">ink</div><div className="val">#15171c</div></div>
        <div className="tokens-row"><div className="swatch-s" style={{ background:'oklch(0.62 0.17 265)' }}/><div className="name">accent</div><div className="val">oklch(.62/.17/265)</div></div>
        <div className="tokens-row"><div className="swatch-s" style={{ background:'var(--ink)', color:'white', display:'grid', placeItems:'center', fontSize:11, fontWeight:600 }}>Aa</div><div className="name">H1 / Inter 600</div><div className="val">96 / -3%</div></div>
      </div>
      <div className="pane-section">
        <h4>Components</h4>
        <div className="lib-rail">
          {['KPI','Chart','Bar','Quote','Roadmap','Table','Risks','Agenda'].map(n => (
            <div className="lib-chip" key={n}>
              <div className="lib-chip-inner"><span style={{ fontFamily:'var(--f-mono)', fontSize:11, color:'var(--ink-3)' }}>{n[0]}</span></div>
              <div className="lib-chip-name">{n}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function PropsPanel({ selected, setSelected }) {
  if (!selected) return <div className="pane-section" style={{ color:'var(--ink-4)', fontSize:12 }}>Select an element.</div>;
  return (
    <>
      <div className="pane-section">
        <h4>{selected.label}</h4>
        <FieldRow label="POS">
          <div className="double-input">
            <InputGroup icoLeft="X" value={selected.x} onChange={v => setSelected({...selected, x:+v||0})} unit="px"/>
            <InputGroup icoLeft="Y" value={selected.y} onChange={v => setSelected({...selected, y:+v||0})} unit="px"/>
          </div>
        </FieldRow>
        <FieldRow label="SIZE">
          <div className="double-input">
            <InputGroup icoLeft="W" value={selected.w} onChange={v => setSelected({...selected, w:+v||0})} unit="px"/>
            <InputGroup icoLeft="H" value={selected.h} onChange={v => setSelected({...selected, h:+v||0})} unit="px"/>
          </div>
        </FieldRow>
        <FieldRow label="ANGLE"><InputGroup icoLeft="°" value="0" unit="deg"/></FieldRow>
        <FieldRow label="OPACITY"><InputGroup value="100" unit="%"/></FieldRow>
      </div>
      <div className="pane-section">
        <h4>Type</h4>
        <FieldRow label="FAMILY"><div className="input-group"><input value="Inter" readOnly/><Icon name="chevron-down" size={11}/></div></FieldRow>
        <FieldRow label="STYLE"><div className="double-input"><div className="input-group"><input value="Semibold" readOnly/></div><InputGroup value="96" unit="px"/></div></FieldRow>
        <FieldRow label="ALIGN"><Seg value="left" onChange={()=>{}} options={[{v:'left',ico:'align-left'},{v:'center',ico:'align-center'},{v:'right',ico:'align-right'}]}/></FieldRow>
        <FieldRow label="STYLE"><div className="seg"><button className="active"><Icon name="bold" size={12}/></button><button><Icon name="italic" size={12}/></button><button><Icon name="underline" size={12}/></button></div></FieldRow>
      </div>
      <div className="pane-section">
        <h4>Fill</h4>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0' }}>
          <div style={{ width:24, height:24, borderRadius:4, background:'var(--ink)', border:'1px solid var(--line)' }}/>
          <div style={{ fontFamily:'var(--f-mono)', fontSize:12 }}>#15171C</div>
          <span style={{ marginLeft:'auto', fontFamily:'var(--f-mono)', fontSize:11, color:'var(--ink-4)' }}>100%</span>
        </div>
      </div>
    </>
  );
}

function AnimPanel() {
  return (
    <>
      <div className="pane-section">
        <h4>Transition</h4>
        <FieldRow label="TYPE"><div className="input-group"><input value="Morph" readOnly/><Icon name="chevron-down" size={11}/></div></FieldRow>
        <FieldRow label="DUR"><InputGroup value="480" unit="ms"/></FieldRow>
      </div>
      <div className="pane-section">
        <h4>Builds</h4>
        {[{t:'Fade in',o:'click 1'},{t:'Rise 8px',o:'click 1, +100ms'},{t:'Stagger',o:'3 children'}].map((it,i)=>(
          <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', background:'var(--bg)', border:'1px solid var(--line)', borderRadius:4, fontSize:12, marginBottom:6 }}>
            <Icon name="dot" size={12} style={{ color:'var(--accent)' }}/>
            <span style={{ flex:1 }}>{it.t}</span>
            <span style={{ fontFamily:'var(--f-mono)', fontSize:10.5, color:'var(--ink-4)' }}>{it.o}</span>
          </div>
        ))}
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
