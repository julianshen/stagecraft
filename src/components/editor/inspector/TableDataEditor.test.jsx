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

  it('normalizes ragged or non-array rows to the column count without crashing', () => {
    // Malformed data (a hand-edited persisted deck can carry non-rectangular rows;
    // the gate only validates mutations). The editor is the repair tool, so it
    // must open such a table — a non-array row would otherwise crash row.map().
    const { container } = render(
      <TableDataEditor slide={{ id: 't', layout: 'table', columns: ['A', 'B', 'C'], rows: ['oops', ['x'], ['p', 'q', 'r', 's']] }} onApply={vi.fn()} />,
    );
    // 3 header inputs + 3 rows × 3 cells (padded/truncated to the column count) = 12
    expect(container.querySelectorAll('input')).toHaveLength(3 + 9);
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
});
