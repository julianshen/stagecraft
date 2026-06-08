import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import CanvasSlide from './CanvasSlide.jsx';

// jsdom has no ResizeObserver; CanvasSlide measures its frame with one.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const slide = {
  id: 's1',
  elements: [
    { id: 'a', type: 'rect', x: 100, y: 100, w: 200, h: 100 },
    { id: 'b', type: 'rect', x: 500, y: 100, w: 200, h: 100 },
  ],
};
const renderSlide = () => <div data-testid="rendered" />;
const hits = (c) => c.querySelectorAll('.el-hit');

// jsdom's PointerEvent drops shiftKey/clientX; a MouseEvent typed as a pointer
// event carries them and still triggers React's onPointerDown + window listeners.
function fire(node, type, init) {
  fireEvent(node, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}
function drag(target, { dx = 0, dy = 0, shiftKey = false } = {}) {
  fire(target, 'pointerdown', { clientX: 0, clientY: 0, shiftKey });
  fire(window, 'pointermove', { clientX: dx, clientY: dy });
  fire(window, 'pointerup', {});
}

describe('CanvasSlide drag', () => {
  it('commits a multi-element drag as a single batch update', () => {
    const onUpdateElements = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a', 'b']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    const [hitA] = hits(container);
    drag(hitA, { dx: 40 });
    // One atomic commit carrying every moved element — not one call per element.
    expect(onUpdateElements).toHaveBeenCalledTimes(1);
    const map = onUpdateElements.mock.calls[0][0];
    expect([...map.keys()].sort()).toEqual(['a', 'b']);
  });

  it('shift-click-dragging a non-selected element moves the whole combined selection', () => {
    const onUpdateElements = vi.fn();
    const onSelectElement = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={onSelectElement} onUpdateElements={onUpdateElements} />,
    );
    const [, hitB] = hits(container);
    drag(hitB, { dy: 30, shiftKey: true });
    expect(onSelectElement).toHaveBeenCalledWith('b', true);
    const map = onUpdateElements.mock.calls[0][0];
    expect([...map.keys()].sort()).toEqual(['a', 'b']);
  });

  it('dragging a non-selected element without shift moves only that element', () => {
    const onUpdateElements = vi.fn();
    const onSelectElement = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={onSelectElement} onUpdateElements={onUpdateElements} />,
    );
    const [, hitB] = hits(container);
    drag(hitB, { dy: 30 });
    expect(onSelectElement).toHaveBeenCalledWith('b', false);
    const map = onUpdateElements.mock.calls[0][0];
    expect([...map.keys()]).toEqual(['b']);
  });

  it('shift-clicking a selected element (no drag) toggles it out of the selection', () => {
    const onUpdateElements = vi.fn();
    const onSelectElement = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a', 'b']} onSelectElement={onSelectElement} onUpdateElements={onUpdateElements} />,
    );
    const [hitA] = hits(container);
    // Press + release with shift held, no movement → a click, not a drag.
    fire(hitA, 'pointerdown', { clientX: 0, clientY: 0, shiftKey: true });
    fire(window, 'pointerup', {});
    expect(onSelectElement).toHaveBeenCalledWith('a', true); // additive toggle removes it
    expect(onUpdateElements).not.toHaveBeenCalled();          // no geometry change
  });

  it('aborts a drag on pointercancel and detaches its listeners', () => {
    const onUpdateElements = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    const [hitA] = hits(container);
    fire(hitA, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { clientX: 40, clientY: 0 });
    fire(window, 'pointercancel', {});
    // Stray events after a cancel must be ignored — a leaked pointerup listener
    // would otherwise commit the abandoned drag.
    fire(window, 'pointermove', { clientX: 80, clientY: 0 });
    fire(window, 'pointerup', {});
    expect(onUpdateElements).not.toHaveBeenCalled();
  });

  it('does not commit a drag that snaps back to the starting position', () => {
    // Grid-aligned element: a sub-grid jiggle snaps to the same coords → no-op.
    const gridSlide = { id: 's1', elements: [{ id: 'a', type: 'rect', x: 104, y: 104, w: 200, h: 96 }] };
    const onUpdateElements = vi.fn();
    const { container } = render(
      <CanvasSlide slide={gridSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    drag(hits(container)[0], { dx: 1, dy: 1 });
    expect(onUpdateElements).not.toHaveBeenCalled();
  });
});
