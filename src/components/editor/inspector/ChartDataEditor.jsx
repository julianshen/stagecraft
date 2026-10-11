import React from 'react';
import { Button, IconButton, FieldRow, Select } from '../../ui/Primitives.jsx';
import NumberCell from './NumberCell.jsx';
import { chartData, chartTypeOf, CHART_TYPES, CHART_TYPE_LABELS } from '../../../lib/chartSpec.js';

const CHART_TYPE_OPTIONS = CHART_TYPES.map((t) => ({ value: t, label: CHART_TYPE_LABELS[t] }));

// Inspector editor for a chart slide's data. Renders the same normalized view
// the canvas and the PPTX export draw (chartData — including its demo fallback,
// so a data-less starter chart materializes as editable rows), and commits
// every edit as a full `{ chart }` patch through the validated patch gate.
// Honest trade-off: committing the normalized view persists its normalization —
// values beyond the category count are clipped and non-{name,values} series
// extras are dropped on the first edit, exactly as the canvas/export resolve them.

export default function ChartDataEditor({ slide, onApply }) {
  // Donut/pie render only series[0] (canvas and export both), so the editor
  // shows only that one and hides the multi-series controls. Edits still act on
  // every series — the hidden ones keep their data (and stay aligned as rows
  // change), so switching a chart to Donut and back never loses a series.
  const singleSeries = chartTypeOf(slide) === 'donut';
  const model = chartData(slide);
  const categories = model.categories;
  const series = model.series;
  const shown = singleSeries ? series.slice(0, 1) : series; // a prefix, so indices match

  const commit = (cats, ser) => onApply({ chart: { categories: cats, series: ser } });
  const mapSeries = (fn) => series.map((s, i) => ({ name: s.name, values: fn(s, i) }));

  const setCategory = (ci, v) => commit(categories.map((c, i) => (i === ci ? v : c)), series);
  const setName = (si, v) => commit(categories, series.map((s, i) => (i === si ? { ...s, name: v } : s)));
  const setValue = (si, ci, n) =>
    commit(categories, mapSeries((s, i) => (i === si ? s.values.map((x, j) => (j === ci ? n : x)) : s.values)));
  const addSeries = () => commit(categories, [...series, { name: `Series ${series.length + 1}`, values: categories.map(() => 0) }]);
  const removeSeries = (si) => commit(categories, series.filter((_, i) => i !== si));
  const addRow = () => commit([...categories, `Category ${categories.length + 1}`], mapSeries((s) => [...s.values, 0]));
  const removeRow = (ci) => commit(categories.filter((_, i) => i !== ci), mapSeries((s) => s.values.filter((_, j) => j !== ci)));

  return (
    <div className="pane-section">
      {/* The type was only reachable at insert (or via the AI) — U12. */}
      <FieldRow label="TYPE">
        <Select ariaLabel="Chart type" value={chartTypeOf(slide)} options={CHART_TYPE_OPTIONS}
          onChange={(chartType) => onApply({ chartType })} />
      </FieldRow>
      <h4>Chart data</h4>
      <div style={{ display: 'grid', gridTemplateColumns: `1.4fr repeat(${shown.length}, 1fr) 20px`, gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>CATEGORY</span>
        {shown.map((s, si) => (
          <input key={`h${si}`} className="cell-input" value={s.name ?? ''} title="Series name"
            onChange={(e) => setName(si, e.target.value)} />
        ))}
        <span />
        {categories.map((c, ci) => (
          <React.Fragment key={`r${ci}`}>
            <input className="cell-input" value={c ?? ''} title="Category" onChange={(e) => setCategory(ci, e.target.value)} />
            {shown.map((s, si) => (
              <NumberCell key={`v${si}`} value={s.values[ci]} title="Value" onCommit={(n) => setValue(si, ci, n)} />
            ))}
            <IconButton name="x" size={10} title="Remove row" disabled={categories.length <= 1} onClick={() => removeRow(ci)} />
          </React.Fragment>
        ))}
        <span />
        {!singleSeries && series.map((_, si) => (
          <IconButton key={`d${si}`} name="x" size={10} title="Remove series" disabled={series.length <= 1}
            onClick={() => removeSeries(si)} style={{ justifySelf: 'center' }} />
        ))}
        <span />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <Button variant="outline" style={{ height: 26, fontSize: 11 }} onClick={addRow}>Add row</Button>
        {!singleSeries && <Button variant="outline" style={{ height: 26, fontSize: 11 }} onClick={addSeries}>Add series</Button>}
      </div>
    </div>
  );
}
