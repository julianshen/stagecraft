import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DataPanel from './DataPanel.jsx';
import InspectorPane from './InspectorPane.jsx';

const chartSlide = { id: 'c1', layout: 'chart', chartType: 'bar', chart: { categories: ['Q1'], series: [{ name: 'A', values: [1] }] } };

describe('DataPanel', () => {
  it('routes chart/roadmap/agenda/list slides to their data editors', () => {
    render(<DataPanel slide={chartSlide} onApply={vi.fn()} />);
    expect(screen.getByText('Add series')).toBeInTheDocument();
    render(<DataPanel slide={{ id: 'r', layout: 'roadmap' }} onApply={vi.fn()} />);
    expect(screen.getByText('Add lane')).toBeInTheDocument();
    render(<DataPanel slide={{ id: 'a', layout: 'agenda', items: [] }} onApply={vi.fn()} />);
    expect(screen.getByText('Agenda items')).toBeInTheDocument();
    render(<DataPanel slide={{ id: 'l', layout: 'list', items: [] }} onApply={vi.fn()} />);
    expect(screen.getByText('List items')).toBeInTheDocument();
  });

  it('shows an unavailable hint when no apply path is wired (generic shell embeds)', () => {
    render(<DataPanel slide={chartSlide} onApply={undefined} />);
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });

  it('shows a hint for slides without editable data, and when nothing is selected', () => {
    render(<DataPanel slide={{ id: 't', layout: 'text' }} onApply={vi.fn()} />);
    expect(screen.getByText(/chart, roadmap, agenda, and list slides/i)).toBeInTheDocument();
    render(<DataPanel slide={null} onApply={vi.fn()} />);
    expect(screen.getByText(/Select a slide/i)).toBeInTheDocument();
  });
});

describe('InspectorPane Data tab', () => {
  it('offers a Data tab that renders the DataPanel for the current slide', () => {
    render(
      <InspectorPane tab="data" setTab={vi.fn()} selection={null} setSelection={vi.fn()} count={0}
        slide={chartSlide} onApplyPatch={vi.fn()} />,
    );
    expect(screen.getByText('Data')).toBeInTheDocument();
    expect(screen.getByText('Add series')).toBeInTheDocument();
  });

  it('tolerates nullish category/name values without uncontrolled-input flips', () => {
    const ragged = { id: 'c9', layout: 'chart', chartType: 'bar', chart: { categories: ['Q1', null], series: [{ values: [1, 2] }] } };
    const { container } = render(<DataPanel slide={ragged} onApply={vi.fn()} />);
    for (const input of container.querySelectorAll('input')) {
      expect(input.value).not.toBe('null');
      expect(input.value).not.toBe('undefined');
    }
  });
});
