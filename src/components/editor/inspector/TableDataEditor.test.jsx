import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TableDataEditor from './TableDataEditor.jsx';

// A table slide: columns (header primitives) + rows (2D primitives). The editor
// edits cells and adds/deletes rows & columns, committing through the validated
// patch path (onApply). Delete remaps the 2D index-keyed fmt (remapTableFmt) so
// per-cell formatting follows its cell. Cell edits use fireEvent.change (the
// inputs are controlled by slide state a mocked onApply never updates); button
// clicks use user-event.
const table = (over = {}) => ({
  id: 't', layout: 'table',
  columns: ['A', 'B', 'C'],
  rows: [['a', 'b', 'c'], ['d', 'e', 'f']],
  ...over,
});

describe('TableDataEditor', () => {
  it('renders the header cells and every body cell', () => {
    render(<TableDataEditor slide={table()} onApply={vi.fn()} />);
    ['A', 'B', 'C', 'a', 'b', 'c', 'd', 'e', 'f'].forEach((v) => expect(screen.getByDisplayValue(v)).toBeTruthy());
  });

  it('edits a header cell and commits the columns array', () => {
    const onApply = vi.fn();
    render(<TableDataEditor slide={table()} onApply={onApply} />);
    fireEvent.change(screen.getByDisplayValue('B'), { target: { value: 'Beta' } });
    expect(onApply).toHaveBeenCalledWith({ columns: ['A', 'Beta', 'C'] });
  });

  it('edits a body cell and commits the rows grid', () => {
    const onApply = vi.fn();
    render(<TableDataEditor slide={table()} onApply={onApply} />);
    fireEvent.change(screen.getByDisplayValue('e'), { target: { value: 'EEE' } });
    expect(onApply).toHaveBeenCalledWith({ rows: [['a', 'b', 'c'], ['d', 'EEE', 'f']] });
  });

  it('adds a column (one header + one cell per row)', async () => {
    const onApply = vi.fn();
    render(<TableDataEditor slide={table()} onApply={onApply} />);
    await userEvent.click(screen.getByText('Add column'));
    expect(onApply).toHaveBeenCalledWith({
      columns: ['A', 'B', 'C', ''],
      rows: [['a', 'b', 'c', ''], ['d', 'e', 'f', '']],
    });
  });

  it('adds a row of blank cells matching the column count', async () => {
    const onApply = vi.fn();
    render(<TableDataEditor slide={table()} onApply={onApply} />);
    await userEvent.click(screen.getByText('Add row'));
    expect(onApply).toHaveBeenCalledWith({ rows: [['a', 'b', 'c'], ['d', 'e', 'f'], ['', '', '']] });
  });

  it('deletes a column, drops its cells, and remaps the 2D formatting', async () => {
    const onApply = vi.fn();
    const slide = table({ fmt: { 'columns.2': { bold: true }, 'rows.0.2': { italic: true }, 'rows.1.0': { underline: true } } });
    render(<TableDataEditor slide={slide} onApply={onApply} />);
    await userEvent.click(screen.getAllByTitle('Delete column')[1]); // delete column 1 (B)
    expect(onApply).toHaveBeenCalledWith({
      columns: ['A', 'C'],
      rows: [['a', 'c'], ['d', 'f']],
      fmt: { 'columns.1': { bold: true }, 'rows.0.1': { italic: true }, 'rows.1.0': { underline: true } },
    });
  });

  it('deletes a row and remaps the formatting (column keys untouched)', async () => {
    const onApply = vi.fn();
    const slide = table({ fmt: { 'columns.2': { bold: true }, 'rows.0.2': { italic: true }, 'rows.1.0': { underline: true } } });
    render(<TableDataEditor slide={slide} onApply={onApply} />);
    await userEvent.click(screen.getAllByTitle('Delete row')[0]); // delete row 0
    expect(onApply).toHaveBeenCalledWith({
      rows: [['d', 'e', 'f']],
      fmt: { 'columns.2': { bold: true }, 'rows.0.0': { underline: true } }, // rows.0.2 dropped; rows.1.0 → rows.0.0
    });
  });

  it('deletes with no formatting present → sends the data only', async () => {
    const onApply = vi.fn();
    render(<TableDataEditor slide={table()} onApply={onApply} />);
    await userEvent.click(screen.getAllByTitle('Delete row')[1]);
    expect(onApply).toHaveBeenCalledWith({ rows: [['a', 'b', 'c']] });
  });

  it('coerces a non-primitive or nullish header/cell to a blank field, never "[object Object]"', () => {
    // A layout switch can leave non-primitive cells; show them blank like the
    // canvas rather than rendering "[object Object]"/"null".
    const { container } = render(
      <TableDataEditor slide={{ id: 't', layout: 'table', columns: [{}, null], rows: [[null, { x: 1 }]] }} onApply={vi.fn()} />,
    );
    for (const input of container.querySelectorAll('input')) {
      expect(input.value).not.toBe('[object Object]');
      expect(input.value).not.toBe('null');
    }
  });

  it('never mutates the input slide — edits and deletes build new arrays', async () => {
    // The slide-patch merge + undo/history rely on referential immutability, so
    // editCell/deleteRow/deleteColumn must not touch the original arrays in place.
    const slide = table({ fmt: { 'rows.1.0': { bold: true } } });
    const snapshot = JSON.parse(JSON.stringify(slide));
    render(<TableDataEditor slide={slide} onApply={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('e'), { target: { value: 'X' } }); // editCell
    await userEvent.click(screen.getAllByTitle('Delete row')[0]);                // deleteRow
    await userEvent.click(screen.getAllByTitle('Delete column')[0]);             // deleteColumn
    expect(slide).toEqual(snapshot); // onApply is mocked, so the original must be untouched
  });

  it('coerces non-primitive cells to primitives in committed patches (so a malformed table is repairable cell-by-cell)', () => {
    // The gate rejects columns/rows with a non-primitive; if an unedited object
    // cell rode along in the patch, editing a different cell would be dropped
    // wholesale. Coercing on read makes every emitted array gate-valid.
    const onApply = vi.fn();
    render(<TableDataEditor slide={{ id: 't', layout: 'table', columns: ['A', 'B'], rows: [['a', { bad: 1 }]] }} onApply={onApply} />);
    fireEvent.change(screen.getByDisplayValue('a'), { target: { value: 'X' } }); // edit a DIFFERENT cell
    expect(onApply).toHaveBeenCalledWith({ rows: [['X', '']] }); // the object cell is now '' (primitive), not preserved
  });

  it('opens ragged/non-array rows as a rectangle (widens headers to the widest row; never drops cells)', () => {
    // Malformed data (a hand-edited persisted deck can carry non-rectangular rows;
    // the gate only validates mutations). The editor is the repair tool, so it
    // must open such a table — a non-array row would otherwise crash row.map().
    // The widest row has 4 cells, so the header row widens to 4 (a blank 4th
    // header) and every row pads to 4: a rectangle where every cell has a header.
    const { container } = render(
      <TableDataEditor slide={{ id: 't', layout: 'table', columns: ['A', 'B', 'C'], rows: ['oops', ['x'], ['p', 'q', 'r', 's']] }} onApply={vi.fn()} />,
    );
    expect(screen.getByDisplayValue('s')).toBeTruthy(); // long row's 4th cell preserved (NOT truncated — it renders/exports)
    // 4 headers (C + a blank) + 3 rows × 4 cells (all padded to the widest) = 4 + 12
    expect(container.querySelectorAll('input')).toHaveLength(4 + 12);
  });

  it('keeps the table rectangular when adding a column to a table loaded with an over-wide row', async () => {
    // An over-wide cell ('c', no header) is adopted by a blank header on read, so
    // Add column extends a clean rectangle rather than appending an orphan blank
    // that the old code could never headerise (P2: orphan cells on ragged add).
    const onApply = vi.fn();
    render(<TableDataEditor slide={{ id: 't', layout: 'table', columns: ['A', 'B'], rows: [['a', 'b', 'c']] }} onApply={onApply} />);
    await userEvent.click(screen.getByText('Add column'));
    expect(onApply).toHaveBeenCalledWith({ columns: ['A', 'B', '', ''], rows: [['a', 'b', 'c', '']] });
  });

  it('keeps formatting on an over-wide cell when deleting a different row', async () => {
    // 2 headers, a surviving row with a 3rd cell carrying fmt. Read widens to 3
    // columns, so deleting the other row remaps rows.1.2 → rows.0.2 instead of
    // dropping it for a cell that still renders/exports (P2: fmt loss on ragged delete).
    const onApply = vi.fn();
    const slide = { id: 't', layout: 'table', columns: ['A', 'B'], rows: [['x', 'y'], ['a', 'b', 'c']], fmt: { 'rows.1.2': { bold: true } } };
    render(<TableDataEditor slide={slide} onApply={onApply} />);
    await userEvent.click(screen.getAllByTitle('Delete row')[0]); // delete row 0
    // Also persists the widened header row so the saved slide isn't left ragged.
    expect(onApply).toHaveBeenCalledWith({ columns: ['A', 'B', ''], rows: [['a', 'b', 'c']], fmt: { 'rows.0.2': { bold: true } } });
  });

  it('keeps formatting on an over-wide cell when deleting an unrelated column', async () => {
    // Sibling of the row case: read widens to 3 columns, so deleting column 0
    // remaps the over-wide cell's fmt rows.0.2 → rows.0.1 rather than dropping it.
    const onApply = vi.fn();
    const slide = { id: 't', layout: 'table', columns: ['A', 'B'], rows: [['a', 'b', 'c']], fmt: { 'rows.0.2': { bold: true } } };
    render(<TableDataEditor slide={slide} onApply={onApply} />);
    await userEvent.click(screen.getAllByTitle('Delete column')[0]); // delete column 0 (A)
    expect(onApply).toHaveBeenCalledWith({ columns: ['B', ''], rows: [['b', 'c']], fmt: { 'rows.0.1': { bold: true } } });
  });

  it('disables deleting the last row and the last column (a table needs ≥1×1; an empty grid vanishes from the PPTX export)', () => {
    render(<TableDataEditor slide={{ id: 't', layout: 'table', columns: ['A'], rows: [['a']] }} onApply={vi.fn()} />);
    expect(screen.getByTitle('Delete row').disabled).toBe(true);
    expect(screen.getByTitle('Delete column').disabled).toBe(true);
  });

  it('handles a table with no columns/rows yet — shows the Add controls', () => {
    render(<TableDataEditor slide={{ id: 't', layout: 'table' }} onApply={vi.fn()} />);
    expect(screen.getByText('Add column')).toBeTruthy();
    expect(screen.getByText('Add row')).toBeTruthy();
    expect(screen.queryAllByTitle('Delete row')).toHaveLength(0);
  });

  it('seeds a body row when adding the first column to a header-only table', async () => {
    // A single-axis table (headers, no rows) renders on the canvas but vanishes
    // from the PPTX export (addTable needs both axes non-empty) — the same export
    // invariant the last-cell delete guards protect. Add column must seed a row.
    const onApply = vi.fn();
    render(<TableDataEditor slide={{ id: 't', layout: 'table', columns: ['A'], rows: [] }} onApply={onApply} />);
    await userEvent.click(screen.getByText('Add column'));
    expect(onApply).toHaveBeenCalledWith({ columns: ['A', ''], rows: [['', '']] });
  });

  it('seeds a header column and one cell when adding the first row to an empty table', async () => {
    // Mirror of the above: Add row on a 0×0 table must seed a header so the new
    // row has a cell, yielding a 1×1 rectangle rather than a column-less table.
    const onApply = vi.fn();
    render(<TableDataEditor slide={{ id: 't', layout: 'table' }} onApply={onApply} />);
    await userEvent.click(screen.getByText('Add row'));
    expect(onApply).toHaveBeenCalledWith({ columns: [''], rows: [['']] });
  });

  it('persists the widened header row when editing a body cell of a ragged table', () => {
    // The editor displays a padded rectangle; a body-cell edit that committed only
    // rows would leave the saved slide ragged (columns shorter than the row), which
    // the renderer/export then misalign. The commit also carries the normalized
    // columns so the persisted slide matches what was shown.
    const onApply = vi.fn();
    render(<TableDataEditor slide={{ id: 't', layout: 'table', columns: ['A', 'B'], rows: [['a', 'b', 'c']] }} onApply={onApply} />);
    fireEvent.change(screen.getByDisplayValue('a'), { target: { value: 'X' } });
    expect(onApply).toHaveBeenCalledWith({ columns: ['A', 'B', ''], rows: [['X', 'b', 'c']] });
  });

  it('persists the padded rows when editing a header of a table with a short row', () => {
    // Companion direction: a header edit on a table whose row was padded must also
    // carry the normalized rows, or the saved slide keeps the short (ragged) row.
    const onApply = vi.fn();
    render(<TableDataEditor slide={{ id: 't', layout: 'table', columns: ['A', 'B', 'C'], rows: [['a']] }} onApply={onApply} />);
    fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'Z' } });
    expect(onApply).toHaveBeenCalledWith({ columns: ['Z', 'B', 'C'], rows: [['a', '', '']] });
  });

  it('persists the widened header row when adding a row to a ragged table', async () => {
    // The add path heals too: adding a row must not leave the old short columns.
    const onApply = vi.fn();
    render(<TableDataEditor slide={{ id: 't', layout: 'table', columns: ['A', 'B'], rows: [['a', 'b', 'c']] }} onApply={onApply} />);
    await userEvent.click(screen.getByText('Add row'));
    expect(onApply).toHaveBeenCalledWith({ columns: ['A', 'B', ''], rows: [['a', 'b', 'c'], ['', '', '']] });
  });
});
