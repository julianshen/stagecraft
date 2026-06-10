import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, fireEvent, within, waitFor } from '@testing-library/react';
import SorterView from './SorterView.jsx';
import { suggestSlideOrder } from '../../lib/llmClient.js';

vi.mock('../../lib/llmClient.js', () => ({ suggestSlideOrder: vi.fn() }));

const origRO = globalThis.ResizeObserver;
beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { globalThis.ResizeObserver = origRO; });
beforeEach(() => { suggestSlideOrder.mockReset(); });

const makeDeck = () => ({
  title: 'Deck',
  author: 'Tester',
  sections: [
    { id: 's1', name: 'Intro', slides: ['a', 'b'] },
    { id: 's2', name: 'End', slides: ['c'] },
  ],
  slides: [
    { id: 'a', layout: 'cover', title: 'A' },
    { id: 'b', layout: 'text', title: 'B' },
    { id: 'c', layout: 'thanks', title: 'C' },
  ],
});

// onDeckChange is given a functional updater; apply it to a deck to get the result.
const applyUpdater = (spy, deck, call = 0) => {
  const updater = spy.mock.calls[call][0];
  return updater(deck);
};

function renderSorter(extra = {}) {
  const onDeckChange = vi.fn();
  const utils = render(
    <SorterView deck={makeDeck()} onBack={vi.fn()} onOpenSlide={vi.fn()} onDeckChange={onDeckChange} {...extra} />,
  );
  return { ...utils, onDeckChange };
}
const card = (c, sid) => c.querySelector(`[data-sid="${sid}"]`);

describe('SorterView — backward compatible', () => {
  it('renders without crashing when deck is null', () => {
    expect(() => render(<SorterView deck={null} onBack={vi.fn()} onOpenSlide={vi.fn()} />)).not.toThrow();
  });

  it('renders without crashing when deck lacks a slides array', () => {
    const deck = { sections: [{ id: 's1', name: 'S', slides: ['a'] }] };
    expect(() => render(<SorterView deck={deck} onBack={vi.fn()} onOpenSlide={vi.fn()} />)).not.toThrow();
  });
});

describe('SorterView — drag to reorder', () => {
  it('drops a card before the one it lands on, via moveSlide', () => {
    const { container, onDeckChange } = renderSorter();
    fireEvent.dragStart(card(container, 'c'));
    fireEvent.dragOver(card(container, 'a'));
    fireEvent.drop(card(container, 'a')); // c → before a in Intro
    expect(onDeckChange).toHaveBeenCalledTimes(1);
    const next = applyUpdater(onDeckChange, makeDeck());
    expect(next.sections[0].slides).toEqual(['c', 'a', 'b']);
    expect(next.sections[1].slides).toEqual([]);
  });

  it('ignores a drop onto the dragged card itself', () => {
    const { container, onDeckChange } = renderSorter();
    fireEvent.dragStart(card(container, 'a'));
    fireEvent.drop(card(container, 'a'));
    expect(onDeckChange).not.toHaveBeenCalled();
  });

  it('drops a card into an empty section via the section drop zone', () => {
    const withEmpty = {
      title: 'Deck',
      sections: [
        { id: 's1', name: 'Intro', slides: ['a', 'b'] },
        { id: 's2', name: 'Empty', slides: [] },
      ],
      slides: [{ id: 'a', layout: 'cover', title: 'A' }, { id: 'b', layout: 'text', title: 'B' }],
    };
    const onDeckChange = vi.fn();
    const { container } = render(
      <SorterView deck={withEmpty} onBack={vi.fn()} onOpenSlide={vi.fn()} onDeckChange={onDeckChange} />,
    );
    // The empty section shows a visible "Drop slides here" target inside its drop zone.
    const zone = container.querySelector('[data-section-drop="s2"]');
    expect(within(zone).getByText('Drop slides here')).toBeTruthy();
    fireEvent.dragStart(card(container, 'a'));
    fireEvent.drop(zone); // a → into the empty section
    const next = onDeckChange.mock.calls[0][0](withEmpty);
    expect(next.sections[1].slides).toEqual(['a']);
    expect(next.sections[0].slides).toEqual(['b']);
  });
});

