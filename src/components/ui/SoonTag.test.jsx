import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SoonTag from './SoonTag.jsx';

// AC-3.1: SoonTag renders an accessible, non-interactive "Coming soon" marker.
describe('SoonTag (AC-3.1)', () => {
  it('exposes the accessible name "Coming soon"', () => {
    render(<SoonTag />);
    expect(screen.getByLabelText('Coming soon')).toBeInTheDocument();
  });

  it('shows the default "Soon" label text', () => {
    render(<SoonTag />);
    expect(screen.getByText('Soon')).toBeInTheDocument();
  });

  it('renders a custom label when provided', () => {
    render(<SoonTag label="Always on" />);
    expect(screen.getByText('Always on')).toBeInTheDocument();
  });

  it('a custom label speaks its own text, not "Coming soon"', () => {
    // "Always on" marks a live behavior (autosave), not a pending one —
    // announcing it as "Coming soon" would be wrong. Its accessible name is
    // its visible text.
    render(<SoonTag label="Always on" />);
    expect(screen.queryByLabelText('Coming soon')).not.toBeInTheDocument();
    expect(screen.getByText('Always on')).not.toHaveAttribute('aria-label');
  });

  it('is non-interactive (no button role)', () => {
    render(<SoonTag />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
