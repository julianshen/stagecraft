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

  it('AC-7.3: filters decks by name when searchQuery is set', () => {
    render(<HomeView decks={decks} searchQuery="GTM" onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    expect(screen.queryAllByText('Meet Stagecraft')).toHaveLength(0);
    expect(screen.getAllByText('GTM Plan').length).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    render(<HomeView decks={decks} searchQuery="gtm" onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    expect(screen.getAllByText('GTM Plan').length).toBeGreaterThan(0);
  });

  it('AC-7.3: shows a no-match message when nothing matches', () => {
    render(<HomeView decks={decks} searchQuery="xyzzy" onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    expect(screen.getByText(/no decks match/i)).toBeInTheDocument();
  });

  it('AC-7.3: shows total library count in sidebar badge even when search filters results', () => {
    // 2 decks total, only 1 matches "GTM" — sidebar badge should show 02 (total), not 01 (filtered)
    render(<HomeView decks={decks} searchQuery="GTM" onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    // The sidebar "All files" badge uses decks.length (2), not cards.length (1)
    const counts = document.querySelectorAll('.count');
    const allFilesCount = Array.from(counts).find(el => el.textContent === '02');
    expect(allFilesCount).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Task 7 — Home honesty: wired Edited sort, Soon-disabled Filter + sidebar.
// ---------------------------------------------------------------------------

// Decks deliberately NOT in edited order, so a sort visibly reorders them.
const sortDecks = [
  { id: 'q1', name: 'Q1 Plan', slides: 3, theme: 'indigo',  updatedAt: 1_000, active: false },
  { id: 'nt', name: 'Notes',   slides: 5, theme: 'amber',   updatedAt: 2_000, active: false },
  { id: 'q2', name: 'Q2 Plan', slides: 8, theme: 'emerald', updatedAt: 3_000, active: false },
];

// DOM order of deck cards, mapped back to fixture names.
function cardOrder() {
  const names = sortDecks.map((d) => d.name);
  return Array.from(document.querySelectorAll('.deck-card'))
    .map((card) => names.find((n) => card.textContent.includes(n)));
}

describe('Edited sort (AC-7.1)', () => {
  it('AC-7.1: default order is the incoming deck order until sort is activated', () => {
    render(<HomeView decks={sortDecks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    expect(cardOrder()).toEqual(['Q1 Plan', 'Notes', 'Q2 Plan']);
  });

  it('AC-7.1: clicking Edited sorts by edited time desc, clicking again toggles asc', () => {
    render(<HomeView decks={sortDecks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    const btn = screen.getByRole('button', { name: /edited/i });
    fireEvent.click(btn);
    expect(cardOrder()).toEqual(['Q2 Plan', 'Notes', 'Q1 Plan']); // most recent first
    fireEvent.click(btn);
    expect(cardOrder()).toEqual(['Q1 Plan', 'Notes', 'Q2 Plan']); // oldest first
  });

  it('AC-7.1: the Edited button shows an active state once sorting is on', () => {
    render(<HomeView decks={sortDecks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    const btn = screen.getByRole('button', { name: /edited/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn.className).toContain('active');
  });

  it('AC-7.1: sort composes with an active search query (sorts the filtered list)', () => {
    render(<HomeView decks={sortDecks} searchQuery="plan" onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    expect(cardOrder()).toEqual(['Q1 Plan', 'Q2 Plan']); // filtered, default order
    fireEvent.click(screen.getByRole('button', { name: /edited/i }));
    expect(cardOrder()).toEqual(['Q2 Plan', 'Q1 Plan']); // filtered AND sorted desc
  });
});

// ---------------------------------------------------------------------------
// export-a11y-and-test-debt Task 2 — TEST-ONLY pins of the Edited sort edges.
// These encode shipped behavior; they must not require production changes.
// ---------------------------------------------------------------------------

describe('Edited sort edges (export-a11y-and-test-debt Task 2)', () => {
  // DOM order of deck cards (grid view), mapped back to the given names.
  const gridOrder = (names) =>
    Array.from(document.querySelectorAll('.deck-card'))
      .map((card) => names.find((n) => card.textContent.includes(n)));

  // DOM order of list rows (header row excluded), mapped back to the given names.
  const listOrder = (names) =>
    Array.from(document.querySelectorAll('.deck-table .row:not(.header)'))
      .map((row) => names.find((n) => row.textContent.includes(n)));

  it('AC-2.1: equal updatedAt decks keep their incoming relative order (stable tiebreak)', () => {
    const ties = [
      { id: 'a', name: 'Alpha', slides: 1, theme: 'indigo',  updatedAt: 5_000, active: false },
      { id: 'b', name: 'Bravo', slides: 2, theme: 'emerald', updatedAt: 5_000, active: false },
      { id: 'c', name: 'Charlie', slides: 3, theme: 'amber', updatedAt: 9_000, active: false },
    ];
    const names = ties.map((d) => d.name);
    render(<HomeView decks={ties} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /edited/i })); // desc
    // Charlie is newest; Alpha/Bravo tie and preserve incoming order.
    expect(gridOrder(names)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    fireEvent.click(screen.getByRole('button', { name: /edited/i })); // asc
    expect(gridOrder(names)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('AC-2.2: a deck with no updatedAt sorts last under newest-first (treated as oldest via ?? 0)', () => {
    const mixed = [
      { id: 'u', name: 'Undated', slides: 1, theme: 'indigo',  active: false }, // no updatedAt
      { id: 'o', name: 'Older',   slides: 2, theme: 'emerald', updatedAt: 1_000, active: false },
      { id: 'n', name: 'Newer',   slides: 3, theme: 'amber',   updatedAt: 2_000, active: false },
    ];
    const names = mixed.map((d) => d.name);
    render(<HomeView decks={mixed} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /edited/i })); // desc = newest first
    expect(gridOrder(names)).toEqual(['Newer', 'Older', 'Undated']);
  });

  it('AC-2.3: repeated clicks cycle incoming → desc → asc → desc, with aria-pressed and title tracking', () => {
    render(<HomeView decks={sortDecks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    const btn = screen.getByRole('button', { name: /edited/i });

    // State 0 — default: incoming order, sort inactive.
    expect(cardOrder()).toEqual(['Q1 Plan', 'Notes', 'Q2 Plan']);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveAttribute('title', 'Sort by edited time');

    // State 1 — desc: newest first.
    fireEvent.click(btn);
    expect(cardOrder()).toEqual(['Q2 Plan', 'Notes', 'Q1 Plan']);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('title', 'Sorted by edited · newest first');

    // State 2 — asc: oldest first.
    fireEvent.click(btn);
    expect(cardOrder()).toEqual(['Q1 Plan', 'Notes', 'Q2 Plan']);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('title', 'Sorted by edited · oldest first');

    // State 3 — back to desc, never back to null.
    fireEvent.click(btn);
    expect(cardOrder()).toEqual(['Q2 Plan', 'Notes', 'Q1 Plan']);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('title', 'Sorted by edited · newest first');
  });

  it('AC-2.4: activating sort in list view reorders rows identically to the grid order', () => {
    const names = sortDecks.map((d) => d.name);
    render(<HomeView decks={sortDecks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    switchToList();
    expect(listOrder(names)).toEqual(['Q1 Plan', 'Notes', 'Q2 Plan']); // incoming order
    fireEvent.click(screen.getByRole('button', { name: /edited/i })); // desc
    expect(listOrder(names)).toEqual(['Q2 Plan', 'Notes', 'Q1 Plan']); // same as grid desc order
  });
});

describe('Soon-disabled surfaces (AC-7.2)', () => {
  it('AC-7.2: the Filter button is disabled with a Soon tag and clicking it changes nothing', () => {
    render(<HomeView decks={sortDecks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    const btn = screen.getByRole('button', { name: /filter/i });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain('is-soon');
    expect(btn.querySelector('.soon-tag')).toBeTruthy();
    const before = cardOrder();
    fireEvent.click(btn);
    expect(cardOrder()).toEqual(before); // no reorder, no filtering
  });

  it('AC-7.2: Recent/Starred/Trash sidebar items are non-interactive with a Soon affordance', () => {
    render(<HomeView decks={sortDecks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    for (const label of ['Recent', 'Starred', 'Trash']) {
      const item = screen.getByText(label).closest('.side-item');
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(item.className).toContain('is-soon');
      expect(item.querySelector('.soon-tag')).toBeTruthy();
    }
  });

  it('AC-7.2: clicking a Soon sidebar item changes nothing — no filter, no active-state move', () => {
    render(<HomeView decks={sortDecks} onOpenDeck={noop} onNewDeck={noop} onOpenTemplates={noop} />);
    const before = cardOrder();
    const sideClasses = () => Array.from(document.querySelectorAll('.side-item')).map((el) => el.className);
    const classesBefore = sideClasses();
    fireEvent.click(screen.getByText('Recent'));
    fireEvent.click(screen.getByText('Trash'));
    expect(cardOrder()).toEqual(before);
    expect(sideClasses()).toEqual(classesBefore);
    // "All files" remains the one active item.
    const active = document.querySelectorAll('.side-item.active');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('All files');
  });
});
