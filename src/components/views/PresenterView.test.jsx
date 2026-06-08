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

  it('renders without crashing when deck is null', () => {
    expect(() => render(<PresenterView deck={null} onExit={vi.fn()} />)).not.toThrow();
  });

  it('honors an explicitly cleared (empty) notes value', () => {
    const deck = {
      title: 'Demo',
      theme: 'indigo',
      sections: [{ id: 's1', name: 'Intro', slides: ['a'] }],
      slides: [{ id: 'a', layout: 'text', title: 'Alpha', notes: '' }],
    };
    render(<PresenterView deck={deck} onExit={vi.fn()} />);
    expect(screen.queryByText(/Drive the narrative/)).not.toBeInTheDocument();
  });

  it('shows notes authored on the slide (e.g. Co-pilot speaker notes)', () => {
    const deck = {
      title: 'Demo',
      theme: 'indigo',
      sections: [{ id: 's1', name: 'Intro', slides: ['a'] }],
      slides: [{ id: 'a', layout: 'text', title: 'Alpha', notes: 'Open with the customer pain.' }],
    };
    render(<PresenterView deck={deck} onExit={vi.fn()} />);
    expect(screen.getByText('Open with the customer pain.')).toBeInTheDocument();
  });
});
