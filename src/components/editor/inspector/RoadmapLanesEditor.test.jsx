import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RoadmapLanesEditor from './RoadmapLanesEditor.jsx';
import { sanitizeSlidePatch } from '../../../lib/deckUtils.js';

const slide = {
  id: 'r1', layout: 'roadmap', title: 'R',
  lanes: [
    { name: 'Platform', items: [{ t: 0, d: 2, lbl: 'M1', state: 'done' }] },
    { name: 'Growth', items: [{ t: 1, d: 3, lbl: 'M2', state: 'planned' }] },
  ],
};

const renderEditor = (s = slide) => {
  const onApply = vi.fn();
  const utils = render(<RoadmapLanesEditor slide={s} onApply={onApply} />);
  return { ...utils, onApply };
};

describe('RoadmapLanesEditor', () => {
  it('renders lane names and item fields from the slide', () => {
    renderEditor();
    expect(screen.getByDisplayValue('Platform')).toBeInTheDocument();
    expect(screen.getByDisplayValue('M1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('M2')).toBeInTheDocument();
  });

  it('editing a label commits a full, gate-valid lanes patch', () => {
    const { onApply } = renderEditor();
    fireEvent.change(screen.getByDisplayValue('M1'), { target: { value: 'Milestone' } });
    const patch = onApply.mock.calls[0][0];
    expect(patch.lanes[0].items[0].lbl).toBe('Milestone');
    expect(sanitizeSlidePatch(patch, 'roadmap')).toEqual(patch); // survives the gate
  });

  it('numeric t/d edits commit as numbers; the state select commits a valid state', () => {
    const { onApply, container } = renderEditor();
    const nums = container.querySelectorAll('input[type="number"]');
    fireEvent.change(nums[0], { target: { value: '4' } }); // first item's t
    expect(onApply.mock.calls[0][0].lanes[0].items[0].t).toBe(4);
    const sel = container.querySelector('select');
    fireEvent.change(sel, { target: { value: 'atrisk' } });
    expect(onApply.mock.calls[1][0].lanes[0].items[0].state).toBe('atrisk');
  });

  it('adds and removes lanes and items, but never the last lane', () => {
    const { onApply, container } = renderEditor();
    fireEvent.click(screen.getByText('Add lane'));
    expect(onApply.mock.calls[0][0].lanes).toHaveLength(3);
    fireEvent.click(screen.getAllByText('Add milestone')[0]);
    expect(onApply.mock.calls[1][0].lanes[0].items).toHaveLength(2);
    fireEvent.click(container.querySelectorAll('[title="Remove milestone"]')[0]);
    expect(onApply.mock.calls[2][0].lanes[0].items).toHaveLength(0);
    fireEvent.click(container.querySelectorAll('[title="Remove lane"]')[1]);
    expect(onApply.mock.calls[3][0].lanes).toHaveLength(1);
    // single-lane slide: lane removal disabled
    const { container: c2 } = renderEditor({ ...slide, lanes: [slide.lanes[0]] });
    expect(c2.querySelector('[title="Remove lane"]').disabled).toBe(true);
  });

  it('materializes the demo lanes for a roadmap slide without explicit data', () => {
    renderEditor({ id: 'r2', layout: 'roadmap', title: 'R' });
    expect(screen.getByDisplayValue('Platform')).toBeInTheDocument(); // roadmapModel default lanes
    expect(screen.getByDisplayValue('Enterprise')).toBeInTheDocument();
  });
});
