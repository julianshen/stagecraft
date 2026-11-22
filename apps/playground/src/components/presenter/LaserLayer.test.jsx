import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import LaserLayer from './LaserLayer.jsx';

describe('LaserLayer', () => {
  // The parent (PresenterView) mounts LaserLayer only while the laser is live,
  // so the component itself always renders its capture layer; unmounting is how
  // the dot state is reset.
  it('renders a capture layer with the dot hidden until the pointer moves', () => {
    const { container } = render(<LaserLayer />);
    expect(container.querySelector('.laser-layer')).toBeTruthy();
    expect(container.querySelector('.laser-dot')).toBeNull(); // no pointer move yet → no pos
  });

  it('handles pointer move and leave without crashing (no dot when the layer has no measurable area)', () => {
    const { container } = render(<LaserLayer />);
    const layer = container.querySelector('.laser-layer');
    // jsdom reports a zero-area rect, so pointerToPct returns null → dot hidden,
    // but the handlers still run. Move-before-enter exercises the rect fallback;
    // enter caches the rect for the moves that follow.
    fireEvent.pointerMove(layer, { clientX: 120, clientY: 80 }); // no cached rect → fallback read
    fireEvent.pointerEnter(layer, { clientX: 120, clientY: 80 }); // caches the rect
    fireEvent.pointerMove(layer, { clientX: 120, clientY: 80 }); // uses the cached rect
    expect(container.querySelector('.laser-dot')).toBeNull();
    fireEvent.pointerLeave(layer);
    expect(container.querySelector('.laser-dot')).toBeNull();
  });
});
