import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import TemplatePicker from './TemplatePicker.jsx';

describe('TemplatePicker — search', () => {
  it('filters templates by name as you type (case-insensitive, trimmed)', () => {
    const { getByLabelText, getByText, queryByText } = render(<TemplatePicker onClose={vi.fn()} onPick={vi.fn()} />);
    expect(getByText('Atlas')).toBeTruthy(); // all shown initially
    fireEvent.change(getByLabelText('Search templates'), { target: { value: '  LED ' } });
    expect(getByText('Ledger')).toBeTruthy();   // matches (case-insensitive + trimmed)
    expect(queryByText('Atlas')).toBeNull();     // filtered out
    expect(queryByText('Monolith')).toBeNull();
  });

  it('combines the search query with the active category filter', () => {
    const { getByLabelText, getByText, queryByText } = render(<TemplatePicker onClose={vi.fn()} onPick={vi.fn()} />);
    fireEvent.click(getByText('Editorial')); // category chip → Monolith + Field Notes
    expect(getByText('Monolith')).toBeTruthy();
    expect(getByText('Field Notes')).toBeTruthy();
    fireEvent.change(getByLabelText('Search templates'), { target: { value: 'field' } });
    expect(getByText('Field Notes')).toBeTruthy(); // Editorial AND matches 'field'
    expect(queryByText('Monolith')).toBeNull();     // Editorial but no name match
  });

  it('shows an empty state echoing the (trimmed, original-case) query when nothing matches', () => {
    const { getByLabelText, getByText, queryByText } = render(<TemplatePicker onClose={vi.fn()} onPick={vi.fn()} />);
    fireEvent.change(getByLabelText('Search templates'), { target: { value: '  zZzQ  ' } });
    expect(queryByText('Blank')).toBeNull();
    expect(getByText(/no templates match/i).textContent).toContain('zZzQ'); // trimmed + original case, not the lowercased match key
  });

  it('treats a whitespace-only query as empty — shows all, no empty state', () => {
    const { getByLabelText, getByText, queryByText } = render(<TemplatePicker onClose={vi.fn()} onPick={vi.fn()} />);
    fireEvent.change(getByLabelText('Search templates'), { target: { value: '   ' } });
    expect(getByText('Blank')).toBeTruthy();
    expect(getByText('Dossier')).toBeTruthy();
    expect(queryByText(/no templates match/i)).toBeNull();
  });

  it('restores all templates and hides the empty state when the query is cleared', () => {
    const { getByLabelText, getByText, queryByText } = render(<TemplatePicker onClose={vi.fn()} onPick={vi.fn()} />);
    const input = getByLabelText('Search templates');
    fireEvent.change(input, { target: { value: 'zzzzz' } });
    expect(getByText(/no templates match/i)).toBeTruthy();
    fireEvent.change(input, { target: { value: '' } });
    expect(getByText('Blank')).toBeTruthy();              // full list returns
    expect(getByText('Atlas')).toBeTruthy();
    expect(queryByText(/no templates match/i)).toBeNull(); // empty state gone
  });

  it('calls onPick with the matching template when a filtered card is clicked', () => {
    const onPick = vi.fn();
    const { getByLabelText, getByText } = render(<TemplatePicker onClose={vi.fn()} onPick={onPick} />);
    fireEvent.change(getByLabelText('Search templates'), { target: { value: 'led' } });
    fireEvent.click(getByText('Ledger')); // the lone remaining card
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 't6', name: 'Ledger' }));
  });
});
