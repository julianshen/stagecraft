import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import CanvasSlide from './CanvasSlide.jsx';

// jsdom has no ResizeObserver; CanvasSlide measures its frame with one. Restore
// the original afterwards so the stub can't leak across test files.
const origRO = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterAll(() => { globalThis.ResizeObserver = origRO; });

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

describe('CanvasSlide alignment guides', () => {
  it('snaps a single dragged element to another element and shows a guide, cleared on drop', () => {
    const onUpdateElements = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    const [hitA] = hits(container);
    fire(hitA, 'pointerdown', { clientX: 0, clientY: 0 });
    // a.x 100 + 197 → grid 296 (right edge 496); within 6px of b.left 500 → snaps.
    fire(window, 'pointermove', { clientX: 197, clientY: 0 });
    expect(container.querySelector('.align-guide')).toBeTruthy(); // guide visible mid-drag
    fire(window, 'pointerup', {});
    expect(onUpdateElements.mock.calls[0][0].get('a').x).toBe(300); // right edge aligned to b.left 500
    expect(container.querySelector('.align-guide')).toBeFalsy();    // cleared on drop
  });

  it('treats a click (0-delta pointermove) as a select, not a snap/grid commit', () => {
    const onUpdateElements = vi.fn();
    // x=103 is off-grid: without a sweep threshold, moveElement(0,0) would
    // grid-snap it to 104 (or alignSnap would nudge it) and commit on a click.
    const ng = { id: 's', elements: [{ id: 'c', type: 'rect', x: 103, y: 200, w: 100, h: 50 }] };
    const { container } = render(
      <CanvasSlide slide={ng} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['c']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    const [hit] = hits(container);
    fire(hit, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { clientX: 0, clientY: 0 }); // click jitter, no real sweep
    fire(window, 'pointerup', {});
    expect(onUpdateElements).not.toHaveBeenCalled();
  });

  it('does not snap a multi-element drag (guides only for a lone element)', () => {
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a', 'b']} onSelectElement={vi.fn()} onUpdateElements={vi.fn()} />,
    );
    const [hitA] = hits(container);
    fire(hitA, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { clientX: 197, clientY: 0 });
    expect(container.querySelector('.align-guide')).toBeFalsy(); // no guides for a group drag
    fire(window, 'pointerup', {});
  });
});

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

  it('commits a fast flick whose only pointermove was sub-threshold, from the release position', () => {
    const onUpdateElements = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['b']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    const [, hitB] = hits(container);
    // A flick: the only pointermove is sub-threshold (≤3px), but the release is
    // far away. The release position is authoritative — the move must not be
    // dropped as a click just because no move event cleared the sweep threshold.
    fire(hitB, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { clientX: 2, clientY: 0 }); // below the 3px threshold
    fire(window, 'pointerup', { clientX: 60, clientY: 0 });
    expect(onUpdateElements).toHaveBeenCalledTimes(1);
    expect(onUpdateElements.mock.calls[0][0].get('b').x).toBe(560); // 500 + 60
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

  it('rotates the selected element when dragging the rotate handle', () => {
    const onUpdateElements = vi.fn();
    const oneSlide = { id: 's1', elements: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 100 }] };
    const { container } = render(
      <CanvasSlide slide={oneSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    const handle = container.querySelector('.rotate-handle');
    expect(handle).toBeTruthy(); // only shown for a single selection
    fire(handle, 'pointerdown', { clientX: 50, clientY: 0, button: 0 });
    fire(window, 'pointermove', { clientX: 150, clientY: 50 }); // right of center (50,50) → 90°
    fire(window, 'pointerup', { clientX: 150, clientY: 50 });
    expect(onUpdateElements).toHaveBeenCalled();
    expect(onUpdateElements.mock.calls[0][0].get('a').rot).toBe(90);
  });

  it('takes the rotation from the pointerup position on a fast flick (no pointermove)', () => {
    const onUpdateElements = vi.fn();
    const oneSlide = { id: 's1', elements: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 100 }] };
    const { container } = render(
      <CanvasSlide slide={oneSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    fire(container.querySelector('.rotate-handle'), 'pointerdown', { clientX: 50, clientY: 0 });
    fire(window, 'pointerup', { clientX: 150, clientY: 50 }); // released right of center, no move
    expect(onUpdateElements.mock.calls[0][0].get('a').rot).toBe(90);
  });

  it('a click on the rotate handle (no real drag) does not rotate', () => {
    const onUpdateElements = vi.fn();
    const oneSlide = { id: 's1', elements: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 100, rot: 90 }] };
    const { container } = render(
      <CanvasSlide slide={oneSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    fire(container.querySelector('.rotate-handle'), 'pointerdown', { clientX: 50, clientY: 0 });
    fire(window, 'pointerup', { clientX: 50, clientY: 0 }); // released where it started → a click
    expect(onUpdateElements).not.toHaveBeenCalled();
  });

  it('does not commit a rotation that leaves the angle unchanged', () => {
    const onUpdateElements = vi.fn();
    const oneSlide = { id: 's1', elements: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 100, rot: 90 }] };
    const { container } = render(
      <CanvasSlide slide={oneSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    fire(container.querySelector('.rotate-handle'), 'pointerdown', { clientX: 50, clientY: 0 });
    fire(window, 'pointermove', { clientX: 150, clientY: 50 }); // resolves to 90° — already the current rot
    fire(window, 'pointerup', { clientX: 150, clientY: 50 });
    expect(onUpdateElements).not.toHaveBeenCalled();
  });

  it('does not commit when rotating a default (rot-less) element to 0°', () => {
    const onUpdateElements = vi.fn();
    const oneSlide = { id: 's1', elements: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 100 }] }; // rot undefined
    const { container } = render(
      <CanvasSlide slide={oneSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    fire(container.querySelector('.rotate-handle'), 'pointerdown', { clientX: 50, clientY: 0 });
    fire(window, 'pointermove', { clientX: 50, clientY: -50 }); // straight up → 0°, the implicit default
    fire(window, 'pointerup', { clientX: 50, clientY: -50 });
    expect(onUpdateElements).not.toHaveBeenCalled();
  });

  it('ignores a non-primary button on the rotate handle', () => {
    const onUpdateElements = vi.fn();
    const oneSlide = { id: 's1', elements: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 100 }] };
    const { container } = render(
      <CanvasSlide slide={oneSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    fire(container.querySelector('.rotate-handle'), 'pointerdown', { clientX: 50, clientY: 0, button: 2 });
    fire(window, 'pointermove', { clientX: 150, clientY: 50 });
    fire(window, 'pointerup', { clientX: 150, clientY: 50 });
    expect(onUpdateElements).not.toHaveBeenCalled();
  });

  it('shows no rotate handle when multiple elements are selected', () => {
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a', 'b']} onSelectElement={vi.fn()} onUpdateElements={vi.fn()} />,
    );
    expect(container.querySelector('.rotate-handle')).toBeNull();
  });

  it('rotates the selection frame and hit box with a rotated element', () => {
    const oneSlide = { id: 's1', elements: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 100, rot: 45 }] };
    const { container } = render(
      <CanvasSlide slide={oneSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={vi.fn()} onUpdateElements={vi.fn()} />,
    );
    // the handle frame (a handle's parent) carries the element's rotation
    expect(container.querySelector('.sel-handle').parentElement.style.transform).toContain('rotate(45deg)');
    // and the hit box matches the rotated content
    expect(container.querySelector('.el-hit').style.transform).toContain('rotate(45deg)');
  });

  it('resizes a rotated element along its local axes (e handle, screen-down drag)', () => {
    const onUpdateElements = vi.fn();
    const oneSlide = { id: 's1', elements: [{ id: 'a', type: 'rect', x: 100, y: 100, w: 200, h: 100, rot: 90 }] };
    const { container } = render(
      <CanvasSlide slide={oneSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    // 'e' is the 5th handle in HANDLE_POS order (nw,n,ne,w,e,…).
    const eHandle = container.querySelectorAll('.sel-handle')[4];
    fire(eHandle, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { clientX: 0, clientY: 40 }); // drag DOWN → grows local width
    fire(window, 'pointerup', {});
    expect(onUpdateElements).toHaveBeenCalledTimes(1);
    expect(onUpdateElements.mock.calls[0][0].get('a')).toMatchObject({ x: 80, y: 120, w: 240, h: 100, rot: 90 });
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

  it('marquee-drag over empty canvas selects the overlapping elements', () => {
    const onMarqueeSelect = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={[]} onSelectElement={vi.fn()} onUpdateElements={vi.fn()} onMarqueeSelect={onMarqueeSelect} />,
    );
    const overlay = container.querySelector('.elements-overlay');
    fire(overlay, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { clientX: 400, clientY: 250 }); // covers a (100..300×100..200), not b (x≥500)
    fire(window, 'pointerup', { clientX: 400, clientY: 250 });
    expect(onMarqueeSelect).toHaveBeenCalledWith(['a']);
  });

  it('uses the pointerup position when a fast flick delivers no qualifying pointermove', () => {
    const onMarqueeSelect = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={[]} onSelectElement={vi.fn()} onUpdateElements={vi.fn()} onMarqueeSelect={onMarqueeSelect} />,
    );
    const overlay = container.querySelector('.elements-overlay');
    fire(overlay, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(window, 'pointerup', { clientX: 400, clientY: 250 }); // straight to release, no move
    expect(onMarqueeSelect).toHaveBeenCalledWith(['a']);
  });

  it('clicking empty canvas (no drag) clears the selection', () => {
    const onSelectElement = vi.fn();
    const onMarqueeSelect = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={onSelectElement} onUpdateElements={vi.fn()} onMarqueeSelect={onMarqueeSelect} />,
    );
    const overlay = container.querySelector('.elements-overlay');
    fire(overlay, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(window, 'pointerup', {}); // no move → a click, not a marquee
    expect(onSelectElement).toHaveBeenCalledWith(null);
    expect(onMarqueeSelect).not.toHaveBeenCalled();
  });

  it('ignores non-primary (right) button presses so the context menu still works', () => {
    const onSelectElement = vi.fn();
    const onMarqueeSelect = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={onSelectElement} onUpdateElements={vi.fn()} onMarqueeSelect={onMarqueeSelect} />,
    );
    const overlay = container.querySelector('.elements-overlay');
    fire(overlay, 'pointerdown', { clientX: 0, clientY: 0, button: 2 }); // right button
    fire(window, 'pointerup', { button: 2 });
    expect(onSelectElement).not.toHaveBeenCalled();  // selection preserved for the menu
    expect(onMarqueeSelect).not.toHaveBeenCalled();
  });

  it('treats a sub-threshold tremor as a click, not a marquee', () => {
    const onSelectElement = vi.fn();
    const onMarqueeSelect = vi.fn();
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a']} onSelectElement={onSelectElement} onUpdateElements={vi.fn()} onMarqueeSelect={onMarqueeSelect} />,
    );
    const overlay = container.querySelector('.elements-overlay');
    fire(overlay, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { clientX: 1, clientY: 1 }); // within the 3px tolerance
    fire(window, 'pointerup', { clientX: 1, clientY: 1 });
    expect(onSelectElement).toHaveBeenCalledWith(null);
    expect(onMarqueeSelect).not.toHaveBeenCalled();
  });
});

