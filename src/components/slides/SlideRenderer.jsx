// Renders one slide from the sample deck in 1920×1080 coordinates.
// Caller should wrap in <ScaledSlide> if displaying inside a smaller container.
import { useId } from 'react';
import { chartData, renameCategory, renameSeries, CHART_SERIES_OKLCH } from '../../lib/chartSpec.js';
import { roadmapModel, renameLane, renameMonth, relabelMilestone, ROADMAP_STATES, ROADMAP_LABELS, ROADMAP_OKLCH } from '../../lib/roadmapSpec.js';
import { SEVERITY_OKLCH } from '../../lib/riskSpec.js';
import EditableText from '../ui/EditableText.jsx';
import { fmtKey, fmtStyle, isFormattablePath } from '../../lib/slideFmt.js';
import { CANVAS_BASELINE_PX } from '../../lib/fontBaselines.js';
import { shapeDef, hasVisibleStroke, clipPoints } from '../../lib/shapes.js';
import { dropShadowCss, isRenderableShadow, linearGradientCss, isRenderableGradient, isFinitePoint, dashArray, borderStyle, lineSpacingOf } from '../../lib/elements.js';

// The deck fields the slide render tree reads (chrome + cover/divider
// fallbacks). This is the memo contract for thumbnail re-rendering
// (ThumbsPane) — a new deck-level read must be added here or thumbs go stale.
// Frozen: it's shared across every thumb comparison; no consumer may mutate it.
export const DECK_CHROME_FIELDS = Object.freeze(['title', 'author', 'subtitle']);

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

// ---- Chart SVG (data-driven; shared C_FALLBACK + chartCeil helpers below) ----
// Series colours — shared with the PPTX export (CHART_SERIES_HEX) via chartSpec
// so a series is the same colour on screen and in the export. C_ACCENT (series 0)
// stays the single-series accent.
const C_SLICES = CHART_SERIES_OKLCH;
const C_ACCENT = CHART_SERIES_OKLCH[0];
// Shared default (same as the PPTX export) for a chart called without data, so
// the canvas and the export never disagree. ChartByType always passes real data.
const C_FALLBACK = chartData();
const FB_CATS = C_FALLBACK.categories;
const FB_VALS = C_FALLBACK.series[0].values;
// Round a max up to a "nice" axis ceiling (1/2/5 × 10^k); zero-based ticks.
function chartCeil(v) {
  if (!(v > 0)) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  let step = 10;
  if (n <= 1) step = 1;
  else if (n <= 2) step = 2;
  else if (n <= 5) step = 5;
  return step * mag;
}
const chartTicks = (top) => [0, 1, 2, 3, 4].map((i) => Math.round((top * i) / 4));
const colorAt = (i) => C_SLICES[i % C_SLICES.length];
// One chart coordinate system, shared by the grid, the legend, and the plotted
// data, so they can't drift (a viewBox/margin change lands in exactly one place).
const CW = 1600, CH = 560, CP = 60;
// Coerce a non-finite value to 0 so a stray NaN/undefined never reaches an SVG
// coordinate (every line/bar/dot/gridline y flows through yScale).
const yScale = (top) => (v) => CH - CP - ((Number.isFinite(v) ? v : 0) / top) * (CH - CP * 2);
const xScale = (n) => (i) => CP + (i * (CW - CP * 2)) / Math.max(1, n - 1);
// Shared axis ceiling across every series, so multiple series share one scale.
// Filter to finite values so a non-numeric entry can't turn the max (and the
// whole scale) into NaN.
const seriesTop = (ser) => chartCeil(Math.max(0, ...ser.flatMap((s) => s.values).filter(Number.isFinite)));
// Coerce the incoming series prop to a non-empty array (falling back to the
// shared default), so each renderer can treat one and many series uniformly.
const toSeries = (series) => (series && series.length ? series : [{ name: 'Series 1', values: FB_VALS }]);

// Horizontal swatch legend, drawn in the chart's top margin for >1 series.
// Spacing shrinks as series grow so it doesn't run past the 1600-wide viewBox.
function ChartLegend({ series, y = 26, editable = false, onRenameSeries }) {
  const gap = Math.min(280, (CW - 120) / series.length);
  return (
    <g>
      {series.map((s, i) => (
        <g key={i} transform={`translate(${CP + i * gap}, ${y})`}>
          <rect data-legend="" x="0" y="-16" width="22" height="22" rx="4" fill={colorAt(i)} />
          <EdLabel editable={editable} value={s.name} tx={30} ty={2}
            box={{ x: 30, y: -16, w: Math.max(40, gap - 44), h: 24 }} font={LEGEND_FONT} fill="#222"
            onCommit={(v) => onRenameSeries?.(i, v)} />
        </g>
      ))}
    </g>
  );
}

// Shared zero-based y-axis: gridlines + tick labels, identical for line/bar/area.
function ChartGrid({ top }) {
  const y = yScale(top);
  return (
    <>
      {chartTicks(top).map(v => (
        <g key={v}>
          <line x1={CP} x2={CW - CP} y1={y(v)} y2={y(v)} stroke="#e9e7e2" strokeWidth="1" />
          <text x={CP - 10} y={y(v) + 5} fontSize="18" fontFamily="JetBrains Mono" fill="#888" textAnchor="end">{v}</text>
        </g>
      ))}
    </>
  );
}

