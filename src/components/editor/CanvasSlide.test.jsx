import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import CanvasSlide from './CanvasSlide.jsx';
import { MIN_SIZE } from '../../lib/elements.js';

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

  it('dragging an unselected GROUPED element moves the whole group on the first drag', () => {
    // The pointer-down selection is async, so the drag must derive its targets from
    // the grabbed element's group (not the stale selection) or only one member moves.
    const onUpdateElements = vi.fn();
    const gslide = { id: 's1', elements: [
      { id: 'a', type: 'rect', x: 100, y: 100, w: 200, h: 100, groupId: 'g1' },
      { id: 'b', type: 'rect', x: 500, y: 100, w: 200, h: 100, groupId: 'g1' },
    ] };
    const { container } = render(
      <CanvasSlide slide={gslide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={[]} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
    );
    drag(hits(container)[0], { dy: 30 }); // grab 'a', nothing selected yet
    expect([...onUpdateElements.mock.calls[0][0].keys()].sort()).toEqual(['a', 'b']);
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

  it('shows the GROUP transform frame (resize handles + rotate knob) for a multi-selection', () => {
    // Was "no handles for 2+"; the group-transform feature now frames the whole
    // selection. The single-element frame still requires exactly one selected.
    const { container } = render(
      <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
        selectedIds={['a', 'b']} onSelectElement={vi.fn()} onUpdateElements={vi.fn()} />,
    );
    expect(container.querySelector('.rotate-handle')).toBeTruthy();
    expect(container.querySelectorAll('[data-handle]').length).toBe(8);
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
    const eHandle = container.querySelector('.sel-handle[data-handle="e"]');
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

describe('CanvasSlide malformed elements', () => {
  it('drops falsy entries (a malformed deck) and renders only real hit boxes — no crash', () => {
    const malformed = { id: 's1', elements: [null, slide.elements[0], undefined, slide.elements[1]] };
    let container;
    expect(() => {
      ({ container } = render(
        <CanvasSlide slide={malformed} deckCtx={{}} renderSlide={renderSlide} zoom={62}
          selectedIds={[]} onSelectElement={vi.fn()} onUpdateElements={vi.fn()} />,
      ));
    }).not.toThrow();
    expect(hits(container)).toHaveLength(2); // the two real rects, nulls skipped
  });
});

describe('CanvasSlide draw tool', () => {
  // With a drawTool active, a drag on the canvas draws a new element of that type
  // at the swept rect (slide coords = clientX/Y here: scale 1, frame rect at 0,0).
  const renderDraw = (onDrawElement, extra = {}) => render(
    <CanvasSlide slide={slide} deckCtx={{}} renderSlide={renderSlide} zoom={62}
      selectedIds={[]} onSelectElement={vi.fn()} onUpdateElements={vi.fn()} onMarqueeSelect={vi.fn()}
      drawTool="rect" onDrawElement={onDrawElement} {...extra} />,
  );

  it('sweeping a rect with a draw tool creates the element at that rect', () => {
    const onDrawElement = vi.fn();
    const { container } = renderDraw(onDrawElement);
    const overlay = container.querySelector('.elements-overlay');
    fire(overlay, 'pointerdown', { clientX: 40, clientY: 60 });
    fire(window, 'pointermove', { clientX: 240, clientY: 260 });
    fire(window, 'pointerup', { clientX: 240, clientY: 260 });
    expect(onDrawElement).toHaveBeenCalledWith('rect', { x: 40, y: 64, w: 200, h: 200 }); // grid-snapped (60→64)
  });

  it('normalizes a rect swept up-and-left to a positive-size box', () => {
    const onDrawElement = vi.fn();
    const { container } = renderDraw(onDrawElement);
    const overlay = container.querySelector('.elements-overlay');
    fire(overlay, 'pointerdown', { clientX: 300, clientY: 300 });
    fire(window, 'pointermove', { clientX: 100, clientY: 120 }); // drag up-left
    fire(window, 'pointerup', { clientX: 100, clientY: 120 });
    expect(onDrawElement).toHaveBeenCalledWith('rect', { x: 104, y: 120, w: 200, h: 184 }); // grid-snapped (100→104, 180→184)
  });

  it('clamps a degenerate (zero-thickness) sweep to the minimum element size', () => {
    const onDrawElement = vi.fn();
    const { container } = renderDraw(onDrawElement);
    const overlay = container.querySelector('.elements-overlay');
    fire(overlay, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { clientX: 200, clientY: 0 }); // purely horizontal → height 0
    fire(window, 'pointerup', { clientX: 200, clientY: 0 });
    expect(onDrawElement).toHaveBeenCalledWith('rect', { x: 0, y: 0, w: 200, h: MIN_SIZE }); // h floored
  });

  it('cancels a draw on pointercancel without creating an element', () => {
    const onDrawElement = vi.fn();
    const { container } = renderDraw(onDrawElement);
    const overlay = container.querySelector('.elements-overlay');
    fire(overlay, 'pointerdown', { clientX: 10, clientY: 10 });
    fire(window, 'pointermove', { clientX: 100, clientY: 100 });
    fire(window, 'pointercancel', {});
    expect(onDrawElement).not.toHaveBeenCalled();        // canceled → nothing created
    expect(container.querySelector('.marquee-rect')).toBeNull(); // preview cleared
  });

  it('a click (no sweep) with a draw tool creates a default-size element at the point', () => {
    const onDrawElement = vi.fn();
    const { container } = renderDraw(onDrawElement);
    const overlay = container.querySelector('.elements-overlay');
    fire(overlay, 'pointerdown', { clientX: 80, clientY: 90 });
    fire(window, 'pointerup', { clientX: 80, clientY: 90 }); // no move → click
    expect(onDrawElement).toHaveBeenCalledWith('rect', { x: 80, y: 88 }); // snapped point, no w/h → factory default
  });

  it('draws instead of marquee-selecting while a draw tool is active', () => {
    const onDrawElement = vi.fn();
    const onMarqueeSelect = vi.fn();
    const { container } = renderDraw(onDrawElement, { onMarqueeSelect });
    const overlay = container.querySelector('.elements-overlay');
    fire(overlay, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { clientX: 400, clientY: 250 }); // would marquee-select 'a'
    fire(window, 'pointerup', { clientX: 400, clientY: 250 });
    expect(onDrawElement).toHaveBeenCalled();
    expect(onMarqueeSelect).not.toHaveBeenCalled();
  });

  it('shows a crosshair cursor and lets pointer events fall through the element hit boxes', () => {
    const { container } = renderDraw(vi.fn());
    expect(container.querySelector('.elements-overlay').style.cursor).toBe('crosshair');
    expect(hits(container)[0].style.pointerEvents).toBe('none'); // draw over elements, don't grab them
  });
});

describe('CanvasSlide group transform (2+ selection)', () => {
  const gslide = () => ({ id: 's1', elements: [
    { id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 100 },
    { id: 'b', type: 'rect', x: 200, y: 0, w: 100, h: 100 },
  ] });
  const renderGroup = (onUpdateElements) => render(
    <CanvasSlide slide={gslide()} deckCtx={{}} renderSlide={renderSlide} zoom={62}
      selectedIds={['a', 'b']} onSelectElement={vi.fn()} onUpdateElements={onUpdateElements} />,
  );

  it('shows 8 resize handles + a rotate knob on the group bounding box', () => {
    const { container } = renderGroup(vi.fn());
    expect(container.querySelectorAll('[data-handle]').length).toBe(8);
    expect(container.querySelector('.rotate-handle')).toBeTruthy();
  });

  it('dragging a group resize handle scales every selected element', () => {
    const onUpdateElements = vi.fn();
    const { container } = renderGroup(onUpdateElements);
    drag(container.querySelector('[data-handle="se"]'), { dx: 60, dy: 0 });
    const map = onUpdateElements.mock.calls[0][0];
    expect([...map.keys()].sort()).toEqual(['a', 'b']); // the whole group committed
    expect(map.get('a').w).toBeGreaterThan(100);          // scaled up
  });

  it('dragging the group rotate knob rotates every selected element', () => {
    const onUpdateElements = vi.fn();
    const { container } = renderGroup(onUpdateElements);
    drag(container.querySelector('.rotate-handle'), { dx: 50, dy: 50 });
    const map = onUpdateElements.mock.calls[0][0];
    expect([...map.keys()].sort()).toEqual(['a', 'b']);
    expect(typeof map.get('a').rot).toBe('number'); // rotateGroup stamped a rot (was absent)
  });
});
