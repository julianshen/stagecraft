// Renders one slide from the sample deck in 1920×1080 coordinates.
// Caller should wrap in <ScaledSlide> if displaying inside a smaller container.

export function SlideChrome({ slide, deck }) {
  return (
    <>
      <div className="slide-chrome">
        <span>{deck.title.toUpperCase()}</span>
        <span>{slide.sectionName || ''}</span>
      </div>
      <div className="slide-foot">
        <span>{deck.author}</span>
        <span>{String(slide.num).padStart(2, '0')} / {String(slide.total).padStart(2, '0')}</span>
      </div>
    </>
  );
}

// ---- Chart SVG ----
export function LineChart() {
  const data = [112, 120, 131, 142, 149, 160, 170, 184];
  const plan = [110, 118, 128, 138, 147, 156, 166, 176];
  const labels = ['Q4 FY24','Q1','Q2','Q3','Q4','Q1 FY26','Q2','Q3'];
  const W = 1600, H = 560;
  const P = 60;
  const min = 100, max = 200;
  const x = i => P + (i * (W - P*2)) / (data.length - 1);
  const y = v => H - P - ((v - min) * (H - P*2)) / (max - min);
  const line = arr => arr.map((v,i)=>`${i===0?'M':'L'}${x(i)},${y(v)}`).join(' ');
  const area = 'M' + data.map((v,i)=>`${x(i)},${y(v)}`).join('L') + `L${x(data.length-1)},${H-P}L${x(0)},${H-P}Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }}>
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.62 0.17 265)" stopOpacity="0.22"/>
          <stop offset="1" stopColor="oklch(0.62 0.17 265)" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {[100,120,140,160,180,200].map(v => (
        <g key={v}>
          <line x1={P} x2={W-P} y1={y(v)} y2={y(v)} stroke="#e9e7e2" strokeWidth="1" />
          <text x={P-10} y={y(v)+5} fontSize="18" fontFamily="JetBrains Mono" fill="#888" textAnchor="end">{v}</text>
        </g>
      ))}
      {labels.map((l,i)=>(
        <text key={i} x={x(i)} y={H-P+28} fontSize="18" fontFamily="JetBrains Mono" fill="#888" textAnchor="middle">{l}</text>
      ))}
      <path d={area} fill="url(#g)" />
      <path d={line(plan)} fill="none" stroke="#999" strokeWidth="2" strokeDasharray="6 6" />
      <path d={line(data)} fill="none" stroke="oklch(0.62 0.17 265)" strokeWidth="3" />
      {data.map((v,i)=>(
        <circle key={i} cx={x(i)} cy={y(v)} r="5" fill="white" stroke="oklch(0.62 0.17 265)" strokeWidth="2.5" />
      ))}
      <g transform={`translate(${x(data.length-1)+12},${y(data[data.length-1])-16})`}>
        <rect x="0" y="-20" width="110" height="32" rx="4" fill="oklch(0.62 0.17 265)" />
        <text x="10" y="1" fill="white" fontSize="18" fontFamily="JetBrains Mono" fontWeight="600">$184.2M</text>
      </g>
      <g transform={`translate(${P},${P-22})`}>
        <circle cx="4" cy="0" r="4" fill="oklch(0.62 0.17 265)"/>
        <text x="14" y="5" fontSize="16" fontFamily="JetBrains Mono" fill="#333">Actual</text>
        <line x1="88" x2="110" y1="0" y2="0" stroke="#999" strokeWidth="2" strokeDasharray="4 4"/>
        <text x="118" y="5" fontSize="16" fontFamily="JetBrains Mono" fill="#333">Plan</text>
      </g>
    </svg>
  );
}

export function BarChart() {
  const data = [112, 131, 149, 170, 184];
  const labels = ['FY22','FY23','FY24','FY25','FY26'];
  const W = 1600, H = 560, P = 60;
  const max = 200;
  const bw = (W - P*2) / data.length;
  const y = v => H - P - (v / max) * (H - P*2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }}>
      {[0,50,100,150,200].map(v => (
        <g key={v}>
          <line x1={P} x2={W-P} y1={y(v)} y2={y(v)} stroke="#e9e7e2" strokeWidth="1"/>
          <text x={P-10} y={y(v)+5} fontSize="18" fontFamily="JetBrains Mono" fill="#888" textAnchor="end">{v}</text>
        </g>
      ))}
      {data.map((v,i)=>(
        <g key={i}>
          <rect x={P + i*bw + bw*0.18} y={y(v)} width={bw*0.64} height={H-P-y(v)} rx="6"
            fill={i===data.length-1 ? 'oklch(0.62 0.17 265)' : 'oklch(0.78 0.07 265)'}/>
          <text x={P + i*bw + bw*0.5} y={y(v)-16} fontSize="20" fontFamily="JetBrains Mono" fontWeight="600" fill="#222" textAnchor="middle">{v}</text>
          <text x={P + i*bw + bw*0.5} y={H-P+28} fontSize="18" fontFamily="JetBrains Mono" fill="#888" textAnchor="middle">{labels[i]}</text>
        </g>
      ))}
    </svg>
  );
}

export function AreaChart() {
  const data = [112, 120, 131, 142, 149, 160, 170, 184];
  const labels = ['Q4 FY24','Q1','Q2','Q3','Q4','Q1 FY26','Q2','Q3'];
  const W = 1600, H = 560, P = 60, min = 100, max = 200;
  const x = i => P + (i * (W - P*2)) / (data.length - 1);
  const y = v => H - P - ((v - min) * (H - P*2)) / (max - min);
  const line = data.map((v,i)=>`${i===0?'M':'L'}${x(i)},${y(v)}`).join(' ');
  const area = 'M' + data.map((v,i)=>`${x(i)},${y(v)}`).join('L') + `L${x(data.length-1)},${H-P}L${x(0)},${H-P}Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }}>
      <defs>
        <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.62 0.17 265)" stopOpacity="0.35"/>
          <stop offset="1" stopColor="oklch(0.62 0.17 265)" stopOpacity="0.02"/>
        </linearGradient>
      </defs>
      {[100,120,140,160,180,200].map(v => (
        <g key={v}>
          <line x1={P} x2={W-P} y1={y(v)} y2={y(v)} stroke="#e9e7e2" strokeWidth="1"/>
          <text x={P-10} y={y(v)+5} fontSize="18" fontFamily="JetBrains Mono" fill="#888" textAnchor="end">{v}</text>
        </g>
      ))}
      {labels.map((l,i)=>(
        <text key={i} x={x(i)} y={H-P+28} fontSize="18" fontFamily="JetBrains Mono" fill="#888" textAnchor="middle">{l}</text>
      ))}
      <path d={area} fill="url(#ga)"/>
      <path d={line} fill="none" stroke="oklch(0.62 0.17 265)" strokeWidth="3.5"/>
      {data.map((v,i)=>(<circle key={i} cx={x(i)} cy={y(v)} r="5" fill="white" stroke="oklch(0.62 0.17 265)" strokeWidth="2.5"/>))}
    </svg>
  );
}