export function LineChart({ categories, series, editable = false, onRenameCat, onRenameSeries } = {}) {
  const gid = 'lg' + useId().replace(/:/g, ''); // unique per instance — multiple charts share a DOM (thumbs + canvas)
  const ser = toSeries(series);
  const labels = categories && categories.length ? categories : FB_CATS;
  const W = CW, H = CH, P = CP;
  const multi = ser.length > 1;
  const top = seriesTop(ser);
  const x = xScale(labels.length);
  const catW = labels.length > 1 ? x(1) - x(0) : 2 * P; // category slot; a single label gets a compact box so it can't centre off-screen
  const y = yScale(top);
  const toPath = arr => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
  // Area fill + value badge are single-series-only decorations; skip the work when multi.
  const first = ser[0].values;
  const area = multi || !first.length ? null : 'M' + first.map((v, i) => `${x(i)},${y(v)}`).join('L') + `L${x(first.length - 1)},${H - P}L${x(0)},${H - P}Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C_ACCENT} stopOpacity="0.22"/>
          <stop offset="1" stopColor={C_ACCENT} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <ChartGrid top={top} />
      {labels.map((l, i) => (
        <CategoryLabel key={i} cx={x(i)} w={catW} value={l} i={i} editable={editable} onRenameCat={onRenameCat} />
      ))}
      {!multi && <path d={area} fill={`url(#${gid})`} />}
      {ser.map((s, si) => (
        <g key={si}>
          <path d={toPath(s.values)} fill="none" stroke={colorAt(si)} strokeWidth="3" />
          {s.values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r="5" fill="white" stroke={colorAt(si)} strokeWidth="2.5" />
          ))}
        </g>
      ))}
      {!multi && first.length > 0 && (
        <g transform={`translate(${Math.max(P, x(first.length - 1) - 96)},${Math.max(P + 22, y(first[first.length - 1]) - 30)})`}>
          <rect x="0" y="-20" width="92" height="32" rx="4" fill={C_ACCENT} />
          <text x="46" y="1" fill="white" fontSize="18" fontFamily="JetBrains Mono" fontWeight="600" textAnchor="middle">{first[first.length - 1]}</text>
        </g>
      )}
      {multi && <ChartLegend series={ser} editable={editable} onRenameSeries={onRenameSeries} />}
    </svg>
  );
}

export function BarChart({ categories, series, editable = false, onRenameCat, onRenameSeries } = {}) {
  const ser = toSeries(series);
  const labels = categories && categories.length ? categories : FB_CATS;
  const W = CW, H = CH, P = CP;
  const multi = ser.length > 1;
  const top = seriesTop(ser);
  const slot = (W - P * 2) / labels.length;
  const y = yScale(top);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <ChartGrid top={top} />
      {!multi
        ? ser[0].values.map((v, i) => (
            <g key={i}>
              <rect data-bar="" x={P + i * slot + slot * 0.18} y={y(v)} width={slot * 0.64} height={Math.max(0, H - P - y(v))} rx="6"
                fill={i === ser[0].values.length - 1 ? C_ACCENT : 'oklch(0.78 0.07 265)'}/>
              <text x={P + i * slot + slot * 0.5} y={y(v) - 16} fontSize="20" fontFamily="JetBrains Mono" fontWeight="600" fill="#222" textAnchor="middle">{v}</text>
              <CategoryLabel cx={P + i * slot + slot * 0.5} w={slot} value={labels[i] ?? ''} i={i} editable={editable} onRenameCat={onRenameCat} />
            </g>
          ))
        : labels.map((l, i) => {
            const gx = P + i * slot, bw = (slot * 0.7) / ser.length;
            return (
              <g key={i}>
                {ser.map((s, si) => (
                  <rect data-bar="" key={si} x={gx + slot * 0.15 + si * bw} y={y(s.values[i])} width={bw * 0.9} height={Math.max(0, H - P - y(s.values[i]))} rx="4" fill={colorAt(si)}/>
                ))}
                <CategoryLabel cx={gx + slot * 0.5} w={slot} value={l} i={i} editable={editable} onRenameCat={onRenameCat} />
              </g>
            );
          })}
      {multi && <ChartLegend series={ser} editable={editable} onRenameSeries={onRenameSeries} />}
    </svg>
  );
}

export function AreaChart({ categories, series, editable = false, onRenameCat, onRenameSeries } = {}) {
  const gid = 'ag' + useId().replace(/:/g, ''); // unique per instance (see LineChart)
  const ser = toSeries(series);
  const labels = categories && categories.length ? categories : FB_CATS;
  const W = CW, H = CH, P = CP;
  const multi = ser.length > 1;
  const top = seriesTop(ser);
  const x = xScale(labels.length);
  const catW = labels.length > 1 ? x(1) - x(0) : 2 * P; // category slot; a single label gets a compact box so it can't centre off-screen
  const y = yScale(top);
  const line = arr => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
  const area = arr => 'M' + arr.map((v, i) => `${x(i)},${y(v)}`).join('L') + `L${x(arr.length - 1)},${H - P}L${x(0)},${H - P}Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C_ACCENT} stopOpacity="0.35"/>
          <stop offset="1" stopColor={C_ACCENT} stopOpacity="0.02"/>
        </linearGradient>
      </defs>
      <ChartGrid top={top} />
      {labels.map((l, i) => (
        <CategoryLabel key={i} cx={x(i)} w={catW} value={l} i={i} editable={editable} onRenameCat={onRenameCat} />
      ))}
      {ser.map((s, si) => (
        // Single series keeps the accent gradient fill + dots; multiple series
        // overlay translucent fills per colour (no dots, to stay readable).
        <g key={si}>
          <path d={area(s.values)} fill={multi ? colorAt(si) : `url(#${gid})`} fillOpacity={multi ? 0.18 : 1}/>
          <path d={line(s.values)} fill="none" stroke={multi ? colorAt(si) : C_ACCENT} strokeWidth={multi ? 3 : 3.5}/>
          {!multi && s.values.map((v, i) => (<circle key={i} cx={x(i)} cy={y(v)} r="5" fill="white" stroke={C_ACCENT} strokeWidth="2.5"/>))}
        </g>
      ))}
      {multi && <ChartLegend series={ser} editable={editable} onRenameSeries={onRenameSeries} />}
    </svg>
  );
}

