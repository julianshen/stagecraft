import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import NotesPanel from './NotesPanel.jsx';
import { SPEAKER_NOTES } from '../../../data/deck.js';

describe('NotesPanel', () => {
  it('shows authored notes and commits an edit via onApply', () => {
    const onApply = vi.fn();
    const { getByLabelText } = render(<NotesPanel slide={{ id: 'x', notes: 'My notes' }} onApply={onApply} />);
    const ta = getByLabelText('Speaker notes');
    expect(ta.value).toBe('My notes');
    fireEvent.change(ta, { target: { value: 'Updated' } });
    expect(onApply).toHaveBeenCalledWith({ notes: 'Updated' });
  });

  it('materializes the bundled fallback notes as editable starting text (what the export uses)', () => {
    // An unauthored slide with a bundled SPEAKER_NOTES entry shows it — the same
    // "fallback as editable" pattern the chart/roadmap data editors follow.
    const { getByLabelText } = render(<NotesPanel slide={{ id: 'cover' }} onApply={vi.fn()} />);
    expect(getByLabelText('Speaker notes').value).toBe(SPEAKER_NOTES.cover);
  });

  it('commits an empty string when cleared — an intentional "no notes"', () => {
    const onApply = vi.fn();
    const { getByLabelText } = render(<NotesPanel slide={{ id: 'x', notes: 'X' }} onApply={onApply} />);
    fireEvent.change(getByLabelText('Speaker notes'), { target: { value: '' } });
    expect(onApply).toHaveBeenCalledWith({ notes: '' });
  });

  it('is read-only safe with no onApply / no slide — empty value, change does not throw', () => {
    const { getByLabelText } = render(<NotesPanel />);
    const ta = getByLabelText('Speaker notes');
    expect(ta.value).toBe(''); // resolveNotes(undefined) → '' (no crash, no stale fallback)
    expect(() => fireEvent.change(ta, { target: { value: 'x' } })).not.toThrow();
  });
});