describe('CanvasSlide inline-text focus', () => {
  const baseSlide = { id: 's', layout: 'text', elements: [] };
  // jsdom has no elementFromPoint; define it so the hit-test path runs.
  const withHit = (el, fn) => {
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => el;
    try { fn(); } finally { document.elementFromPoint = orig; }
  };
  it('double-click focuses an editable text field under the overlay', () => {
    const field = document.createElement('div');
    field.setAttribute('contenteditable', 'true');
    const focusSpy = vi.spyOn(field, 'focus');
    const { container } = render(<CanvasSlide slide={baseSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62} />);
    withHit(field, () => fireEvent.doubleClick(container.querySelector('.elements-overlay'), { clientX: 20, clientY: 20 }));
    expect(focusSpy).toHaveBeenCalled();
  });
  it('keeps the overlay click-through while editing, then restores it on blur', () => {
    const field = document.createElement('div');
    field.setAttribute('contenteditable', 'true');
    document.body.appendChild(field);
    const { container } = render(<CanvasSlide slide={baseSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62} />);
    const overlay = container.querySelector('.elements-overlay');
    try {
      withHit(field, () => fireEvent.doubleClick(overlay, { clientX: 30, clientY: 30 }));
      expect(overlay.style.pointerEvents).toBe('none'); // editing → pointer reaches the text
      fireEvent.blur(field);
      expect(overlay.style.pointerEvents).toBe('');      // restored when the edit ends
    } finally {
      field.remove();
    }
  });

  it('double-click on a non-editable hit focuses nothing and does not throw', () => {
    const { container } = render(<CanvasSlide slide={baseSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62} />);
    expect(() => withHit(document.createElement('div'), () => fireEvent.doubleClick(container.querySelector('.elements-overlay'), { clientX: 5, clientY: 5 }))).not.toThrow();
  });

  it('drops the caret at the click point when caretRangeFromPoint is available', () => {
    const field = document.createElement('div');
    field.setAttribute('contenteditable', 'true');
    document.body.appendChild(field);
    const origCaret = document.caretRangeFromPoint;
    document.caretRangeFromPoint = () => { const r = document.createRange(); r.selectNodeContents(field); return r; };
    const { container } = render(<CanvasSlide slide={baseSlide} deckCtx={{}} renderSlide={renderSlide} zoom={62} />);
    try {
      expect(() => withHit(field, () => fireEvent.doubleClick(container.querySelector('.elements-overlay'), { clientX: 9, clientY: 9 }))).not.toThrow();
    } finally {
      document.caretRangeFromPoint = origCaret;
      field.remove();
    }
  });
});
