import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import SorterView from './SorterView.jsx';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('SorterView', () => {
  it('renders without crashing when deck is null', () => {
    expect(() =>
      render(<SorterView deck={null} onBack={vi.fn()} onOpenSlide={vi.fn()} />)
    ).not.toThrow();
  });

  it('renders without crashing when deck lacks a slides array', () => {
    const deck = { sections: [{ id: 's1', name: 'S', slides: ['a'] }] }; // no slides[]
    expect(() =>
      render(<SorterView deck={deck} onBack={vi.fn()} onOpenSlide={vi.fn()} />)
    ).not.toThrow();
  });
});
