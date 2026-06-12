import React from 'react';
import { Button, IconButton } from '../../ui/Primitives.jsx';
import { chartData, coerceNum } from '../../../lib/chartSpec.js';

// Inspector editor for a chart slide's data. Renders the same normalized view
// the canvas and the PPTX export draw (chartData — including its demo fallback,
// so a data-less starter chart materializes as editable rows), and commits
// every edit as a full `{ chart }` patch through the validated patch gate.

export default function ChartDataEditor({ slide, onApply }) {
  const { categories, series } = chartData(slide);

  const commit = (cats, ser) => onApply({ chart: { categories: cats, series: ser } });
  const mapSeries = (fn) => series.map((s, i) => ({ name: s.name, values: fn(s, i) }));

  const setCategory = (ci, v) => commit(categories.map((c, i) => (i === ci ? v : c)), series);
  const setName = (si, v) => commit(categories, series.map((s, i) => (i === si ? { ...s, name: v } : s)));
  const setValue = (si, ci, v) =>
    commit(categories, mapSeries((s, i) => (i === si ? s.values.map((x, j) => (j === ci ? coerceNum(v) : x)) : s.values)));
  const addSeries = () => commit(categories, [...series, { name: `Series ${series.length + 1}`, values: categories.map(() => 0) }]);
  const removeSeries = (si) => commit(categories, series.filter((_, i) => i !== si));
  const addRow = () => commit([...categories, `Category ${categories.length + 1}`], mapSeries((s) => [...s.values, 0]));
  const removeRow = (ci) => commit(categories.filter((_, i) => i !== ci), mapSeries((s) => s.values.filter((_, j) => j !== ci)));

  return (
    <div className="pane-section">
      <h4>Chart data</h4>
      <div style={{ display: 'grid', gridTemplateColumns: `1.4fr repeat(${series.length}, 1fr) 20px`, gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>CATEGORY</span>
        {series.map((s, si) => (
          <input key={`h${si}`} className="cell-input" value={s.name} title="Series name"
            onChange={(e) => setName(si, e.target.value)} />
        ))}
        <span />
        {categories.map((c, ci) => (
          <React.Fragment key={`r${ci}`}>
            <input className="cell-input" value={c} title="Category" onChange={(e) => setCategory(ci, e.target.value)} />
            {series.map((s, si) => (
              <input key={`v${si}`} className="cell-input" type="number" value={s.values[ci]} title="Value"
                onChange={(e) => setValue(si, ci, e.target.value)} />
            ))}
            <IconButton name="x" size={10} title="Remove row" disabled={categories.length <= 1} onClick={() => removeRow(ci)} />
          </React.Fragment>
        ))}
        <span />
        {series.map((s, si) => (
          <IconButton key={`d${si}`} name="x" size={10} title="Remove series" disabled={series.length <= 1}
            onClick={() => removeSeries(si)} style={{ justifySelf: 'center' }} />
        ))}
        <span />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <Button variant="outline" style={{ height: 26, fontSize: 11 }} onClick={addRow}>Add row</Button>
        <Button variant="outline" style={{ height: 26, fontSize: 11 }} onClick={addSeries}>Add series</Button>
      </div>
    </div>
  );
}
