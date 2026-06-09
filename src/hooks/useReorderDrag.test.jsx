import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReorderDrag } from './useReorderDrag.js';

// Drive the handler bag the hook returns: start a drag on `src`, then drop on
// `dropSid` within `sec`. `dt` is an optional fake dataTransfer.
function dragAndDrop(dragProps, src, dropSid, sec, dt) {
  const start = dragProps(src, sec);
  start.onDragStart({ dataTransfer: dt });
  const target = dragProps(dropSid, sec);
  target.onDrop({ preventDefault() {} });
}

describe('useReorderDrag', () => {
  const sec = { id: 's1', slides: ['a', 'b', 'c'] };
  const setup = (onReorder) => renderHook(() => useReorderDrag(onReorder)).result.current;

  it('moves the dragged slide just before the drop target', () => {
    const onReorder = vi.fn();
    dragAndDrop(setup(onReorder), 'c', 'a', sec); // c → before a
    expect(onReorder).toHaveBeenCalledWith('c', 's1', 0);
  });

  it('writes the dragged id to dataTransfer when present (Firefox needs it)', () => {
    const setData = vi.fn();
    const dragProps = setup(vi.fn());
    dragProps('b', sec).onDragStart({ dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', 'b');
  });

  it('falls back to the section end when the drop target is not in the section', () => {
    const onReorder = vi.fn();
    dragAndDrop(setup(onReorder), 'a', 'ghost', sec); // dropSid absent → append
    expect(onReorder).toHaveBeenCalledWith('a', 's1', 3);
  });

  it('ignores a drop onto the dragged slide itself', () => {
    const onReorder = vi.fn();
    dragAndDrop(setup(onReorder), 'a', 'a', sec);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('is inert without an onReorder host', () => {
    const dragProps = setup(undefined);
    expect(() => dragAndDrop(dragProps, 'a', 'b', sec)).not.toThrow();
  });

  it('clears the drag on dragEnd so a later stray drop does nothing', () => {
    const onReorder = vi.fn();
    const dragProps = setup(onReorder);
    dragProps('c', sec).onDragStart({ dataTransfer: undefined });
    dragProps('c', sec).onDragEnd();
    dragProps('a', sec).onDrop({ preventDefault() {} });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
