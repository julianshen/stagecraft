import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render } from '@testing-library/react';
import PresenterView from './PresenterView.jsx';

const origRO = globalThis.ResizeObserver;
beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { globalThis.ResizeObserver = origRO; });

const deck = {
  title: 'D',
  sections: [{ id: 's1', name: 'Main', slides: ['a', 'b', 'c', 'd', 'e'] }],
  slides: [
    { id: 'a', layout: 'cover', title: 'Cover' },
    { id: 'b', layout: 'text', title: 'B' },
    { id: 'c', layout: 'text', title: 'C' },
    { id: 'd', layout: 'text', title: 'D4' },
    { id: 'e', layout: 'thanks', title: 'Thanks' },
  ],
};

describe('PresenterView', () => {
  it('starts on the first slide (the cover), not the demo deep-link', () => {
    const { getByText } = render(<PresenterView deck={deck} onExit={vi.fn()} />);
    expect(getByText(/slide 1 of 5/)).toBeTruthy();
  });

  it('renders nothing for an empty deck', () => {
    const { container } = render(<PresenterView deck={null} onExit={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
