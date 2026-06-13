import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ThumbsPane from './ThumbsPane.jsx';
import { flattenDeck } from '../../lib/deckOrder.js';

const origRO = globalThis.ResizeObserver;
beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { globalThis.ResizeObserver = origRO; });

const deck = {
  sections: [
    { id: 's1', name: 'Intro', slides: ['a', 'b'] },
    { id: 's2', name: 'End', slides: ['c'] },
  ],
  slides: [{ id: 'a', layout: 'cover' }, { id: 'b', layout: 'text' }, { id: 'c', layout: 'thanks' }],
};
const renderSlide = () => <div data-testid="slide" />;

function renderPane(onReorder) {
  return render(
    <ThumbsPane
      flat={flattenDeck(deck)}
      sections={deck.sections}
      curId="a"
      onPick={() => {}}
      renderSlide={renderSlide}
      deckCtx={{ deck }}
      onReorder={onReorder}
    />,
  );
}
const thumb = (c, sid) => c.querySelector(`[data-sid="${sid}"]`);

describe('ThumbsPane drag-to-reorder', () => {
  it('drops a slide before the one it lands on (across sections)', () => {
    const onReorder = vi.fn();
    const { container } = renderPane(onReorder);
    fireEvent.dragStart(thumb(container, 'c'));
    fireEvent.dragOver(thumb(container, 'a'));
    fireEvent.drop(thumb(container, 'a'));
    expect(onReorder).toHaveBeenCalledWith('c', 's1', 0); // c → before a in Intro
  });

  it('reorders within a section', () => {
    const onReorder = vi.fn();
    const { container } = renderPane(onReorder);
    fireEvent.dragStart(thumb(container, 'b'));
    fireEvent.drop(thumb(container, 'a')); // b before a
    expect(onReorder).toHaveBeenCalledWith('b', 's1', 0);
  });

  it('ignores a drop onto the dragged slide itself', () => {
    const onReorder = vi.fn();
    const { container } = renderPane(onReorder);
    fireEvent.dragStart(thumb(container, 'a'));
    fireEvent.drop(thumb(container, 'a'));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('clears the dragged slide on drag end, so a later stray drop does nothing', () => {
    const onReorder = vi.fn();
    const { container } = renderPane(onReorder);
    fireEvent.dragStart(thumb(container, 'c'));
    fireEvent.dragEnd(thumb(container, 'c')); // drag abandoned (dropped outside a thumb)
    fireEvent.drop(thumb(container, 'a'));     // an unrelated/stray drop
    expect(onReorder).not.toHaveBeenCalled();
  });
});

describe('ThumbsPane memoization', () => {
  // Mimic flattenDeck's behavior precisely: wrappers are FRESH objects on
  // every call (so memo can't rely on wrapper identity), while untouched
  // slides keep field-value identity (applySlidePatch's contract).
  const wrap = (slides, secs) =>
    secs.flatMap((sec) => sec.slides.map((sid) => ({ ...slides.find((s) => s.id === sid), sectionId: sec.id, sectionName: sec.name })));

  const baseSlides = [
    { id: 'a', layout: 'cover', title: 'A' },
    { id: 'b', layout: 'text', title: 'B' },
    { id: 'c', layout: 'text', title: 'C' },
  ];
  const oneSection = [{ id: 's1', name: 'Main', slides: ['a', 'b', 'c'] }];
  const memoDeck = { title: 'D', author: 'Me', theme: 'indigo', slides: baseSlides, sections: oneSection };

  function renderMemoPane(overrides = {}) {
    const renderSlide = vi.fn(() => <div data-testid="mini" />);
    const props = {
      flat: wrap(baseSlides, oneSection),
      sections: oneSection,
      curId: 'a',
      onPick: vi.fn(),
      renderSlide,
      deckCtx: { deck: memoDeck },
      onNewSlide: vi.fn(),
      onReorder: vi.fn(),
      ...overrides,
    };
    const utils = render(<ThumbsPane {...props} />);
    return { ...utils, renderSlide, props };
  }

  it('re-renders only the edited slide thumbnail on a content edit', () => {
    const { rerender, renderSlide, props } = renderMemoPane();
    renderSlide.mockClear();
    const editedSlides = baseSlides.map((s) => (s.id === 'b' ? { ...s, title: 'B2' } : s));
    const editedDeck = { ...memoDeck, slides: editedSlides };
    rerender(<ThumbsPane {...props} flat={wrap(editedSlides, oneSection)} deckCtx={{ deck: editedDeck }} />);
    expect(renderSlide).toHaveBeenCalledTimes(1);
    expect(renderSlide.mock.calls[0][0].title).toBe('B2');
  });

  it('re-renders at most the two affected thumbs when the selection moves', () => {
    const { rerender, renderSlide, props, container } = renderMemoPane();
    renderSlide.mockClear();
    rerender(<ThumbsPane {...props} curId="b" />);
    expect(renderSlide.mock.calls.length).toBeLessThanOrEqual(2);
    expect(container.querySelector('[data-sid="b"]').className).toContain('active');
  });

  it('re-renders every thumb when deck chrome (theme) changes', () => {
    const { rerender, renderSlide, props } = renderMemoPane();
    renderSlide.mockClear();
    rerender(<ThumbsPane {...props} deckCtx={{ deck: { ...memoDeck, theme: 'coral' } }} />);
    expect(renderSlide).toHaveBeenCalledTimes(3);
  });

  it('re-renders every thumb on a section-order change (drop handlers must refresh)', () => {
    const { rerender, renderSlide, props } = renderMemoPane();
    renderSlide.mockClear();
    const reordered = [{ id: 's1', name: 'Main', slides: ['a', 'c', 'b'] }];
    rerender(<ThumbsPane {...props} sections={reordered} flat={wrap(baseSlides, reordered)} />);
    // b/c swapped positions; a's number is unchanged but its section's order
    // changed, so its (closure-captured) drop handler must be rebuilt too.
    expect(renderSlide).toHaveBeenCalledTimes(3);
  });
});
