import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReorderDrag } from './useReorderDrag.js';

const setup = (onReorder) => renderHook(() => useReorderDrag(onReorder)).result.current;
const ev = () => ({ preventDefault() {}, stopPropagation() {} });

// Start a drag on `src`, then drop on the card `dropSid` within `sec`.
function dropOnCard({ dragProps }, src, dropSid, sec, dt) {
  dragProps(src, sec).onDragStart({ dataTransfer: dt, ...ev() });
  dragProps(dropSid, sec).onDrop(ev());
}

describe('useReorderDrag — card drops', () => {
  const sec = { id: 's1', slides: ['a', 'b', 'c'] };

  it('moves the dragged slide just before the drop target', () => {
    const onReorder = vi.fn();
    dropOnCard(setup(onReorder), 'c', 'a', sec); // c → before a
    expect(onReorder).toHaveBeenCalledWith('c', 's1', 0);
  });

  it('writes the dragged id to dataTransfer when present (Firefox needs it)', () => {
    const setData = vi.fn();
    setup(vi.fn()).dragProps('b', sec).onDragStart({ dataTransfer: { setData }, ...ev() });
    expect(setData).toHaveBeenCalledWith('text/plain', 'b');
  });

  it('appends when the drop target is not in the section (after removing the dragged id)', () => {
    const onReorder = vi.fn();
    dropOnCard(setup(onReorder), 'a', 'ghost', sec); // a removed → rest ['b','c'] → index 2
    expect(onReorder).toHaveBeenCalledWith('a', 's1', 2);
  });

  it('ignores a drop onto the dragged slide itself', () => {
    const onReorder = vi.fn();
    dropOnCard(setup(onReorder), 'a', 'a', sec);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('is inert without an onReorder host', () => {
    expect(() => dropOnCard(setup(undefined), 'a', 'b', sec)).not.toThrow();
  });

  it('clears the drag on dragEnd so a later stray drop does nothing', () => {
    const onReorder = vi.fn();
    const { dragProps } = setup(onReorder);
    dragProps('c', sec).onDragStart({ dataTransfer: undefined, ...ev() });
    dragProps('c', sec).onDragEnd();
    dragProps('a', sec).onDrop(ev());
    expect(onReorder).not.toHaveBeenCalled();
  });
});

describe('useReorderDrag — section drops (empty/fresh sections)', () => {
  it('appends the dragged slide to the end of the target section', () => {
    const onReorder = vi.fn();
    const hook = setup(onReorder);
    const empty = { id: 's2', slides: [] };
    hook.dragProps('a', { id: 's1', slides: ['a'] }).onDragStart({ dataTransfer: undefined, ...ev() });
    hook.sectionDropProps(empty).onDrop(ev());
    expect(onReorder).toHaveBeenCalledWith('a', 's2', 0); // first slide in the empty section
  });

  it('appends to the end of a populated section, excluding the dragged slide if already there', () => {
    const onReorder = vi.fn();
    const hook = setup(onReorder);
    const sec = { id: 's1', slides: ['a', 'b'] };
    hook.dragProps('a', sec).onDragStart({ dataTransfer: undefined, ...ev() });
    hook.sectionDropProps(sec).onDrop(ev()); // a removed → rest ['b'] → index 1
    expect(onReorder).toHaveBeenCalledWith('a', 's1', 1);
  });

  it('does nothing on a section drop with no active drag', () => {
    const onReorder = vi.fn();
    setup(onReorder).sectionDropProps({ id: 's1', slides: [] }).onDrop(ev());
    expect(onReorder).not.toHaveBeenCalled();
  });
});
