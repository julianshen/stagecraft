import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChartDataEditor from './ChartDataEditor.jsx';
import { sanitizeSlidePatch } from '../../../lib/deckUtils.js';

const slide = {
  id: 'c1', layout: 'chart', chartType: 'bar', title: 'T',
  chart: { categories: ['Q1', 'Q2'], series: [{ name: 'A', values: [1, 2] }] },
};

const renderEditor = (s = slide) => {
  const onApply = vi.fn();
  const utils = render(<ChartDataEditor slide={s} onApply={onApply} />);
  return { ...utils, onApply };
};

describe('ChartDataEditor', () => {
  it('renders the categories and series from the slide', () => {
    renderEditor();
    expect(screen.getByDisplayValue('Q1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Q2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  it('editing a value commits a full, gate-valid chart patch', () => {
    const { onApply } = renderEditor();
    fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '5' } });
    const patch = { chart: { categories: ['Q1', 'Q2'], series: [{ name: 'A', values: [1, 5] }] } };
    expect(onApply).toHaveBeenCalledWith(patch);
    // the payload must survive the Co-pilot patch gate untouched
    expect(sanitizeSlidePatch(patch, 'chart')).toEqual(patch);
  });

  it('supports negative values and does not commit incomplete input', () => {
    const { onApply } = renderEditor();
    const cell = screen.getByDisplayValue('2');
    // a number input reports '' for partial entries like a lone minus —
    // nothing commits, so the keystroke isn't snapped to 0 under the cursor
    fireEvent.change(cell, { target: { value: '' } });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.change(cell, { target: { value: '-3' } });
    expect(onApply.mock.calls[0][0].chart.series[0].values).toEqual([1, -3]);
    // blur with nothing committed restores the model value (the mock onApply
    // never applies the patch, so the model here is still the original 2)
    fireEvent.change(cell, { target: { value: '' } });
    fireEvent.blur(cell);
    expect(cell.value).toBe('2');
  });

  it('renaming a category and a series commits', () => {
    const { onApply } = renderEditor();
    fireEvent.change(screen.getByDisplayValue('Q1'), { target: { value: 'Jan' } });
    expect(onApply.mock.calls[0][0].chart.categories).toEqual(['Jan', 'Q2']);
    fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'Revenue' } });
    expect(onApply.mock.calls[1][0].chart.series[0].name).toBe('Revenue');
  });

  it('adds a series with zero-filled values, and a row padded across series', () => {
    const { onApply } = renderEditor();
    fireEvent.click(screen.getByText('Add series'));
    expect(onApply.mock.calls[0][0].chart.series).toEqual([
      { name: 'A', values: [1, 2] },
      { name: 'Series 2', values: [0, 0] },
    ]);
    fireEvent.click(screen.getByText('Add row'));
    const c = onApply.mock.calls[1][0].chart;
    expect(c.categories).toHaveLength(3);
    expect(c.series[0].values).toEqual([1, 2, 0]);
  });

  it('removes a row and a series, but never the last of either', () => {
    const two = {
      ...slide,
      chart: { categories: ['Q1', 'Q2'], series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [3, 4] }] },
    };
    const { onApply, container } = renderEditor(two);
    fireEvent.click(container.querySelectorAll('[title="Remove series"]')[1]);
    expect(onApply.mock.calls[0][0].chart.series).toEqual([{ name: 'A', values: [1, 2] }]);
    fireEvent.click(container.querySelectorAll('[title="Remove row"]')[0]);
    const c = onApply.mock.calls[1][0].chart;
    expect(c.categories).toEqual(['Q2']);
    expect(c.series.map((s) => s.values)).toEqual([[2], [4]]);
    // single-series / single-row slide: removal controls are disabled
    const { container: c2 } = renderEditor({ ...slide, chart: { categories: ['Q1'], series: [{ name: 'A', values: [1] }] } });
    expect(c2.querySelector('[title="Remove series"]').disabled).toBe(true);
    expect(c2.querySelector('[title="Remove row"]').disabled).toBe(true);
  });

  it('materializes the shared demo data for a chart slide without explicit data', () => {
    renderEditor({ id: 'c2', layout: 'chart', chartType: 'line', title: 'T' });
    expect(screen.getByDisplayValue('Q1')).toBeInTheDocument(); // chartData's default categories
  });
});

describe('single-series chart types (donut/pie)', () => {
  it('hides multi-series controls — extra series would persist but never render', () => {
    const donut = { id: 'd1', layout: 'chart', chartType: 'donut', chart: { categories: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] } };
    const { queryByText, container } = render(<ChartDataEditor slide={donut} onApply={vi.fn()} />);
    expect(queryByText('Add series')).toBeNull();
    expect(container.querySelector('[title="Remove series"]')).toBeNull();
  });

  it('keeps multi-series controls for line/bar/area', () => {
    const { queryByText } = renderEditor(); // bar
    expect(queryByText('Add series')).toBeTruthy();
  });
});

describe('donut/pie with extra authored series', () => {
  it('edits only the rendered series — commits clip to series[0] like the canvas/export', () => {
    const donut = {
      id: 'd2', layout: 'chart', chartType: 'pie',
      chart: { categories: ['A', 'B'], series: [{ name: 'S1', values: [1, 2] }, { name: 'GHOST', values: [9, 9] }] },
    };
    const onApply = vi.fn();
    const { queryByDisplayValue } = render(<ChartDataEditor slide={donut} onApply={onApply} />);
    expect(queryByDisplayValue('GHOST')).toBeNull(); // unrendered series not editable
    fireEvent.change(queryByDisplayValue('1'), { target: { value: '5' } });
    expect(onApply.mock.calls[0][0].chart.series).toEqual([{ name: 'S1', values: [5, 2] }]);
  });
});
