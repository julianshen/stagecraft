// Matches the portable native chart writers; imported theme colors need a richer model.
const CHART_SERIES_HEX = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
const color = index => `#${CHART_SERIES_HEX[index % CHART_SERIES_HEX.length]}`;
const label = value => String(value).slice(0, 80);
/** Bounded preview for portable charts; native Office chart layout is not implied. */
export function PresentationChart({ chart }) {
  const categories = chart?.categories, series = chart?.series;
  if (!['bar', 'line', 'pie'].includes(chart?.kind) || !Array.isArray(categories) || !categories.length || categories.length > 100 ||
    categories.some(c => typeof c !== 'string') || !Array.isArray(series) || !series.length || series.length > 20 ||
    series.some(s => !s || typeof s.name !== 'string' || !Array.isArray(s.values) || s.values.length !== categories.length || s.values.some(v => !Number.isFinite(v))) ||
    (chart.kind === 'pie' && (series.length !== 1 || series[0].values.some(v => v < 0)))) return <span>Chart preview unavailable</span>;
  const width = 640, height = 360, left = 56, top = 24, plotWidth = 560, plotHeight = 250;
  const magnitude = Math.max(1, ...series.flatMap(s => s.values.map(v => Math.abs(v))));
  const normalized = series.map(s => s.values.map(v => v / magnitude));
  const min = Math.min(0, ...normalized.flat()), max = Math.max(0, ...normalized.flat());
  const span = max - min || 1;
  const y = value => top + (max - value) / span * plotHeight;
  const step = plotWidth / categories.length, x = index => left + step * (index + 0.5);
  const summary = series.map(s => `${s.name}: ${s.values.join(', ')}`).join('; ');
  let pieAngle = -Math.PI / 2;
  const pieTotal = normalized[0].reduce((sum, value) => sum + value, 0);
  return <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" role="img" aria-label={`${chart.kind} chart`}>
    <title>{`${chart.kind} chart`}</title><desc>{summary}</desc>
    <rect width={width} height={height} fill="white" />
    {chart.kind === 'pie' ? <g>
      {pieTotal === 0 ? <text x="320" y="180" textAnchor="middle">No positive values</text> : normalized[0].map((value, index) => {
        if (!value) return null;
        const angle = value / pieTotal * Math.PI * 2, start = pieAngle, end = pieAngle += angle;
        if (angle >= Math.PI * 2 - 1e-12) return <circle key={index} cx="320" cy="150" r="120" fill={color(index)}><title>{`${categories[index]}: ${series[0].values[index]}`}</title></circle>;
        const path = `M 320 150 L ${320 + 120 * Math.cos(start)} ${150 + 120 * Math.sin(start)} A 120 120 0 ${angle > Math.PI ? 1 : 0} 1 ${320 + 120 * Math.cos(end)} ${150 + 120 * Math.sin(end)} Z`;
        return <path key={index} d={path} fill={color(index)} stroke="white"><title>{`${categories[index]}: ${series[0].values[index]}`}</title></path>;
      })}
    </g> : <g>
      <line x1={left} x2={left + plotWidth} y1={y(0)} y2={y(0)} stroke="#64748b" />
      <line x1={left} x2={left} y1={top} y2={top + plotHeight} stroke="#64748b" />
      <text x={left - 6} y={top + 8} fontSize="11" textAnchor="end">{(max * magnitude).toPrecision(3)}</text>
      <text x={left - 6} y={top + plotHeight} fontSize="11" textAnchor="end">{(min * magnitude).toPrecision(3)}</text>
      {normalized.map((values, si) => chart.kind === 'line'
        ? <g key={si}><polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={color(si)} strokeWidth="3" />{values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={color(si)}><title>{`${series[si].name}, ${categories[i]}: ${series[si].values[i]}`}</title></circle>)}</g>
        : <g key={si}>{values.map((v, i) => <rect key={i} x={left + i * step + step * 0.1 + si * step * 0.8 / series.length} y={Math.min(y(v), y(0))} width={step * 0.8 / series.length} height={Math.abs(y(v) - y(0))} fill={color(si)}><title>{`${series[si].name}, ${categories[i]}: ${series[si].values[i]}`}</title></rect>)}</g>)}
      {categories.map((category, index) => index % Math.max(1, Math.ceil(categories.length / 8)) === 0 && <text key={index} x={x(index)} y="294" fontSize="12" textAnchor="middle">{label(category).slice(0, 14)}</text>)}
    </g>}
    {(chart.kind === 'pie' ? categories : series.map(s => s.name)).slice(0, 6).map((name, i) => <g key={i} transform={`translate(${20 + (i % 3) * 210},${320 + Math.floor(i / 3) * 20})`}><rect width="10" height="10" fill={color(i)} /><text x="15" y="10" fontSize="12">{label(name).slice(0, 26)}</text></g>)}
  </svg>;
}
