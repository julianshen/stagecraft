import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import SlideEditor from './SlideEditor.jsx';
import { GRID } from '../../lib/elements.js';

// jsdom has no ResizeObserver; CanvasSlide (rendered inside SlideEditor) needs
// one. Restore the original afterwards so the stub can't leak across files.
const origRO = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterAll(() => { globalThis.ResizeObserver = origRO; });

const deck = {
  theme: 'indigo',
  sections: [{ id: 'sec1', name: 'Intro', slides: ['sl1'] }],
  slides: [{ id: 'sl1', layout: 'text', elements: [] }],
};
const renderSlide = () => <div data-testid="slide" />;

// Default count of 3 enables every Arrange button (align needs 2+, distribute 3+).
function renderEditor(callbacks = {}, selectedElementCount = 3) {
  return render(<SlideEditor deck={deck} renderSlide={renderSlide} callbacks={callbacks} selectedElementCount={selectedElementCount} />);
}

describe('SlideEditor align toolbar', () => {
  it.each([
    ['Align left', 'left'],
    ['Align center', 'hcenter'],
    ['Align right', 'right'],
    ['Align top', 'top'],
    ['Align middle', 'vmiddle'],
    ['Align bottom', 'bottom'],
  ])('the %s button aligns the selection via onAlignElements(%s)', (title, edge) => {
    const onAlignElements = vi.fn();
    const { getByTitle } = renderEditor({ onAlignElements });
    fireEvent.click(getByTitle(title));
    expect(onAlignElements).toHaveBeenCalledWith(edge);
  });

  it('the Distribute button calls onDistributeElements', () => {
    const onDistributeElements = vi.fn();
    const { getByTitle } = renderEditor({ onDistributeElements });
    fireEvent.click(getByTitle('Distribute'));
    expect(onDistributeElements).toHaveBeenCalled();
  });

  it('disables the align buttons when fewer than two elements are selected', () => {
    const { getByTitle } = renderEditor({}, 1);
    ['Align left', 'Align center', 'Align right', 'Align top', 'Align middle', 'Align bottom']
      .forEach(t => expect(getByTitle(t)).toBeDisabled());
  });

  it('disables only Distribute when exactly two elements are selected', () => {
    const { getByTitle } = renderEditor({}, 2);
    expect(getByTitle('Align left')).not.toBeDisabled(); // align works at 2
    expect(getByTitle('Distribute')).toBeDisabled();      // distribute needs 3
  });

  it('the z-order buttons arrange the single selected element', () => {
    const onArrangeElement = vi.fn();
    const { getByTitle } = renderEditor({ onArrangeElement }, 1);
    fireEvent.click(getByTitle('Bring to front'));
    expect(onArrangeElement).toHaveBeenCalledWith('front');
    fireEvent.click(getByTitle('Send to back'));
    expect(onArrangeElement).toHaveBeenCalledWith('back');
  });

  it('disables the z-order buttons unless exactly one element is selected', () => {
    expect(renderEditor({}, 1).getByTitle('Bring to front')).not.toBeDisabled();
    cleanup();
    expect(renderEditor({}, 0).getByTitle('Bring to front')).toBeDisabled();
    cleanup();
    expect(renderEditor({}, 2).getByTitle('Send to back')).toBeDisabled();
  });
});

describe('SlideEditor image insert', () => {
  it('embeds a picked image file as a data URL and adds an image element', async () => {
    const onAddElement = vi.fn();
    const { container } = renderEditor({ onAddElement });
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    const file = new File(['png-bytes'], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    // readImageFile resolves async; wait for the callback.
    await vi.waitFor(() => expect(onAddElement).toHaveBeenCalledTimes(1));
    const [type, opts] = onAddElement.mock.calls[0];
    expect(type).toBe('image');
    expect(opts.src).toMatch(/^data:image\/png;base64,/);
  });

  it('does nothing when the picker is dismissed with no file', () => {
    const onAddElement = vi.fn();
    const { container } = renderEditor({ onAddElement });
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [] } });
    expect(onAddElement).not.toHaveBeenCalled();
  });
});

describe('SlideEditor keyboard shortcuts', () => {
  it('⌘/Ctrl-D duplicates the selection', () => {
    const onDuplicateElements = vi.fn();
    renderEditor({ onDuplicateElements }, 1);
    fireEvent.keyDown(document.body, { key: 'd', metaKey: true });
    expect(onDuplicateElements).toHaveBeenCalledTimes(1);
  });

  it('arrow keys nudge the selection by one grid step (shift = larger)', () => {
    const onNudgeElements = vi.fn();
    renderEditor({ onNudgeElements }, 1);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(onNudgeElements).toHaveBeenCalledWith(GRID, 0);
    fireEvent.keyDown(document.body, { key: 'ArrowUp', shiftKey: true });
    expect(onNudgeElements).toHaveBeenCalledWith(0, -GRID * 5);
  });

  it('Delete removes the selection', () => {
    const onDeleteElements = vi.fn();
    renderEditor({ onDeleteElements }, 1);
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(onDeleteElements).toHaveBeenCalledTimes(1);
  });

  it('ignores the shortcuts when no element is selected', () => {
    const cb = { onDuplicateElements: vi.fn(), onNudgeElements: vi.fn(), onDeleteElements: vi.fn() };
    renderEditor(cb, 0);
    fireEvent.keyDown(document.body, { key: 'd', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(cb.onDuplicateElements).not.toHaveBeenCalled();
    expect(cb.onNudgeElements).not.toHaveBeenCalled();
    expect(cb.onDeleteElements).not.toHaveBeenCalled();
  });

  it('ignores the shortcuts while typing in a field', () => {
    const onDuplicateElements = vi.fn();
    const { container } = renderEditor({ onDuplicateElements }, 1);
    const input = container.querySelector('input'); // the hidden image file input
    fireEvent.keyDown(input, { key: 'd', metaKey: true });
    expect(onDuplicateElements).not.toHaveBeenCalled();
  });
});
