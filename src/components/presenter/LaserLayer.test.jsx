import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import LaserLayer from './LaserLayer.jsx';

describe('LaserLayer', () => {
  it('renders nothing when disabled — no capture layer, no listeners', () => {
    const { container } = render(<LaserLayer enabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('mounts a capture layer when enabled (dot stays hidden until the pointer moves)', () => {
    const { container } = render(<LaserLayer enabled />);
    expect(container.querySelector('.laser-layer')).toBeTruthy();
    expect(container.querySelector('.laser-dot')).toBeNull(); // no pointer move yet → no pos
  });

  it('handles pointer move and leave without crashing (no dot when the layer has no measurable area)', () => {
    const { container } = render(<LaserLayer enabled />);
    const layer = container.querySelector('.laser-layer');
    // jsdom reports a zero-area rect, so pointerToPct returns null → dot hidden,
    // but the move/leave handlers still run.
    fireEvent.pointerMove(layer, { clientX: 120, clientY: 80 });
    expect(container.querySelector('.laser-dot')).toBeNull();
    fireEvent.pointerLeave(layer);
    expect(container.querySelector('.laser-dot')).toBeNull();
  });
});