export function DonutChart() {
  const slices = [
    { lbl:'Enterprise',    v:61, c:'oklch(0.62 0.17 265)' },
    { lbl:'Mid-market',    v:26, c:'oklch(0.62 0.13 155)' },
    { lbl:'SMB',           v:10, c:'oklch(0.7 0.15 75)' },
    { lbl:'Public sector', v:3,  c:'oklch(0.6 0.18 335)' },
  ];
  const total = slices.reduce((a,s)=>a+s.v,0);
  const cx=280, cy=280, r=200, rin=120;
  let acc = -90;
  function arc(start, end) {
    const s=(start*Math.PI)/180, e=(end*Math.PI)/180;
    const x1=cx+r*Math.cos(s), y1=cy+r*Math.sin(s);
    const x2=cx+r*Math.cos(e), y2=cy+r*Math.sin(e);
    const xi2=cx+rin*Math.cos(e), yi2=cy+rin*Math.sin(e);
    const xi1=cx+rin*Math.cos(s), yi1=cy+rin*Math.sin(s);
    const big = end-start>180?1:0;
    return `M${x1},${y1} A${r},${r} 0 ${big} 1 ${x2},${y2} L${xi2},${yi2} A${rin},${rin} 0 ${big} 0 ${xi1},${yi1} Z`;
  }
  return (
    <svg viewBox="0 0 1200 560" width="100%" style={{ display:'block' }}>
      <g>
        {slices.map((sl,i)=>{
          const ang = (sl.v/total)*360;
          const d = arc(acc, acc+ang);
          acc += ang;
          return <path key={i} d={d} fill={sl.c}/>;
        })}
        <text x={cx} y={cy-6} fontSize="44" fontFamily="JetBrains Mono" fontWeight="600" fill="#222" textAnchor="middle">$184M</text>
        <text x={cx} y={cy+34} fontSize="20" fontFamily="JetBrains Mono" fill="#888" textAnchor="middle">Net ARR</text>
      </g>
      <g transform="translate(640, 130)">
        {slices.map((sl,i)=>(
          <g key={i} transform={`translate(0, ${i*72})`}>
            <rect x="0" y="0" width="26" height="26" rx="5" fill={sl.c}/>
            <text x="40" y="20" fontSize="26" fontFamily="Inter" fontWeight="600" fill="#222">{sl.lbl}</text>
            <text x="440" y="20" fontSize="26" fontFamily="JetBrains Mono" fill="#888" textAnchor="end">{sl.v}%</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function ChartByType({ type }) {
  if (type === 'bar') return <BarChart/>;
  if (type === 'area') return <AreaChart/>;
  if (type === 'donut' || type === 'pie') return <DonutChart/>;
  return <LineChart/>;
}

export function RoadmapGraphic() {
  const lanes = [
    { name: 'Platform',   items: [ { t: 0, d: 2, lbl: 'Workflow GA',   state: 'done' },    { t: 3, d: 3, lbl: 'Audit v2',     state: 'done' }, { t: 7, d: 4, lbl: 'Data residency', state: 'inflight' } ] },
    { name: 'Growth',     items: [ { t: 1, d: 3, lbl: 'Self-serve EU', state: 'done' },    { t: 5, d: 3, lbl: 'SMB re-price',  state: 'inflight' }, { t: 9, d: 2, lbl: 'PLG loops', state: 'planned' } ] },
    { name: 'AI',         items: [ { t: 2, d: 4, lbl: 'Copilot α',     state: 'inflight' }, { t: 7, d: 5, lbl: 'Auto-workflow', state: 'planned' } ] },
    { name: 'Enterprise', items: [ { t: 0, d: 6, lbl: 'SAML→OIDC',     state: 'done' },     { t: 6, d: 3, lbl: 'Gov cloud',     state: 'atrisk' }, { t: 9, d: 2, lbl: 'SOC2 II', state: 'planned' } ] },
  ];
  const W = 1600, H = 540, laneH = 110, left = 180;
  const monthW = (W - left - 40) / 12;
  const stateColor = s => ({ done: 'oklch(0.62 0.13 155)', inflight: 'oklch(0.62 0.17 265)', planned: '#ddd', atrisk: 'oklch(0.65 0.18 25)' }[s]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }}>
      {['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'].map((m,i)=>(
        <g key={m}>
          <line x1={left+i*monthW} x2={left+i*monthW} y1="40" y2={40+lanes.length*laneH} stroke="#eee" strokeWidth="1"/>
          <text x={left+i*monthW+8} y="32" fontSize="16" fontFamily="JetBrains Mono" fill="#888">{m}</text>
        </g>
      ))}
      <line x1={left+3.5*monthW} x2={left+3.5*monthW} y1="40" y2={40+lanes.length*laneH} stroke="oklch(0.6 0.2 25)" strokeWidth="2" strokeDasharray="4 4"/>
      <text x={left+3.5*monthW+8} y="58" fontSize="16" fontFamily="JetBrains Mono" fill="oklch(0.6 0.2 25)" fontWeight="600">TODAY</text>
      {lanes.map((lane, li) => (
        <g key={lane.name} transform={`translate(0, ${40 + li*laneH})`}>
          <text x="30" y={laneH/2+6} fontSize="20" fontFamily="Inter" fontWeight="600" fill="#222">{lane.name}</text>
          <line x1={left} x2={W-40} y1={laneH-1} y2={laneH-1} stroke="#eee"/>
          {lane.items.map((it, i) => (
            <g key={i}>
              <rect
                x={left + it.t*monthW} y={laneH/2 - 18}
                width={it.d*monthW - 8} height="36"
                rx="6"
                fill={stateColor(it.state)}
                opacity={it.state === 'planned' ? 0.5 : 1}
              />
              <text x={left + it.t*monthW + 12} y={laneH/2 + 6} fontSize="16"
                    fontFamily="Inter" fontWeight="500" fill={it.state === 'planned' ? '#555' : 'white'}>
                {it.lbl}
              </text>
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

export function Slide({ slide, deck, sectionName, num, total }) {
  const s = { ...slide, sectionName, num, total };
  switch (slide.layout) {
    case 'cover':
      return (
        <div className={`slide ${slide.bg || ''}`}>
          <div style={{ position:'absolute', top:60, left:80, right:80, display:'flex', justifyContent:'space-between', fontFamily:'var(--f-mono)', fontSize:18, opacity:0.5 }}>
            <span>{(deck?.title || 'DECK').toUpperCase()}</span>
            <span>{slide.kicker || 'CONFIDENTIAL'}</span>
          </div>
          <div style={{ position:'absolute', left:80, bottom:160 }}>
            {slide.eyebrow && <div style={{ fontFamily:'var(--f-mono)', fontSize:20, letterSpacing:'0.2em', opacity:0.6, marginBottom:28 }}>{slide.eyebrow}</div>}
            <h1 style={{ fontSize:140, fontWeight:600, lineHeight:0.95, letterSpacing:'-0.04em', margin:0, maxWidth:1500 }}>
              {slide.title || deck?.title || 'Untitled'}
            </h1>
          </div>
          <div style={{ position:'absolute', left:80, bottom:80, display:'flex', gap:40, fontFamily:'var(--f-mono)', fontSize:18, opacity:0.55 }}>
            <span>{slide.subtitle || deck?.subtitle || deck?.author || ''}</span>
          </div>
          <div style={{ position:'absolute', right:100, top:'50%', transform:'translateY(-50%)', width:340, height:340, border:'2px solid rgba(255,255,255,0.15)', borderRadius:'50%' }}/>
          <div style={{ position:'absolute', right:180, top:'50%', transform:'translateY(-50%)', width:180, height:180, background:'oklch(0.62 0.17 265)', borderRadius:'50%', opacity:0.9 }}/>
          <div style={{ position:'absolute', right:240, top:'50%', transform:'translate(0, -20%)', width:80, height:80, background:'oklch(0.72 0.14 75)', borderRadius:'50%' }}/>
        </div>
      );
    case 'agenda':
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:200, left:80, right:80 }}>
            <div className="slide-eyebrow">{slide.eyebrow || 'Agenda · 4 parts'}</div>
            <h1 style={{ fontSize:96, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 80px', lineHeight:1 }}>What we'll cover</h1>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'40px 80px', maxWidth:1700 }}>
              {(slide.items || []).map(it => (
                <div key={it.n} style={{ display:'grid', gridTemplateColumns:'80px 1fr', gap:20, paddingBottom:24, borderBottom:'1px solid #eee' }}>
                  <div style={{ fontFamily:'var(--f-mono)', fontSize:36, color:'oklch(0.62 0.17 265)', fontWeight:500 }}>{it.n}</div>
                  <div>
                    <div style={{ fontSize:38, fontWeight:600, letterSpacing:'-0.01em', marginBottom:8 }}>{it.t}</div>
                    <div style={{ fontSize:22, color:'#666', lineHeight:1.3 }}>{it.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    case 'divider':
      return (
        <div className={`slide ${slide.bg || 'ink'}`}>
          <div style={{ position:'absolute', top:60, left:80, right:80, display:'flex', justifyContent:'space-between', fontFamily:'var(--f-mono)', fontSize:18, opacity:0.5 }}>
            <span>CHAPTER {slide.chapter}</span>
            <span>ATLAS · QBR · Q3 FY26</span>
          </div>
          <div style={{ position:'absolute', left:80, top:'50%', transform:'translateY(-50%)' }}>
            <div style={{ fontFamily:'var(--f-mono)', fontSize:240, fontWeight:400, opacity:0.15, letterSpacing:'-0.04em', lineHeight:0.8 }}>{slide.chapter}</div>
            <div style={{ fontSize:140, fontWeight:600, letterSpacing:'-0.04em', marginTop:-60 }}>{slide.title}</div>
          </div>
          <div style={{ position:'absolute', right:80, bottom:80, fontFamily:'var(--f-mono)', fontSize:16, opacity:0.5, textAlign:'right' }}>
            <div>{String(num).padStart(2,'0')} / {String(total).padStart(2,'0')}</div>
          </div>
        </div>
      );
    case 'kpi': {
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:140, left:80, right:80 }}>
            <div className="slide-eyebrow">{slide.eyebrow || 'Scorecard'}</div>
            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:60 }}>
              <h1 style={{ fontSize:72, fontWeight:600, letterSpacing:'-0.03em', margin:0 }}>{slide.title}</h1>
              <div style={{ fontFamily:'var(--f-mono)', fontSize:20, color:'#888' }}>{slide.note}</div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'24px', maxWidth:1760 }}>
              {(slide.kpis || []).map((k,i)=>(
                <div key={i} style={{ padding:'28px 32px', border:'1px solid #e8e5df', borderRadius:10, background:'white', position:'relative' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
                    <div style={{ fontFamily:'var(--f-mono)', fontSize:16, letterSpacing:'0.08em', textTransform:'uppercase', color:'#888' }}>{k.label}</div>
                    <div style={{
                      fontFamily:'var(--f-mono)', fontSize:14, padding:'2px 8px', borderRadius:4,
                      background: k.good === true ? 'oklch(0.95 0.04 155)' : k.good === false ? 'oklch(0.95 0.04 25)' : '#f0ede8',
                      color: k.good === true ? 'oklch(0.45 0.14 155)' : k.good === false ? 'oklch(0.5 0.18 25)' : '#666'
                    }}>{k.delta}</div>
                  </div>
                  <div style={{ fontSize:68, fontWeight:600, letterSpacing:'-0.03em', lineHeight:1, marginBottom:14 }}>{k.val}</div>
                  <div style={{ fontFamily:'var(--f-mono)', fontSize:16, color:'#888' }}>{k.target}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
    case 'chart': {
      const chartType = slide.chartType || 'line';
      const typeLabel = { line:'Line', bar:'Bar', area:'Area', donut:'Donut', pie:'Donut' }[chartType] || 'Chart';
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:140, left:80, right:80 }}>
            <div className="slide-eyebrow">{slide.eyebrow || 'Scorecard'}</div>
            <h1 style={{ fontSize:72, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 8px' }}>{slide.title}</h1>
            <div style={{ fontFamily:'var(--f-mono)', fontSize:22, color:'#888', marginBottom:40 }}>{slide.sub || `${typeLabel} chart`}</div>
            <div style={{ background:'white', border:'1px solid #eee', borderRadius:10, padding:30 }}>
              <ChartByType type={chartType}/>
            </div>
          </div>
        </div>
      );
    }
    case 'split':
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:160, left:80, right:80, display:'grid', gridTemplateColumns:'1fr 1fr', gap:80 }}>
            <div>
              <div className="slide-eyebrow">{slide.eyebrow || 'Scorecard'}</div>
              <h1 style={{ fontSize:72, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 40px', lineHeight:1 }}>{slide.title}</h1>
              <p style={{ fontSize:28, lineHeight:1.5, color:'#333', maxWidth:760 }}>{slide.body}</p>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
              {(slide.stats || []).map((st,i)=>(
                <div key={i} style={{ padding:'36px 40px', background:'oklch(0.97 0.01 85)', borderRadius:10, display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
                  <div style={{ fontFamily:'var(--f-mono)', fontSize:20, color:'#555', letterSpacing:'0.05em', textTransform:'uppercase' }}>{st.lbl}</div>
                  <div style={{ fontSize:72, fontWeight:600, letterSpacing:'-0.03em', color: st.val.startsWith('-') ? 'oklch(0.55 0.18 25)' : 'oklch(0.45 0.14 155)' }}>{st.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    case 'table': {
      const cols = slide.columns || [];
      const rows = slide.rows || [];
      const ncol = cols.length || 1;
      const gridCols = ncol === 6 ? '1.4fr 1fr 0.7fr 0.6fr 0.7fr 0.8fr' : `repeat(${ncol}, 1fr)`;
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:140, left:80, right:80 }}>
            <div className="slide-eyebrow">{slide.eyebrow || 'Segments'}</div>
            <h1 style={{ fontSize:72, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 50px' }}>{slide.title}</h1>
            <div style={{ border:'1px solid #eee', borderRadius:12, overflow:'hidden', background:'white' }}>
              <div style={{ display:'grid', gridTemplateColumns:gridCols, padding:'22px 30px', background:'oklch(0.97 0.01 85)', fontFamily:'var(--f-mono)', fontSize:18, color:'#666', letterSpacing:'0.05em', textTransform:'uppercase', borderBottom:'1px solid #eee' }}>
                {cols.map((c,ci) => <div key={ci}>{c}</div>)}
              </div>
              {rows.map((r,i)=>(
                <div key={i} style={{ display:'grid', gridTemplateColumns:gridCols, padding:'28px 30px', fontSize:26, borderBottom: i < rows.length - 1 ? '1px solid #eee' : 'none', alignItems:'center' }}>
                  {r.map((cell, ci) => (
                    <div key={ci} style={{
                      fontWeight: ci === 0 ? 600 : 400,
                      fontFamily: ci === 0 ? 'var(--f-sans)' : 'var(--f-mono)',
                      color: (ci > 0 && String(cell).startsWith('-')) ? 'oklch(0.55 0.18 25)' : (ci > 0 && String(cell).startsWith('+')) ? 'oklch(0.45 0.14 155)' : 'inherit'
                    }}>
                      {ci === ncol - 1 && ncol === 6
                        ? <span style={{ fontSize:18, padding:'4px 12px', borderRadius:4, background:'oklch(0.95 0.02 85)', fontFamily:'var(--f-mono)', color:'#555' }}>{cell}</span>
                        : cell}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
    case 'text':
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:200, left:80, right:80, maxWidth:1500 }}>
            <div className="slide-eyebrow">{sectionName}</div>
            <h1 style={{ fontSize:84, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 50px', lineHeight:1 }}>{slide.title}</h1>
            <p style={{ fontSize:32, lineHeight:1.5, color:'#333' }}>{slide.body}</p>
          </div>
        </div>
      );
    case 'roadmap':
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:140, left:80, right:80 }}>
            <div className="slide-eyebrow">{slide.eyebrow || 'Product'}</div>
            <h1 style={{ fontSize:72, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 50px' }}>{slide.title}</h1>
            <RoadmapGraphic/>
            <div style={{ display:'flex', gap:28, marginTop:24, fontFamily:'var(--f-mono)', fontSize:18 }}>
              <span style={{ display:'flex', alignItems:'center', gap:10 }}><span style={{ width:14, height:14, background:'oklch(0.62 0.13 155)', borderRadius:2 }}/>Shipped</span>
              <span style={{ display:'flex', alignItems:'center', gap:10 }}><span style={{ width:14, height:14, background:'oklch(0.62 0.17 265)', borderRadius:2 }}/>In-flight</span>
              <span style={{ display:'flex', alignItems:'center', gap:10 }}><span style={{ width:14, height:14, background:'oklch(0.65 0.18 25)', borderRadius:2 }}/>At risk</span>
              <span style={{ display:'flex', alignItems:'center', gap:10 }}><span style={{ width:14, height:14, background:'#ddd', borderRadius:2 }}/>Planned</span>
            </div>
          </div>
        </div>
      );
    case 'risks':
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:160, left:80, right:80 }}>
            <div className="slide-eyebrow">{slide.eyebrow || 'Outlook'}</div>
            <h1 style={{ fontSize:72, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 60px' }}>{slide.title}</h1>
            <div style={{ display:'flex', flexDirection:'column', gap:28 }}>
              {(slide.items || []).map((it,i)=>{
                const sevC = { high:'oklch(0.55 0.2 25)', med:'oklch(0.65 0.15 75)', low:'oklch(0.55 0.1 260)' }[it.sev];
                return (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'160px 1fr', gap:40, padding:'32px 36px', border:'1px solid #eee', borderLeft:`6px solid ${sevC}`, borderRadius:6, background:'white' }}>
                    <div style={{ fontFamily:'var(--f-mono)', fontSize:18, letterSpacing:'0.08em', textTransform:'uppercase', color:sevC, fontWeight:600, paddingTop:6 }}>{it.sev} risk</div>
                    <div>
                      <div style={{ fontSize:36, fontWeight:600, marginBottom:10 }}>{it.t}</div>
                      <div style={{ fontSize:24, color:'#555' }}>{it.d}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    case 'list':
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:160, left:80, right:80 }}>
            <div className="slide-eyebrow">{slide.eyebrow || 'Outlook'}</div>
            <h1 style={{ fontSize:84, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 70px' }}>{slide.title}</h1>
            <div style={{ display:'flex', flexDirection:'column', gap:28, maxWidth:1500 }}>
              {(slide.items || []).map((it,i)=>(
                <div key={i} style={{ display:'grid', gridTemplateColumns:'100px 1fr', gap:28, alignItems:'baseline', borderBottom:'1px solid #eee', paddingBottom:28 }}>
                  <div style={{ fontFamily:'var(--f-mono)', fontSize:28, color:'oklch(0.62 0.17 265)', fontWeight:500 }}>{String(i+1).padStart(2,'0')}</div>
                  <div style={{ fontSize:38, fontWeight:500, letterSpacing:'-0.01em' }}>{it}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    case 'thanks':
      return (
        <div className="slide ink">
          <div style={{ position:'absolute', left:80, top:'50%', transform:'translateY(-50%)' }}>
            <div style={{ fontFamily:'var(--f-mono)', fontSize:20, letterSpacing:'0.2em', opacity:0.5, marginBottom:40 }}>END OF REVIEW</div>
            <h1 style={{ fontSize:220, fontWeight:600, letterSpacing:'-0.05em', margin:0, lineHeight:0.9 }}>Thanks.</h1>
            <div style={{ fontSize:32, opacity:0.7, marginTop:40 }}>{slide.subtitle}</div>
          </div>
          <div style={{ position:'absolute', right:100, top:100, width:320, height:320, border:'2px solid rgba(255,255,255,0.1)', borderRadius:'50%' }}/>
          <div style={{ position:'absolute', right:200, top:200, width:120, height:120, background:'oklch(0.62 0.17 265)', borderRadius:'50%' }}/>
        </div>
      );
    default:
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:'50%', left:80, right:80, transform:'translateY(-50%)' }}>
            <h1 style={{ fontSize:96, fontWeight:600 }}>{slide.title || 'Untitled'}</h1>
          </div>
        </div>
      );
  }
}

// Convenience: look up section name for a slide
export function sectionOf(deck, slideId) {
  const s = deck.sections.find(sec => sec.slides.includes(slideId));
  return s ? s.name : '';
}
