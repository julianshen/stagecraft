import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PresentationChart } from './PresentationChart.jsx';
afterEach(cleanup);
const chart = { kind: 'bar', categories: ['Q1', 'Q2'], series: [{ name: 'Revenue', values: [-10, 20] }] };
describe('portable chart preview', () => {
  it.each(['bar', 'line'])('renders %s with data accessible and bounded coordinates at extreme magnitudes', kind => {
    const { container } = render(<PresentationChart chart={{ ...chart, kind, series: [{ name: 'Revenue', values: [-Number.MAX_VALUE, Number.MAX_VALUE] }] }} />);
    expect(screen.getByRole('img', { name: `${kind} chart` })).toBeTruthy();
    expect(container.textContent).toContain('Revenue');
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(container.querySelector(kind === 'line' ? 'polyline' : 'rect[height="125"]')).toBeTruthy();
  });
  it('renders pie, single-slice circle and zero-value empty state', () => {
    const { container, rerender } = render(<PresentationChart chart={{ ...chart, kind: 'pie', series: [{ name: 'Mix', values: [10, 20] }] }} />);
    expect(container.querySelectorAll('path')).toHaveLength(2);
    rerender(<PresentationChart chart={{ ...chart, kind: 'pie', series: [{ name: 'Mix', values: [10, 0] }] }} />);
    expect(container.querySelector('circle')).toBeTruthy();
    rerender(<PresentationChart chart={{ ...chart, kind: 'pie', series: [{ name: 'Mix', values: [0, 0] }] }} />);
    expect(screen.getByText('No positive values')).toBeTruthy();
  });
  it('rejects unsupported/malformed charts and renders labels as text', () => {
    const { container, rerender } = render(<PresentationChart chart={{ ...chart, categories: ['<script>bad()</script>', 'Q2'] }} />);
    expect(container.querySelector('script')).toBeNull();
    for (const invalid of [null, { ...chart, kind: '3d' }, { ...chart, categories: [] }, { ...chart, series: [{ name: 'Bad', values: [NaN, 1] }] }, { ...chart, kind: 'pie' }, { ...chart, categories: ['Q1'] }]) {
      rerender(<PresentationChart chart={invalid} />);
      expect(screen.getByText('Chart preview unavailable')).toBeTruthy();
    }
  });
});
