import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import DesignPanel from './DesignPanel.jsx';

describe('DesignPanel', () => {
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

  it('renders without callbacks (read-only safe)', () => {
    expect(() => render(<DesignPanel deck={{}} />)).not.toThrow();
  });
});
