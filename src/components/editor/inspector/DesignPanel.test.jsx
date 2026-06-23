import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import DesignPanel from './DesignPanel.jsx';

describe('DesignPanel', () => {
  it('renders the real slide layouts and marks the current slide\'s layout active', () => {
    const { getByLabelText } = render(<DesignPanel deck={{ theme: 'indigo' }} current="chart" onChangeLayout={vi.fn()} onChangeTheme={vi.fn()} onAddComponent={vi.fn()} />);
    expect(getByLabelText('Chart layout').className).toContain('on');     // current layout highlighted
    expect(getByLabelText('Cover layout').className).not.toContain('on'); // others are not
  });

  it('swaps the slide layout when a layout card is clicked', () => {
    const onChangeLayout = vi.fn();
    const { getByLabelText } = render(<DesignPanel deck={{ theme: 'slate' }} current="cover" onChangeLayout={onChangeLayout} onChangeTheme={vi.fn()} onAddComponent={vi.fn()} />);
    fireEvent.click(getByLabelText('Table layout'));
    expect(onChangeLayout).toHaveBeenCalledWith('table');
  });

  it('marks the deck\'s current theme swatch active and applies another on click', () => {
    const onChangeTheme = vi.fn();
    const { getByLabelText } = render(<DesignPanel deck={{ theme: 'indigo' }} onChangeTheme={onChangeTheme} onAddComponent={vi.fn()} />);
    expect(getByLabelText('indigo theme').className).toContain('active');
    expect(getByLabelText('emerald theme').className).not.toContain('active');
    fireEvent.click(getByLabelText('emerald theme'));
    expect(onChangeTheme).toHaveBeenCalledWith('emerald');
  });

  it('inserts a component when its chip is clicked', () => {
    const onAddComponent = vi.fn();
    const { getByTitle } = render(<DesignPanel deck={{ theme: 'slate' }} onChangeTheme={vi.fn()} onAddComponent={onAddComponent} />);
    fireEvent.click(getByTitle('Add KPI'));
    expect(onAddComponent).toHaveBeenCalledWith('kpi');
    fireEvent.click(getByTitle('Add Roadmap'));
    expect(onAddComponent).toHaveBeenCalledWith('roadmap');
  });

  it('shows the active deck theme\'s accent in the Tokens section, not a hardcoded one', () => {
    const { getByText, queryByText } = render(<DesignPanel deck={{ theme: 'emerald' }} onChangeTheme={vi.fn()} onAddComponent={vi.fn()} />);
    // emerald = chroma 0.13, hue 155 — the token must follow the deck theme
    expect(getByText('oklch(.62/.13/155)')).toBeInTheDocument();
    // …and the old hardcoded indigo accent must be gone for a non-indigo deck
    expect(queryByText('oklch(.62/.17/265)')).toBeNull();
  });

  it('falls back to the first theme\'s accent when the deck has no theme', () => {
    const { getByText } = render(<DesignPanel deck={{}} onChangeTheme={vi.fn()} onAddComponent={vi.fn()} />);
    // THEME_OPTIONS[0] is indigo (chroma 0.17, hue 265)
    expect(getByText('oklch(.62/.17/265)')).toBeInTheDocument();
  });

  it('renders without callbacks (read-only safe)', () => {
    expect(() => render(<DesignPanel deck={{}} />)).not.toThrow();
  });
});