describe('SorterView — section CRUD', () => {
  it('adds a section from the toolbar', () => {
    const { getByText, onDeckChange } = renderSorter();
    fireEvent.click(getByText('New section'));
    const next = applyUpdater(onDeckChange, makeDeck());
    expect(next.sections).toHaveLength(3);
    expect(next.sections[2].name).toBe('New section');
  });

  it('renames a section through its inline editor', () => {
    const { container, onDeckChange } = renderSorter();
    fireEvent.click(within(container).getAllByTitle('Rename section')[0]);
    const input = container.querySelector('input.sorter-rename');
    fireEvent.change(input, { target: { value: 'Overview' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const next = applyUpdater(onDeckChange, makeDeck());
    expect(next.sections[0].name).toBe('Overview');
  });

  it('deletes a section (merging its slides into a neighbour)', () => {
    const { container, onDeckChange } = renderSorter();
    fireEvent.click(within(container).getAllByTitle('Delete section')[1]); // delete End
    const next = applyUpdater(onDeckChange, makeDeck());
    expect(next.sections.map((s) => s.id)).toEqual(['s1']);
    expect(next.sections[0].slides).toEqual(['a', 'b', 'c']);
  });

  it('disables Delete when only one section remains (the no-op is not a dead click)', () => {
    const oneSection = { title: 'Deck', sections: [{ id: 's1', name: 'Only', slides: ['a'] }], slides: [{ id: 'a', layout: 'cover', title: 'A' }] };
    const onDeckChange = vi.fn();
    const { container } = render(
      <SorterView deck={oneSection} onBack={vi.fn()} onOpenSlide={vi.fn()} onDeckChange={onDeckChange} />,
    );
    const del = within(container).getByTitle('Delete section');
    expect(del.disabled).toBe(true);
    fireEvent.click(del);
    expect(onDeckChange).not.toHaveBeenCalled();
  });

  it('hides editing controls when no onDeckChange is provided (read-only)', () => {
    const { container } = render(
      <SorterView deck={makeDeck()} onBack={vi.fn()} onOpenSlide={vi.fn()} />,
    );
    expect(container.querySelector('[title="Delete section"]')).toBeNull();
    expect(card(container, 'a').getAttribute('draggable')).not.toBe('true');
  });

  it('cancels a rename on Escape without committing', () => {
    const { container, onDeckChange } = renderSorter();
    fireEvent.click(within(container).getAllByTitle('Rename section')[0]);
    const input = container.querySelector('input.sorter-rename');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onDeckChange).not.toHaveBeenCalled();
    expect(container.querySelector('input.sorter-rename')).toBeNull(); // exited edit mode
  });

  it('commits a rename on blur', () => {
    const { container, onDeckChange } = renderSorter();
    fireEvent.click(within(container).getAllByTitle('Rename section')[0]);
    const input = container.querySelector('input.sorter-rename');
    fireEvent.change(input, { target: { value: 'Overview' } });
    fireEvent.blur(input);
    expect(applyUpdater(onDeckChange, makeDeck()).sections[0].name).toBe('Overview');
  });

  it('a stray drop after drag-end does nothing', () => {
    const { container, onDeckChange } = renderSorter();
    fireEvent.dragStart(card(container, 'c'));
    fireEvent.dragEnd(card(container, 'c'));
    fireEvent.drop(card(container, 'a'));
    expect(onDeckChange).not.toHaveBeenCalled();
  });
});

describe('SorterView — navigation', () => {
  it('selects a card on click and opens it on double-click', () => {
    const onOpenSlide = vi.fn();
    const { container } = renderSorter({ onOpenSlide });
    fireEvent.click(card(container, 'b'));
    expect(card(container, 'b').className).toContain('active');
    fireEvent.doubleClick(card(container, 'b'));
    expect(onOpenSlide).toHaveBeenCalledWith(1); // b is flat index 1
  });

  it('renders the outline mode when toggled', () => {
    const { getByText, container } = renderSorter();
    fireEvent.click(getByText('Outline'));
    // outline rows carry the slide titles; grid cards (data-sid) are gone
    expect(getByText('A')).toBeTruthy();
    expect(card(container, 'a')).toBeNull();
  });
});

describe('SorterView — Rearrange with AI', () => {
  it('asks the model for an order and applies it via the deck updater', async () => {
    suggestSlideOrder.mockResolvedValue(['c', 'a', 'b']);
    const { getByText, onDeckChange } = renderSorter();
    fireEvent.click(getByText('Rearrange with AI'));
    await waitFor(() => expect(onDeckChange).toHaveBeenCalledTimes(1));
    expect(suggestSlideOrder).toHaveBeenCalledWith(expect.objectContaining({ title: 'Deck' }));
    const next = applyUpdater(onDeckChange, makeDeck());
    // section counts preserved: Intro keeps 2, End keeps 1
    expect(next.sections[0].slides).toEqual(['c', 'a']);
    expect(next.sections[1].slides).toEqual(['b']);
  });

  it('shows a busy label while the request is in flight', async () => {
    let resolve;
    suggestSlideOrder.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { getByText, queryByText } = renderSorter();
    fireEvent.click(getByText('Rearrange with AI'));
    expect(getByText('Rearranging…')).toBeTruthy();
    resolve(null);
    await waitFor(() => expect(queryByText('Rearranging…')).toBeNull());
  });

  it('does nothing (no deck change) when the model returns null or throws', async () => {
    suggestSlideOrder.mockResolvedValue(null);
    const { getByText, onDeckChange } = renderSorter();
    fireEvent.click(getByText('Rearrange with AI'));
    await waitFor(() => expect(getByText('Rearrange with AI')).toBeTruthy());
    expect(onDeckChange).not.toHaveBeenCalled();

    suggestSlideOrder.mockRejectedValue(new Error('no api key'));
    fireEvent.click(getByText('Rearrange with AI'));
    await waitFor(() => expect(getByText('Rearrange with AI')).toBeTruthy());
    expect(onDeckChange).not.toHaveBeenCalled();
  });

  it('hides the button in read-only mode (no onDeckChange)', () => {
    const { queryByText } = render(
      <SorterView deck={makeDeck()} onBack={vi.fn()} onOpenSlide={vi.fn()} />,
    );
    expect(queryByText('Rearrange with AI')).toBeNull();
  });

  it('skips the API call when there are fewer than 2 slides to reorder', () => {
    const oneSlide = {
      title: 'D',
      sections: [{ id: 's1', name: 'Only', slides: ['a'] }],
      slides: [{ id: 'a', layout: 'cover', title: 'A' }],
    };
    const onDeckChange = vi.fn();
    const { getByText } = render(
      <SorterView deck={oneSlide} onBack={vi.fn()} onOpenSlide={vi.fn()} onDeckChange={onDeckChange} />,
    );
    fireEvent.click(getByText('Rearrange with AI'));
    expect(suggestSlideOrder).not.toHaveBeenCalled();
    expect(onDeckChange).not.toHaveBeenCalled();
  });
});
