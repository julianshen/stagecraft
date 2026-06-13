import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import LaserPointer from './LaserPointer.jsx';

describe('LaserPointer', () => {
  it('renders nothing when disabled', () => {
    const { container } = render(<LaserPointer enabled={false} pos={{ x: 50, y: 50 }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when enabled but the pointer is off the slide (no pos)', () => {
    const { container } = render(<LaserPointer enabled pos={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('positions the dot at the tracked percentage when enabled', () => {
    const { container } = render(<LaserPointer enabled pos={{ x: 30, y: 70 }} />);
    const dot = container.querySelector('.laser-dot');
    expect(dot).toBeTruthy();
    expect(dot.style.left).toBe('30%');
    expect(dot.style.top).toBe('70%');
  });
});
