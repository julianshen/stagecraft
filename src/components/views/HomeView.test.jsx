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

  it('opening a deck-actions menu does not open the deck', () => {
    const onOpenDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={onOpenDeck} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={noop} onDeleteDeck={noop} />);
    fireEvent.click(screen.getByTitle('Actions: Meet Stagecraft'));
    expect(onOpenDeck).not.toHaveBeenCalled();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('renames a deck inline via the actions menu', () => {
    const onRenameDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={onRenameDeck} onDeleteDeck={noop} />);
    fireEvent.click(screen.getByTitle('Actions: Meet Stagecraft'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('Meet Stagecraft');
    fireEvent.change(input, { target: { value: 'Q3 Review' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameDeck).toHaveBeenCalledWith('d1', 'Q3 Review');
    expect(onRenameDeck).toHaveBeenCalledTimes(1); // not double-fired by a follow-on blur
  });

  it('Escape cancels an inline rename without committing', () => {
    const onRenameDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={onRenameDeck} onDeleteDeck={noop} />);
    fireEvent.click(screen.getByTitle('Actions: Meet Stagecraft'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('Meet Stagecraft');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRenameDeck).not.toHaveBeenCalled();
  });

  it('deletes a deck only after an inline confirm', () => {
    const onDeleteDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={noop} onDeleteDeck={onDeleteDeck} />);
    fireEvent.click(screen.getByTitle('Actions: GTM Plan'));
    fireEvent.click(screen.getByText('Delete'));
    expect(onDeleteDeck).not.toHaveBeenCalled();     // first click only arms the confirm
    fireEvent.click(screen.getByText('Confirm delete'));
    expect(onDeleteDeck).toHaveBeenCalledWith('d2');
  });
});
