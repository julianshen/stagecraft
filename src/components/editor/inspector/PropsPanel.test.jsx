import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PropsPanel from './PropsPanel.jsx';

// Distinct x/y/w/h so getByDisplayValue('0'|'100') uniquely hits angle/opacity.
const el = { id: 'e1', type: 'text', x: 120, y: 140, w: 300, h: 80, content: 'Old', rot: 0, opacity: 100 };

describe('PropsPanel', () => {
  it('prompts to select when nothing is selected', () => {
    render(<PropsPanel selected={null} setSelected={vi.fn()} />);
    expect(screen.getByText(/Select an element/i)).toBeInTheDocument();
  });

  it('shows a multi-selection message when more than one element is selected', () => {
    render(<PropsPanel selected={null} setSelected={vi.fn()} count={3} />);
    expect(screen.getByText(/3 elements selected/i)).toBeInTheDocument();
  });

  it('edits the text content of a text element', async () => {
    const setSelected = vi.fn();
    render(<PropsPanel selected={el} setSelected={setSelected} />);
    const area = screen.getByDisplayValue('Old');
    await userEvent.type(area, '!');
    expect(setSelected).toHaveBeenCalledWith(expect.objectContaining({ content: 'Old!' }));
  });

  it('binds angle and opacity to the element', () => {
    const setSelected = vi.fn();
    render(<PropsPanel selected={el} setSelected={setSelected} />);
    fireEvent.change(screen.getByDisplayValue('0'), { target: { value: '90' } });   // ANGLE
    expect(setSelected).toHaveBeenCalledWith(expect.objectContaining({ rot: 90 }));
    fireEvent.change(screen.getByDisplayValue('100'), { target: { value: '40' } }); // OPACITY
    expect(setSelected).toHaveBeenCalledWith(expect.objectContaining({ opacity: 40 }));
  });

  it('clamps opacity to 0–100', () => {
    const setSelected = vi.fn();
    render(<PropsPanel selected={el} setSelected={setSelected} />);
    fireEvent.change(screen.getByDisplayValue('100'), { target: { value: '500' } });
    expect(setSelected).toHaveBeenCalledWith(expect.objectContaining({ opacity: 100 }));
  });

  it('binds the fill color', () => {
    const setSelected = vi.fn();
    render(<PropsPanel selected={el} setSelected={setSelected} />);
    fireEvent.change(screen.getByLabelText('Fill color'), { target: { value: '#abcdef' } });
    expect(setSelected).toHaveBeenCalledWith(expect.objectContaining({ fill: '#abcdef' }));
  });

  it('normalizes the fill into a lowercase 6-digit hex for the color input', () => {
    const shorthand = { id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#ABC' };
    const { rerender } = render(<PropsPanel selected={shorthand} setSelected={vi.fn()} />);
    expect(screen.getByLabelText('Fill color').value).toBe('#aabbcc');
    rerender(<PropsPanel selected={{ ...shorthand, fill: 'oklch(0.6 0.1 200)' }} setSelected={vi.fn()} />);
    expect(screen.getByLabelText('Fill color').value).toBe('#4f46e5'); // non-hex → fallback
  });

  it('hides the Content field for non-text elements', () => {
    render(<PropsPanel selected={{ id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 100 }} setSelected={vi.fn()} />);
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });
});
