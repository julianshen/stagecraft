// <SlideCanvas> logic that needs no real canvas (jsdom): following a change of
// devicePixelRatio, e.g. a window dragged to a retina display.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import SlideCanvas from './SlideCanvas.jsx';

const listeners = new Set();
const original = window.devicePixelRatio;
afterEach(() => {
  Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true });
  vi.restoreAllMocks();
  listeners.clear();
});

describe('<SlideCanvas> and devicePixelRatio', () => {
  it('resizes its backing store when the screen\'s pixel ratio changes', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    window.matchMedia = vi.fn(() => ({ addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f) }));
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    const { container } = render(<SlideCanvas slide={{ id: 's', layout: 'blank' }} deck={{}} width={200} />);
    const canvas = container.querySelector('canvas');
    expect(canvas.width).toBe(200);
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    act(() => listeners.forEach((f) => f()));
    expect(canvas.width).toBe(400);
  });

  it('keeps following the ratio past its cap: 3 → 4 (still drawn at 3) → 2 redraws at 2', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    // A real resolution query fires only when its match flips: when the ratio
    // leaves or reaches the value it names.
    const queries = new Map();
    window.matchMedia = vi.fn((q) => ({
      addEventListener: (_, f) => queries.set(f, q),
      removeEventListener: (_, f) => queries.delete(f),
    }));
    const setDpr = (to) => {
      const from = window.devicePixelRatio;
      Object.defineProperty(window, 'devicePixelRatio', { value: to, configurable: true });
      const flipped = [`(resolution: ${from}dppx)`, `(resolution: ${to}dppx)`];
      act(() => [...queries].filter(([, q]) => flipped.includes(q)).forEach(([f]) => f()));
    };
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    const { container } = render(<SlideCanvas slide={{ id: 's', layout: 'blank' }} deck={{}} width={200} />);
    const canvas = container.querySelector('canvas');
    expect(canvas.width).toBe(600);
    setDpr(4);
    expect(canvas.width).toBe(600); // capped at 3
    setDpr(2);
    expect(canvas.width).toBe(400);
  });
});
