import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { LayoutGrid, LAYOUT_OPTIONS } from './LayoutGrid.jsx';

describe('LayoutGrid', () => {
  it('renders a card per layout and marks the current one active', () => {
    const { getByLabelText, container } = render(<LayoutGrid current="chart" onPick={vi.fn()} />);
    expect(container.querySelectorAll('.layout-opt')).toHaveLength(LAYOUT_OPTIONS.length);
    expect(getByLabelText('Chart layout').className).toContain('on');     // current highlighted
    expect(getByLabelText('Cover layout').className).not.toContain('on'); // others are not
  });

  it('calls onPick with the layout id when a card is clicked', () => {
    const onPick = vi.fn();
    const { getByLabelText } = render(<LayoutGrid current="cover" onPick={onPick} />);
    fireEvent.click(getByLabelText('Table layout'));
    expect(onPick).toHaveBeenCalledWith('table');
  });

  it('is safe to click with no onPick (read-only)', () => {
    const { getByLabelText } = render(<LayoutGrid current="cover" />);
    expect(() => fireEvent.click(getByLabelText('Cover layout'))).not.toThrow();
  });
});
