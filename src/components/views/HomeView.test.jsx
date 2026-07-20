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

function switchToList() {
  fireEvent.click(screen.getByTitle('List view'));
}

describe('HomeView list view — rename and delete', () => {
  it('shows an actions button per list row', () => {
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={noop} onDeleteDeck={noop} />);
    switchToList();
    expect(screen.getByTitle('Actions: Meet Stagecraft')).toBeInTheDocument();
    expect(screen.getByTitle('Actions: GTM Plan')).toBeInTheDocument();
  });

  it('clicking actions opens a menu with Rename and Delete', () => {
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={noop} onDeleteDeck={noop} />);
    switchToList();
    fireEvent.click(screen.getByTitle('Actions: GTM Plan'));
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('clicking Rename shows an inline input pre-filled with the deck name', () => {
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={noop} onDeleteDeck={noop} />);
    switchToList();
    fireEvent.click(screen.getByTitle('Actions: GTM Plan'));
    fireEvent.click(screen.getByText('Rename'));
    expect(screen.getByDisplayValue('GTM Plan')).toBeInTheDocument();
  });

  it('Enter commits the rename and calls onRenameDeck exactly once', () => {
    const onRenameDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={onRenameDeck} onDeleteDeck={noop} />);
    switchToList();
    fireEvent.click(screen.getByTitle('Actions: GTM Plan'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('GTM Plan');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input); // settled ref must suppress double-fire
    expect(onRenameDeck).toHaveBeenCalledWith('d2', 'Renamed');
    expect(onRenameDeck).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels without calling onRenameDeck', () => {
    const onRenameDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={onRenameDeck} onDeleteDeck={noop} />);
    switchToList();
    fireEvent.click(screen.getByTitle('Actions: GTM Plan'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('GTM Plan');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input); // settled ref must suppress this
    expect(onRenameDeck).not.toHaveBeenCalled();
  });

  it('blur commits the rename', () => {
    const onRenameDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={onRenameDeck} onDeleteDeck={noop} />);
    switchToList();
    fireEvent.click(screen.getByTitle('Actions: GTM Plan'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('GTM Plan');
    fireEvent.change(input, { target: { value: 'Via Blur' } });
    fireEvent.blur(input);
    expect(onRenameDeck).toHaveBeenCalledWith('d2', 'Via Blur');
  });

  it('does not call onRenameDeck when value is blank', () => {
    const onRenameDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={onRenameDeck} onDeleteDeck={noop} />);
    switchToList();
    fireEvent.click(screen.getByTitle('Actions: GTM Plan'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('GTM Plan');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameDeck).not.toHaveBeenCalled();
  });

  it('delete requires two clicks (arm then confirm)', () => {
    const onDeleteDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={noop} onDeleteDeck={onDeleteDeck} />);
    switchToList();
    fireEvent.click(screen.getByTitle('Actions: GTM Plan'));
    fireEvent.click(screen.getByText('Delete'));
    expect(onDeleteDeck).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm delete'));
    expect(onDeleteDeck).toHaveBeenCalledWith('d2');
  });

  it('clicking a list row opens the deck', () => {
    const onOpenDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={onOpenDeck} onNewDeck={noop} onOpenTemplates={noop} />);
    switchToList();
    fireEvent.click(screen.getByText('Meet Stagecraft'));
    expect(onOpenDeck).toHaveBeenCalledWith('d1');
  });

  it('opening list actions menu does not open the deck', () => {
    const onOpenDeck = vi.fn();
    render(<HomeView decks={decks} onOpenDeck={onOpenDeck} onNewDeck={noop} onOpenTemplates={noop} onRenameDeck={noop} onDeleteDeck={noop} />);
    switchToList();
    fireEvent.click(screen.getByTitle('Actions: GTM Plan'));
    expect(onOpenDeck).not.toHaveBeenCalled();
  });
});

describe('search filtering', () => {
  it('shows all decks when searchQuery is empty', () => {
    render(<HomeView decks={decks} searchQuery="" onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    expect(screen.getAllByText('Meet Stagecraft').length).toBeGreaterThan(0);
    expect(screen.getAllByText('GTM Plan').length).toBeGreaterThan(0);
  });

  it('filters decks by name when searchQuery is set', () => {
    render(<HomeView decks={decks} searchQuery="GTM" onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    expect(screen.queryAllByText('Meet Stagecraft')).toHaveLength(0);
    expect(screen.getAllByText('GTM Plan').length).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    render(<HomeView decks={decks} searchQuery="gtm" onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    expect(screen.getAllByText('GTM Plan').length).toBeGreaterThan(0);
  });

  it('shows a no-match message when nothing matches', () => {
    render(<HomeView decks={decks} searchQuery="xyzzy" onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    expect(screen.getByText(/no decks match/i)).toBeInTheDocument();
  });

  it('shows total library count in sidebar badge even when search filters results', () => {
    // 2 decks total, only 1 matches "GTM" — sidebar badge should show 02 (total), not 01 (filtered)
    render(<HomeView decks={decks} searchQuery="GTM" onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    // The sidebar "All files" badge uses decks.length (2), not cards.length (1)
    const counts = document.querySelectorAll('.count');
    const allFilesCount = Array.from(counts).find(el => el.textContent === '02');
    expect(allFilesCount).toBeTruthy();
  });
});
