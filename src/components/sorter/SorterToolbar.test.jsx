import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SorterToolbar from './SorterToolbar.jsx';

describe('SorterToolbar', () => {
  it('marks the unbuilt section filter and sort as Soon and disabled', () => {
    render(<SorterToolbar mode="grid" setMode={vi.fn()} onBack={vi.fn()} />);
    for (const label of ['All sections', 'By order']) {
      const btn = screen.getByText(label).closest('button');
      expect(btn).toBeDisabled();
      expect(btn.querySelector('.soon-tag')).toBeTruthy();
    }
  });
});
