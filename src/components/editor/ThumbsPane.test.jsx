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
