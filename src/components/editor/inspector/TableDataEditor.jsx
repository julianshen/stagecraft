import React from 'react';
import { Button, IconButton } from '../../ui/Primitives.jsx';
import { remapTableFmt } from '../../../lib/slideFmt.js';

// Inspector editor for a table slide's `columns` (header row) + `rows` (2D grid):
// edit each cell, add/delete a column or a row. Commits through the shared
// validated patch path (onApply → sanitizeSlidePatch), like the Co-pilot. Edits
// and adds keep cell positions, so they send the data alone; a delete shifts
// positions, so it also sends the 2D index-keyed `fmt` remapped by remapTableFmt
// (the patch merge replaces `fmt` wholesale) — keeping per-cell formatting on its
// cell. Row/column reordering is a planned follow-up.
export default function TableDataEditor({ slide, onApply }) {
  // Open malformed data without crashing, losing it, or blocking edits, by
  // normalizing to a rectangle on read. A loaded deck (the gate validates
  // mutations, not a loaded deck) can carry a non-array row, a ragged length, or
  // a non-primitive cell. Coerce every header/cell to the primitive the gate
  // accepts (`prim`) — a non-primitive that only displayed blank would otherwise
  // ride along in a patch and trip the gate's primitive check, dropping the whole
  // edit. Then size the grid to the widest of the header row and any body row and
  // pad both axes out to it: every cell (incl. an over-wide row's extras — the
  // canvas and export render every cell, so we NEVER truncate) gets a header, and
  // `columns.length` becomes the true width every handler below can rely on.
  const prim = (v) => (typeof v === 'object' && v !== null ? '' : (v ?? ''));
  const rawCols = (Array.isArray(slide.columns) ? slide.columns : []).map(prim);
  const rawRows = (Array.isArray(slide.rows) ? slide.rows : []).map((row) =>
    (Array.isArray(row) ? row : []).map(prim));
  const width = Math.max(0, rawCols.length, ...rawRows.map((r) => r.length));
  const pad = (arr) => (arr.length < width ? [...arr, ...Array(width - arr.length).fill('')] : arr);
  const columns = pad(rawCols);
  const rows = rawRows.map(pad);
  const ids = (n) => Array.from({ length: n }, (_, i) => i); // identity order [0..n-1]

  // Edits/adds keep cell positions → commit the data alone. A delete shifts
  // positions → also send the remapped fmt (only when the slide carries any).
  const commitDelete = (patch, rowOrder, colOrder) => {
    const fmt = slide.fmt ? remapTableFmt(slide.fmt, rowOrder, colOrder) : undefined;
    onApply(fmt ? { ...patch, fmt } : patch);
  };

  const editColumn = (c, value) => onApply({ columns: columns.map((h, i) => (i === c ? value : h)) });
  const editCell = (r, c, value) =>
    onApply({ rows: rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row)) });
  const addColumn = () => onApply({ columns: [...columns, ''], rows: rows.map((row) => [...row, '']) });
  const addRow = () => onApply({ rows: [...rows, columns.map(() => '')] });
  const deleteColumn = (c) => commitDelete(
    { columns: columns.filter((_, i) => i !== c), rows: rows.map((row) => row.filter((_, i) => i !== c)) },
    ids(rows.length),                          // rows untouched (identity)
    ids(columns.length).filter((i) => i !== c), // column c removed
  );
  const deleteRow = (r) => commitDelete(
    { rows: rows.filter((_, i) => i !== r) },
    ids(rows.length).filter((i) => i !== r), // row r removed
    ids(columns.length),                     // columns untouched (identity)
  );

  // One CSS grid: a delete-column row, the header row, then a row per body row —
  // each `columns.length` cells wide plus a trailing control column.
  const gridCols = columns.length ? `repeat(${columns.length}, minmax(0, 1fr)) 22px` : 'auto';
  return (
    <div className="pane-section">
      <h4>Table</h4>
      <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 4, alignItems: 'center' }}>
        {columns.map((_, ci) => (
          // Keep ≥1 column: an empty grid renders header-only on the canvas but
          // vanishes from the PPTX export (addTable needs both axes non-empty).
          <IconButton key={`dc${ci}`} name="trash" size={11} title="Delete column"
            disabled={columns.length <= 1} onClick={() => deleteColumn(ci)} />
        ))}
        {columns.length > 0 && <span />}{/* corner above the row-delete column */}
        {columns.map((h, ci) => (
          <input key={`h${ci}`} className="cell-input" title={`Column ${ci + 1} header`} value={h}
            style={{ fontWeight: 600 }} onChange={(e) => editColumn(ci, e.target.value)} />
        ))}
        {columns.length > 0 && <span />}
        {rows.map((row, ri) => (
          <React.Fragment key={`r${ri}`}>
            {row.map((cell, ci) => (
              <input key={ci} className="cell-input" title={`Row ${ri + 1} column ${ci + 1}`} value={cell}
                onChange={(e) => editCell(ri, ci, e.target.value)} />
            ))}
            <IconButton name="trash" size={11} title="Delete row" disabled={rows.length <= 1} onClick={() => deleteRow(ri)} />
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <Button variant="outline" style={{ height: 26, fontSize: 11 }} onClick={addColumn}>Add column</Button>
        <Button variant="outline" style={{ height: 26, fontSize: 11 }} onClick={addRow}>Add row</Button>
      </div>
    </div>
  );
}
