import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import NumberCell from './NumberCell.jsx';

describe('NumberCell', () => {
  it('renders empty (not "null"/"undefined") for nullish values', () => {
    const { container } = render(<NumberCell value={null} onCommit={vi.fn()} title="V" />);
    expect(container.querySelector('input').value).toBe('');
    const { container: c2 } = render(<NumberCell value={undefined} onCommit={vi.fn()} title="V" />);
    expect(c2.querySelector('input').value).toBe('');
  });

  it('commits parseable values and ignores incomplete input', () => {
    const onCommit = vi.fn();
    const { container } = render(<NumberCell value={2} onCommit={onCommit} title="V" />);
    const input = container.querySelector('input');
    fireEvent.change(input, { target: { value: '' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '-7' } });
    expect(onCommit).toHaveBeenCalledWith(-7);
  });
});