export function DonutChart({ categories, values, editable = false, onRenameCat } = {}) {
  const vals = values && values.length ? values : FB_VALS;
  const labels = categories && categories.length ? categories : FB_CATS;
  const sum = vals.reduce((a, b) => a + b, 0);
  const total = sum || 1; // avoid /0 in arc/percentage math; the label shows the real sum
  const cx = 280, cy = 280, r = 200, rin = 120;
  let acc = -90;
  function arc(start, end) {
    const s = (start * Math.PI) / 180, e = (end * Math.PI) / 180;
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
    const xi2 = cx + rin * Math.cos(e), yi2 = cy + rin * Math.sin(e);
    const xi1 = cx + rin * Math.cos(s), yi1 = cy + rin * Math.sin(s);
    const big = end - start > 180 ? 1 : 0;
    return `M${x1},${y1} A${r},${r} 0 ${big} 1 ${x2},${y2} L${xi2},${yi2} A${rin},${rin} 0 ${big} 0 ${xi1},${yi1} Z`;
  }
  return (
    <svg viewBox="0 0 1200 560" width="100%" style={{ display: 'block' }}>
      <g>
        {vals.map((v, i) => {
          const ang = (v / total) * 360;
          // A full 360° arc has identical start/end and renders nothing — clamp it.
          const d = arc(acc, acc + Math.min(ang, 359.99));
          acc += ang;
          return <path key={i} d={d} fill={C_SLICES[i % C_SLICES.length]}/>;
        })}
        <text x={cx} y={cy - 6} fontSize="44" fontFamily="JetBrains Mono" fontWeight="600" fill="#222" textAnchor="middle">{sum}</text>
        <text x={cx} y={cy + 34} fontSize="20" fontFamily="JetBrains Mono" fill="#888" textAnchor="middle">Total</text>
      </g>
      <g transform="translate(640, 130)">
        {vals.map((v, i) => (
          // Spacing shrinks as slices grow so the legend doesn't overflow the SVG.
          <g key={i} transform={`translate(0, ${i * Math.min(72, 420 / vals.length)})`}>
            <rect x="0" y="0" width="26" height="26" rx="5" fill={C_SLICES[i % C_SLICES.length]}/>
            <EdLabel editable={editable} value={labels[i] || `Series ${i + 1}`} tx={40} ty={20}
              box={{ x: 40, y: 0, w: 380, h: 30 }} font={DONUT_FONT} fill="#222" onCommit={(v) => onRenameCat?.(i, v)} />
            <text x="440" y="20" fontSize="26" fontFamily="JetBrains Mono" fill="#888" textAnchor="end">{Math.round((v / total) * 100)}%</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

// Dispatch by chart type, always feeding each chart the slide's data through the
// shared chartData helper — the same source the PPTX export uses — so a data-less
// chart shows the identical default on canvas and in the export.
export function ChartByType({ type, slide, editable = false, onCommitPatch }) {
  const d = chartData(slide);
  // On the canvas, an x-axis category label commits the full materialized {chart}
  // model (renameCategory) so a data-less chart keeps its default series.
  const onRenameCat = editable ? (i, v) => onCommitPatch?.(renameCategory(slide, i, v)) : undefined;
  const onRenameSeries = editable ? (i, v) => onCommitPatch?.(renameSeries(slide, i, v)) : undefined;
  const cat = { categories: d.categories, editable, onRenameCat, onRenameSeries };
  // line/bar/area render every series; a donut composes a single series over its categories.
  if (type === 'bar') return <BarChart {...cat} series={d.series}/>;
  if (type === 'area') return <AreaChart {...cat} series={d.series}/>;
  // donut's legend labels ARE the categories → renameCategory (no multi-series legend).
  if (type === 'donut' || type === 'pie') return <DonutChart categories={d.categories} values={d.series[0]?.values} editable={editable} onRenameCat={onRenameCat}/>;
  return <LineChart {...cat} series={d.series}/>;
}

// Roadmap label typography — each shared by the read-only SVG <text> and the
// editable <foreignObject> HTML so labels can't shift when entering/leaving edit
// mode. `fill` is passed separately (SVG uses the `fill` attr, CSS uses `color`).
const boldInter = (fontSize) => Object.freeze({ fontSize, fontFamily: 'Inter', fontWeight: 600 });
const LANE_NAME_FONT = boldInter(20);
const LEGEND_FONT = boldInter(20);  // multi-series legend names (line/bar/area)
const DONUT_FONT = boldInter(26);   // donut slice legend labels
const MONTH_FONT = Object.freeze({ fontSize: 16, fontFamily: 'JetBrains Mono' });
const MILESTONE_FONT = Object.freeze({ fontSize: 16, fontFamily: 'Inter', fontWeight: 500 });

// An SVG roadmap label: plain <text> read-only, an inline-editable HTML field
// (foreignObject + EditableText) on the canvas. `box` is the edit-mode rectangle
// (kept non-negative + capped by the caller); read-only/edit share font + fill.
function EdLabel({ editable, value, tx, ty, box, font, fill, align, onCommit }) {
  const mid = align === 'middle';
  if (!editable) {
    return <text x={tx} y={ty} textAnchor={mid ? 'middle' : undefined} fontSize={font.fontSize} fontFamily={font.fontFamily} fontWeight={font.fontWeight} fill={fill}>{value}</text>;
  }
  return (
    <foreignObject x={box.x} y={box.y} width={box.w} height={box.h}>
      <EditableText
        editable as="div" value={value}
        style={{ ...font, color: fill, margin: 0, padding: 0, lineHeight: `${box.h}px`, whiteSpace: 'nowrap', textAlign: mid ? 'center' : undefined, outline: 'none', cursor: 'text' }}
        onCommit={onCommit}
      />
    </foreignObject>
  );
}

// Category-axis label typography (line/bar/area), and the centred edit box for one.
const CAT_FONT = Object.freeze({ fontSize: 18, fontFamily: 'JetBrains Mono' });
const catBox = (cx, w) => ({ x: cx - w / 2, y: CH - CP + 12, w, h: 24 });

// A chart x-axis category label — an EdLabel fixed to the category typography,
// bottom-axis baseline, and centred edit box; varies only by centre-x + slot width.
function CategoryLabel({ cx, w, value, i, editable, onRenameCat }) {
  return (
    <EdLabel editable={editable} value={value} tx={cx} ty={CH - CP + 28} align="middle"
      box={catBox(cx, w)} font={CAT_FONT} fill="#888" onCommit={(v) => onRenameCat?.(i, v)} />
  );
}

export function RoadmapGraphic({ slide, editable = false, onCommitPatch } = {}) {
  const { months, lanes, todayIndex } = roadmapModel(slide);
  // laneH shrinks below its 110 default once there are enough lanes to overflow
  // the fixed 540 viewBox, so a custom roadmap with many lanes isn't clipped
  // (≤4 lanes keep the original 110 → the demo is unchanged).
  const W = 1600, H = 540, left = 180;
  const laneH = lanes.length ? Math.min(110, (H - 80) / lanes.length) : 0;
  // Bar height scales with laneH (like the PPTX path) so dense roadmaps don't
  // overlap rows; ≤4 lanes keep the original 36 → the demo is unchanged.
  const barHt = Math.min(36, laneH * 0.5);
  // The editable lane-name box is capped to the lane height (so a dense roadmap's
  // short lanes don't get an oversized field at a negative y) and centred in it.
  const nameBoxH = Math.min(30, laneH);
  const mileBoxH = Math.min(24, laneH); // milestone edit box, capped + centred like the lane name
  const monthW = (W - left - 40) / months.length;
  const stateColor = s => ROADMAP_OKLCH[s] || ROADMAP_OKLCH.planned;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }}>
      {months.map((m,i)=>(
        <g key={`${m}-${i}`}>
          <line x1={left+i*monthW} x2={left+i*monthW} y1="40" y2={40+lanes.length*laneH} stroke="#eee" strokeWidth="1"/>
          <EdLabel editable={editable} value={m} tx={left+i*monthW+8} ty={32}
            box={{ x: left+i*monthW, y: 14, w: monthW, h: 20 }} font={MONTH_FONT} fill="#888"
            onCommit={(v) => onCommitPatch?.(renameMonth(slide, i, v))} />
        </g>
      ))}
      {todayIndex != null && (
        <g>
          <line x1={left+todayIndex*monthW} x2={left+todayIndex*monthW} y1="40" y2={40+lanes.length*laneH} stroke="oklch(0.6 0.2 25)" strokeWidth="2" strokeDasharray="4 4"/>
          <text x={left+todayIndex*monthW+8} y="58" fontSize="16" fontFamily="JetBrains Mono" fill="oklch(0.6 0.2 25)" fontWeight="600">TODAY</text>
        </g>
      )}
      {lanes.map((lane, li) => (
        <g key={li} transform={`translate(0, ${40 + li*laneH})`}>
          <EdLabel editable={editable} value={lane.name} tx={30} ty={laneH/2+6}
            box={{ x: 30, y: (laneH - nameBoxH) / 2, w: left - 50, h: nameBoxH }} font={LANE_NAME_FONT} fill="#222"
            onCommit={(v) => onCommitPatch?.(renameLane(slide, li, v))} />
          <line x1={left} x2={W-40} y1={laneH-1} y2={laneH-1} stroke="#eee"/>
          {lane.items.map((it, i) => (
            <g key={i}>
              <rect
                x={left + it.t*monthW} y={laneH/2 - barHt/2}
                width={Math.max(2, it.d*monthW - 8)} height={barHt}
                rx="6"
                fill={stateColor(it.state)}
                opacity={it.state === 'planned' ? 0.5 : 1}
              />
              <EdLabel editable={editable} value={it.lbl} tx={left + it.t*monthW + 12} ty={laneH/2 + 6}
                box={{ x: left + it.t*monthW + 4, y: (laneH - mileBoxH) / 2, w: Math.max(40, it.d*monthW - 8), h: mileBoxH }}
                font={MILESTONE_FONT} fill={it.state === 'planned' ? '#555' : 'white'}
                onCommit={(v) => onCommitPatch?.(relabelMilestone(slide, li, i, v))} />
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

// Free-form element overlay (the canvas-editing layer), rendered on top of the
// layout template in the same 1920×1080 coordinate space.

// A non-scaling SVG stroke over a 0..1 box — an open `polyline` (pen path) or a
// closed `polygon` (clip-shape outline). The width stays slide-px at any box size
// (matching the export line). Callers resolve their own colour/width/points + the
// container `style` (the pen sits on `base`; a clip outline overlays a fill div).
function StrokeSvg({ points, closed = false, style, stroke, strokeWidth, strokeDash }) {
  // Filter to finite point pairs here (callers can pass raw points); a stroke
  // needs at least two to draw anything.
  const valid = (Array.isArray(points) ? points : []).filter(isFinitePoint);
  if (valid.length < 2) return null;
  const Tag = closed ? 'polygon' : 'polyline';
  return (
    <svg style={{ ...style, overflow: 'visible' }} viewBox="0 0 1 1" preserveAspectRatio="none">
      <Tag points={valid.map(([px, py]) => `${px},${py}`).join(' ')} fill="none" stroke={stroke} strokeWidth={strokeWidth}
        strokeDasharray={dashArray(strokeDash, strokeWidth) || undefined}
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ElementView({ el }) {
  const base = {
    position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h,
    ...(el.rot ? { transform: `rotate(${el.rot}deg)` } : {}),
    ...(el.opacity != null ? { opacity: Math.max(0, Math.min(100, el.opacity)) / 100 } : {}),
    // A drop shadow applies to any element type and follows the painted shape
    // (clip-path included), so it lives on the shared base style. A malformed
    // shadow (gate-bypassing write) is skipped on the same predicate the export
    // uses, so neither surface renders one toHex would silently recolour.
    ...(isRenderableShadow(el.shadow) ? { filter: dropShadowCss(el.shadow) } : {}),
  };
  if (el.type === 'text') {
    const align = el.align || 'left';
    return (
      <div style={{
        ...base, display: 'flex', alignItems: 'center',
        justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        fontSize: el.fontSize ?? 48,
        fontWeight: el.bold ? 700 : 500,
        fontStyle: el.italic ? 'italic' : 'normal',
        textDecoration: el.underline ? 'underline' : 'none',
        textAlign: align,
        fontFamily: el.fontFamily || undefined,
        // Preserve newlines/spaces typed into the Properties Content textarea
        // (HTML collapses them by default).
        whiteSpace: 'pre-wrap',
        color: el.fill || 'var(--ink, #15171C)', lineHeight: lineSpacingOf(el), overflow: 'hidden',
      }}>
        {el.content}
      </div>
    );
  }
  if (el.type === 'image') {
    // An <img> when a src is set, else a neutral placeholder box so an
    // empty image is still visible/selectable on the canvas. draggable=false
    // keeps the native image drag from hijacking the canvas drag.
    return el.src
      ? <img src={el.src} alt="" draggable={false} style={{ ...base, objectFit: 'cover' }} />
      : <div style={{ ...base, display: 'grid', placeItems: 'center', background: '#eceae4', color: '#9a978f', fontFamily: 'var(--f-mono)', fontSize: 18 }}>No image</div>;
  }
  if (el.type === 'path') {
    // A freehand pen stroke: an open SVG polyline of the 0..1 points, riding
    // rot/opacity/shadow via `base` (StrokeSvg filters invalid points).
    return <StrokeSvg points={el.points} style={base} stroke={el.stroke || 'var(--ink, #15171C)'} strokeWidth={el.strokeWidth ?? 2} strokeDash={el.strokeDash} />;
  }
  // Every shape (incl. the line special case) dispatches off the shared registry
  // so the canvas and the export can't drift (lib/shapes.js).
  const def = shapeDef(el.type);
  // A gradient fill (any shape) overrides the solid `fill` as the background; a
  // malformed one falls back to the solid on both this surface and the export
  // (isRenderableGradient is shared). The export approximates it with a blend.
  const grad = isRenderableGradient(el.gradient) ? linearGradientCss(el.gradient) : null;
  // A line is a sharp-cornered bar (no border-radius, ink-default fill) at its
  // real height (its stroke thickness) — distinct from the rect fallback below,
  // which rounds to an 8px radius and uses the indigo fill. base already sets the height.
  if (def?.line) return <div style={{ ...base, background: grad || el.fill || 'var(--ink, #15171C)' }} />;
  const fill = { background: grad || el.fill || 'oklch(0.62 0.17 265)' };
  if (def?.clip) {
    if (!hasVisibleStroke(el)) return <div style={{ ...base, ...fill, clipPath: def.clip }} />;
    // A clip polygon's stroke can't be a CSS border (clipped away), so overlay a
    // closed SVG <polygon> tracing the same clip points. The fill div keeps its CSS
    // fill/gradient unchanged; the wrapper carries rot/opacity/shadow from `base`.
    return (
      <div style={base}>
        <div style={{ position: 'absolute', inset: 0, ...fill, clipPath: def.clip }} />
        <StrokeSvg points={clipPoints(def.clip)} closed style={{ position: 'absolute', inset: 0 }}
          stroke={el.stroke} strokeWidth={el.strokeWidth} strokeDash={el.strokeDash} />
      </div>
    );
  }
  // A stroke is a CSS border on the box shapes (it follows the border-radius);
  // box-sizing keeps the element's w/h footprint constant. Clip shapes are
  // excluded (a border would be clipped away) — see isStrokeableShape.
  const stroke = hasVisibleStroke(el)
    ? { border: `${el.strokeWidth}px ${borderStyle(el.strokeDash)} ${el.stroke}`, boxSizing: 'border-box' }
    : null;
  return <div style={{ ...base, ...fill, ...stroke, borderRadius: def?.round ? '50%' : (def?.radius ?? 8) }} />; // rect / unknown → 8
}

export function ElementsLayer({ elements }) {
  // Coerce + drop falsy entries (a malformed deck/MCP write could leave a
  // non-array or a null entry) — matches how the PPTX export filters, so a bad
  // value can't crash the render. `ElementView` then always gets a real element.
  const els = (Array.isArray(elements) ? elements : []).filter(Boolean);
  if (!els.length) return null;
  // pointer-events:none — this is the VISUAL element layer; interaction (select,
  // drag, resize) is handled by CanvasSlide's separate overlay. Without this, the
  // full-bleed layer would sit over the slide text and swallow the double-click
  // that starts an inline text edit on any slide that has elements.
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {els.map((el) => <ElementView key={el.id} el={el} />)}
    </div>
  );
}

export function Slide(props) {
  return (
    <>
      <SlideContent {...props} />
      <ElementsLayer elements={props.slide?.elements} />
    </>
  );
}

function SlideContent({ slide, deck, sectionName, num, total, editable = false, onEditField, onApplyPatch }) {
  const s = { ...slide, sectionName, num, total };
  // Inline-edit helper. Read-only (editable=false) renders the plain tag, so the
  // shared renderer (thumbnails, sorter, presenter) is byte-identical. On the
  // canvas a commit emits the field's semantic path + value; the Editor turns
  // that into a validated patch (it owns deck mutation — the renderer stays a
  // pure view that only knows its own field paths).
  // onCommit returns false only when the Editor reports the edit was rejected
  // (an empty applied-keys array), so EditableText can revert the field.
  const commit = (path, v) => {
    const applied = onEditField?.(path, v);
    return !Array.isArray(applied) || applied.length > 0;
  };
  // Commit a full multi-field patch (e.g. the roadmap's materialized
  // { months, lanes, todayIndex }) — fieldPatch can only build a single-key
  // patch, so SVG-label edits route through this instead of `commit`. Same
  // reject-on-empty-applied contract for EditableText's revert.
  const commitPatch = (patch) => {
    const applied = onApplyPatch?.(patch);
    return !Array.isArray(applied) || applied.length > 0;
  };
  // Each field carries any per-field formatting (fmt) merged over its template
  // style — applied on BOTH the read-only and editable renders so the canvas,
  // thumbnails, sorter, and presenter stay pixel-identical. (PPTX export also
  // reads fmt for bold/italic/underline/colour — fmtOpts in lib/pptxExport.js;
  // font size is export-deferred.) The editable render also tags the field with
  // its fmtKey so the formatting toolbar can find the focused field.
  //
  // Formatting covers the fixed top-level fields AND per-item index paths
  // (['items', i, 't'], ['rows', i, j], …) — `isFormattablePath` is the shared
  // vocabulary (lib/slideFmt.js) the patch gate also validates against. Per-item
  // fmt is index-keyed (stable through inline edits; an AI item rewrite re-applies
  // it by position). The dotted key is built only when it could be needed (the
  // slide has formatting, or we're editable), so the high-volume unformatted
  // read-only render skips the join.
  const E = (path, value, props = {}) => {
    const formattable = isFormattablePath(path);
    const key = formattable && (slide.fmt || editable) ? fmtKey(path) : undefined;
    const fmt = key ? slide.fmt?.[key] : undefined;
    const style = fmt ? { ...props.style, ...fmtStyle(fmt) } : props.style;
    return (
      <EditableText
        {...props} style={style} editable={editable} value={value}
        fmtKey={editable ? key : undefined} onCommit={(v) => commit(path, v)}
      />
    );
  };
  switch (slide.layout) {
    case 'cover':
      return (
        <div className={`slide ${slide.bg || ''}`}>
          <div style={{ position:'absolute', top:60, left:80, right:80, display:'flex', justifyContent:'space-between', fontFamily:'var(--f-mono)', fontSize:18, opacity:0.5 }}>
            <span>{(deck?.title || 'DECK').toUpperCase()}</span>
            {E(['kicker'], slide.kicker || 'CONFIDENTIAL', { as: 'span' })}
          </div>
          <div style={{ position:'absolute', left:80, bottom:160 }}>
            {slide.eyebrow && E(['eyebrow'], slide.eyebrow, { as: 'div', style: { fontFamily:'var(--f-mono)', fontSize:20, letterSpacing:'0.2em', opacity:0.6, marginBottom:28 } })}
            {E(['title'], slide.title || deck?.title || 'Untitled', { as: 'h1', style: { fontSize:CANVAS_BASELINE_PX.cover.title, fontWeight:600, lineHeight:0.95, letterSpacing:'-0.04em', margin:0, maxWidth:1500 } })}
          </div>
          <div style={{ position:'absolute', left:80, bottom:80, display:'flex', gap:40, fontFamily:'var(--f-mono)', fontSize:CANVAS_BASELINE_PX.cover.subtitle, opacity:0.55 }}>
            {E(['subtitle'], slide.subtitle || deck?.subtitle || deck?.author || '', { as: 'span' })}
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
            {E(['eyebrow'], slide.eyebrow || 'Agenda · 4 parts', { as: 'div', className: 'slide-eyebrow' })}
            {E(['title'], slide.title || "What we'll cover", { as: 'h1', style: { fontSize:CANVAS_BASELINE_PX.agenda.title, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 80px', lineHeight:1 } })}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'40px 80px', maxWidth:1700 }}>
              {(Array.isArray(slide.items) ? slide.items : []).map((it, i) => it && (
                // Map the ORIGINAL array (not filtered) so `i` is the true index
                // an edit writes back to; falsy items render as nothing. Keyed by
                // index (stable): editing it.n must not remount the row.
                <div key={i} style={{ display:'grid', gridTemplateColumns:'80px 1fr', gap:20, paddingBottom:24, borderBottom:'1px solid #eee' }}>
                  {E(['items', i, 'n'], it.n, { as: 'div', style: { fontFamily:'var(--f-mono)', fontSize:CANVAS_BASELINE_PX.agenda['items.n'], color:'oklch(0.62 0.17 265)', fontWeight:500 } })}
                  <div>
                    {E(['items', i, 't'], it.t, { as: 'div', style: { fontSize:CANVAS_BASELINE_PX.agenda['items.t'], fontWeight:600, letterSpacing:'-0.01em', marginBottom:8 } })}
                    {E(['items', i, 'd'], it.d, { as: 'div', style: { fontSize:CANVAS_BASELINE_PX.agenda['items.d'], color:'#666', lineHeight:1.3 } })}
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
            <span>{String(deck?.title || '').toUpperCase()}</span>
          </div>
          <div style={{ position:'absolute', left:80, top:'50%', transform:'translateY(-50%)' }}>
            <div style={{ fontFamily:'var(--f-mono)', fontSize:240, fontWeight:400, opacity:0.15, letterSpacing:'-0.04em', lineHeight:0.8 }}>{slide.chapter}</div>
            {E(['title'], slide.title, { as: 'div', style: { fontSize:CANVAS_BASELINE_PX.divider.title, fontWeight:600, letterSpacing:'-0.04em', marginTop:-60 } })}
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
            {E(['eyebrow'], slide.eyebrow || 'Scorecard', { as: 'div', className: 'slide-eyebrow' })}
            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:60 }}>
              {E(['title'], slide.title, { as: 'h1', style: { fontSize:CANVAS_BASELINE_PX.kpi.title, fontWeight:600, letterSpacing:'-0.03em', margin:0 } })}
              {E(['note'], slide.note, { as: 'div', style: { fontFamily:'var(--f-mono)', fontSize:20, color:'#888' } })}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'24px', maxWidth:1760 }}>
              {(Array.isArray(slide.kpis) ? slide.kpis : []).map((k,i)=> k && (
                <div key={i} style={{ padding:'28px 32px', border:'1px solid #e8e5df', borderRadius:10, background:'white', position:'relative' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
                    {E(['kpis', i, 'label'], k.label, { as: 'div', style: { fontFamily:'var(--f-mono)', fontSize:CANVAS_BASELINE_PX.kpi['kpis.label'], letterSpacing:'0.08em', textTransform:'uppercase', color:'#888' } })}
                    {E(['kpis', i, 'delta'], k.delta, { as: 'div', style: {
                      fontFamily:'var(--f-mono)', fontSize:CANVAS_BASELINE_PX.kpi['kpis.delta'], padding:'2px 8px', borderRadius:4,
                      background: k.good === true ? 'oklch(0.95 0.04 155)' : k.good === false ? 'oklch(0.95 0.04 25)' : '#f0ede8',
                      color: k.good === true ? 'oklch(0.45 0.14 155)' : k.good === false ? 'oklch(0.5 0.18 25)' : '#666'
                    } })}
                  </div>
                  {E(['kpis', i, 'val'], k.val, { as: 'div', style: { fontSize:CANVAS_BASELINE_PX.kpi['kpis.val'], fontWeight:600, letterSpacing:'-0.03em', lineHeight:1, marginBottom:14 } })}
                  {E(['kpis', i, 'target'], k.target, { as: 'div', style: { fontFamily:'var(--f-mono)', fontSize:16, color:'#888' } })}
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
            {E(['eyebrow'], slide.eyebrow || 'Scorecard', { as: 'div', className: 'slide-eyebrow' })}
            {E(['title'], slide.title, { as: 'h1', style: { fontSize:CANVAS_BASELINE_PX.chart.title, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 8px' } })}
            {E(['sub'], slide.sub || `${typeLabel} chart`, { as: 'div', style: { fontFamily:'var(--f-mono)', fontSize:22, color:'#888', marginBottom:40 } })}
            <div style={{ background:'white', border:'1px solid #eee', borderRadius:10, padding:30 }}>
              <ChartByType type={chartType} slide={slide} editable={editable} onCommitPatch={commitPatch}/>
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
              {E(['eyebrow'], slide.eyebrow || 'Scorecard', { as: 'div', className: 'slide-eyebrow' })}
              {E(['title'], slide.title, { as: 'h1', style: { fontSize:CANVAS_BASELINE_PX.split.title, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 40px', lineHeight:1 } })}
              {E(['body'], slide.body, { as: 'p', style: { fontSize:CANVAS_BASELINE_PX.split.body, lineHeight:1.5, color:'#333', maxWidth:760 } })}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
              {(Array.isArray(slide.stats) ? slide.stats : []).map((st,i)=> st && (
                <div key={i} style={{ padding:'36px 40px', background:'oklch(0.97 0.01 85)', borderRadius:10, display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
                  {E(['stats', i, 'lbl'], st.lbl, { as: 'div', style: { fontFamily:'var(--f-mono)', fontSize:CANVAS_BASELINE_PX.split['stats.lbl'], color:'#555', letterSpacing:'0.05em', textTransform:'uppercase' } })}
                  {E(['stats', i, 'val'], st.val, { as: 'div', style: { fontSize:CANVAS_BASELINE_PX.split['stats.val'], fontWeight:600, letterSpacing:'-0.03em', color: String(st.val ?? '').startsWith('-') ? 'oklch(0.55 0.18 25)' : 'oklch(0.45 0.14 155)' } })}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    case 'table': {
      const cols = Array.isArray(slide.columns) ? slide.columns : [];
      const rows = Array.isArray(slide.rows) ? slide.rows : [];
      const ncol = cols.length || 1;
      const gridCols = ncol === 6 ? '1.4fr 1fr 0.7fr 0.6fr 0.7fr 0.8fr' : `repeat(${ncol}, 1fr)`;
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:140, left:80, right:80 }}>
            {E(['eyebrow'], slide.eyebrow || 'Segments', { as: 'div', className: 'slide-eyebrow' })}
            {E(['title'], slide.title, { as: 'h1', style: { fontSize:CANVAS_BASELINE_PX.table.title, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 50px' } })}
            <div style={{ border:'1px solid #eee', borderRadius:12, overflow:'hidden', background:'white' }}>
              <div style={{ display:'grid', gridTemplateColumns:gridCols, padding:'22px 30px', background:'oklch(0.97 0.01 85)', fontFamily:'var(--f-mono)', fontSize:CANVAS_BASELINE_PX.table.columns, color:'#666', letterSpacing:'0.05em', textTransform:'uppercase', borderBottom:'1px solid #eee' }}>
                {cols.map((c,ci) => <div key={ci}>{E(['columns', ci], c)}</div>)}
              </div>
              {rows.map((r,i)=>(
                <div key={i} style={{ display:'grid', gridTemplateColumns:gridCols, padding:'28px 30px', fontSize:CANVAS_BASELINE_PX.table.rows, borderBottom: i < rows.length - 1 ? '1px solid #eee' : 'none', alignItems:'center' }}>
                  {r.map((cell, ci) => (
                    <div key={ci} style={{
                      fontWeight: ci === 0 ? 600 : 400,
                      fontFamily: ci === 0 ? 'var(--f-sans)' : 'var(--f-mono)',
                      color: (ci > 0 && String(cell).startsWith('-')) ? 'oklch(0.55 0.18 25)' : (ci > 0 && String(cell).startsWith('+')) ? 'oklch(0.45 0.14 155)' : 'inherit'
                    }}>
                      {ci === ncol - 1 && ncol === 6
                        ? <span style={{ fontSize:18, padding:'4px 12px', borderRadius:4, background:'oklch(0.95 0.02 85)', fontFamily:'var(--f-mono)', color:'#555' }}>{E(['rows', i, ci], cell)}</span>
                        : E(['rows', i, ci], cell)}
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
            {E(['title'], slide.title, { as: 'h1', style: { fontSize:CANVAS_BASELINE_PX.text.title, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 50px', lineHeight:1 } })}
            {E(['body'], slide.body, { as: 'p', style: { fontSize:CANVAS_BASELINE_PX.text.body, lineHeight:1.5, color:'#333' } })}
          </div>
        </div>
      );
    case 'roadmap':
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:140, left:80, right:80 }}>
            {E(['eyebrow'], slide.eyebrow || 'Product', { as: 'div', className: 'slide-eyebrow' })}
            {E(['title'], slide.title, { as: 'h1', style: { fontSize:CANVAS_BASELINE_PX.roadmap.title, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 50px' } })}
            <RoadmapGraphic slide={slide} editable={editable} onCommitPatch={commitPatch}/>
            <div style={{ display:'flex', gap:28, marginTop:24, fontFamily:'var(--f-mono)', fontSize:18 }}>
              {ROADMAP_STATES.map(st => (
                <span key={st} style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ width:14, height:14, background:ROADMAP_OKLCH[st], borderRadius:2 }}/>{ROADMAP_LABELS[st]}
                </span>
              ))}
            </div>
          </div>
        </div>
      );
    case 'risks':
      return (
        <div className="slide">
          <SlideChrome slide={s} deck={deck}/>
          <div style={{ position:'absolute', top:160, left:80, right:80 }}>
            {E(['eyebrow'], slide.eyebrow || 'Outlook', { as: 'div', className: 'slide-eyebrow' })}
            {E(['title'], slide.title, { as: 'h1', style: { fontSize:CANVAS_BASELINE_PX.risks.title, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 60px' } })}
            <div style={{ display:'flex', flexDirection:'column', gap:28 }}>
              {(Array.isArray(slide.items) ? slide.items : []).map((it,i)=>{
                if (!it) return null; // keep `i` the true index for onEditField
                const sevC = SEVERITY_OKLCH[it.sev] || SEVERITY_OKLCH.fallback;
                return (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'160px 1fr', gap:40, padding:'32px 36px', border:'1px solid #eee', borderLeft:`6px solid ${sevC}`, borderRadius:6, background:'white' }}>
                    <div style={{ fontFamily:'var(--f-mono)', fontSize:18, letterSpacing:'0.08em', textTransform:'uppercase', color:sevC, fontWeight:600, paddingTop:6 }}>{it.sev} risk</div>
                    <div>
                      {E(['items', i, 't'], it.t, { as: 'div', style: { fontSize:CANVAS_BASELINE_PX.risks['items.t'], fontWeight:600, marginBottom:10 } })}
                      {E(['items', i, 'd'], it.d, { as: 'div', style: { fontSize:CANVAS_BASELINE_PX.risks['items.d'], color:'#555' } })}
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
            {E(['eyebrow'], slide.eyebrow || 'Outlook', { as: 'div', className: 'slide-eyebrow' })}
            {E(['title'], slide.title, { as: 'h1', style: { fontSize:CANVAS_BASELINE_PX.list.title, fontWeight:600, letterSpacing:'-0.03em', margin:'0 0 70px' } })}
            <div style={{ display:'flex', flexDirection:'column', gap:28, maxWidth:1500 }}>
              {(Array.isArray(slide.items) ? slide.items : []).map((it,i)=> it != null && (
                <div key={i} style={{ display:'grid', gridTemplateColumns:'100px 1fr', gap:28, alignItems:'baseline', borderBottom:'1px solid #eee', paddingBottom:28 }}>
                  <div style={{ fontFamily:'var(--f-mono)', fontSize:28, color:'oklch(0.62 0.17 265)', fontWeight:500 }}>{String(i+1).padStart(2,'0')}</div>
                  {E(['items', i], typeof it === 'object' && it !== null ? '' : it, { as: 'div', style: { fontSize:CANVAS_BASELINE_PX.list.items, fontWeight:500, letterSpacing:'-0.01em' } })}
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
            {E(['eyebrow'], slide.eyebrow || 'END OF REVIEW', { as: 'div', style: { fontFamily:'var(--f-mono)', fontSize:20, letterSpacing:'0.2em', opacity:0.5, marginBottom:40 } })}
            <h1 style={{ fontSize:CANVAS_BASELINE_PX.thanks.title, fontWeight:600, letterSpacing:'-0.05em', margin:0, lineHeight:0.9 }}>
              {E(['title'], slide.title || 'Thanks', { as: 'span' })}.
            </h1>
            {E(['subtitle'], slide.subtitle, { as: 'div', style: { fontSize:CANVAS_BASELINE_PX.thanks.subtitle, opacity:0.7, marginTop:40 } })}
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
            {E(['title'], slide.title || 'Untitled', { as: 'h1', style: { fontSize:96, fontWeight:600 } })}
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
