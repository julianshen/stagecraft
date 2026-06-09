import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HomeView from './HomeView.jsx';

const decks = [
  { id: 'd1', name: 'Meet Stagecraft', slides: 14, theme: 'indigo', updatedAt: Date.now(), active: true },
  { id: 'd2', name: 'GTM Plan', slides: 8, theme: 'emerald', updatedAt: Date.now() - 3_600_000, active: false },
];
const noop = () => {};

describe('HomeView', () => {
  it('renders the real decks from the library', () => {
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    // The name appears on the cover and in the info title — at least one each.
    expect(screen.getAllByText('Meet Stagecraft').length).toBeGreaterThan(0);
    expect(screen.getAllByText('GTM Plan').length).toBeGreaterThan(0);
  });

  it('opens a deck by id when its card is clicked', () => {
    const onOpenDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={onOpenDeck} onNewDeck={noop} onOpenTemplates={noop} />);
    fireEvent.click(screen.getAllByText('GTM Plan')[0]); // bubbles to the card
    expect(onOpenDeck).toHaveBeenCalledWith('d2');
  });

  it('creates a new deck from the blank-deck card', () => {
    const onNewDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={onNewDeck} onOpenTemplates={noop} />);
    fireEvent.click(screen.getByText('Blank deck'));
    expect(onNewDeck).toHaveBeenCalled();
  });

  it('shows an empty state when the library has no decks', () => {
    render(<HomeView decks={[]} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    expect(screen.getByText(/no decks yet/i)).toBeInTheDocument();
  });
});
