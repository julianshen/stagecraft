import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import PresenterView from './PresenterView.jsx';

// ScaledSlide measures its container via ResizeObserver, which jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const shortDeck = {
  title: 'Demo',
  theme: 'indigo',
  sections: [{ id: 's1', name: 'Intro', slides: ['a', 'b'] }],
  slides: [
    { id: 'a', layout: 'text', title: 'Alpha', body: 'one' },
    { id: 'b', layout: 'text', title: 'Beta', body: 'two' },
  ],
};

describe('PresenterView', () => {
  it('opens on a valid slide for decks shorter than the default start index', () => {
    // The default start index is 3 (a demo deep-link). A 2-slide edited deck
    // must clamp it instead of pointing past the end and rendering nothing.
    render(<PresenterView deck={shortDeck} onExit={vi.fn()} />);
    expect(screen.getByText(/slide [12] of 2/i)).toBeInTheDocument();
  });
});
