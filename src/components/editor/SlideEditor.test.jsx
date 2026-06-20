import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
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
function renderEditor(callbacks = {}, selectedElementCount = 3, extra = {}) {
  return render(<SlideEditor deck={deck} renderSlide={renderSlide} callbacks={callbacks} selectedElementCount={selectedElementCount} {...extra} />);
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

describe('SlideEditor undo/redo toolbar', () => {
  it('the Undo button calls onUndo and Redo calls onRedo', () => {
    const onUndo = vi.fn(); const onRedo = vi.fn();
    const { getByTitle } = renderEditor({ onUndo, onRedo }, 0, { canUndo: true, canRedo: true });
    fireEvent.click(getByTitle('Undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);
    fireEvent.click(getByTitle('Redo'));
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it('disables Undo when there is nothing to undo, Redo when nothing to redo', () => {
    const { getByTitle } = renderEditor({}, 0, { canUndo: false, canRedo: true });
    expect(getByTitle('Undo')).toBeDisabled();
    expect(getByTitle('Redo')).not.toBeDisabled();
  });

  it('disables both when canUndo/canRedo are omitted (no history wired)', () => {
    const { getByTitle } = renderEditor({}, 0);
    expect(getByTitle('Undo')).toBeDisabled();
    expect(getByTitle('Redo')).toBeDisabled();
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

  it('surfaces an error toast when the picked file is not a readable image', async () => {
    const onAddElement = vi.fn();
    const { container, findByText } = renderEditor({ onAddElement });
    const input = container.querySelector('input[type="file"]');
    // A non-image file makes readImageFile reject with a friendly message.
    const file = new File(['plain text'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await findByText('That file is not an image')).toBeInTheDocument();
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

  it('⌘/Ctrl-C copies and ⌘/Ctrl-X cuts the selection', () => {
    const onCopyElements = vi.fn(); const onCutElements = vi.fn();
    renderEditor({ onCopyElements, onCutElements }, 1);
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    expect(onCopyElements).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'x', ctrlKey: true });
    expect(onCutElements).toHaveBeenCalledTimes(1);
  });

  it('⌘/Ctrl-V pastes even with nothing selected (it acts on the clipboard)', () => {
    const onPasteElements = vi.fn();
    renderEditor({ onPasteElements }, 0); // no selection
    fireEvent.keyDown(document.body, { key: 'v', metaKey: true });
    expect(onPasteElements).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate on a modified ⌘D (Ctrl+Shift+D etc. pass through to the browser)', () => {
    const onDuplicateElements = vi.fn();
    renderEditor({ onDuplicateElements }, 1);
    fireEvent.keyDown(document.body, { key: 'D', metaKey: true, shiftKey: true });
    expect(onDuplicateElements).not.toHaveBeenCalled();
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

describe('SlideEditor canvas context menu', () => {
  // Right-click the canvas area to open the context menu, then act on its items.
  const openCtx = (container) => fireEvent.contextMenu(container.querySelector('.canvas-area'));
  // The drill-in submenu (a popover Menu) identified by its header — scopes
  // option queries to it, since layout/theme names also appear in the inspector.
  const submenu = (container, header) =>
    [...container.querySelectorAll('.ctx')].find((m) => within(m).queryByText(header));

  it('Paste pastes elements onto the current slide via onPasteElements', () => {
    const onPasteElements = vi.fn();
    const { container, getByText } = renderEditor({ onPasteElements });
    openCtx(container);
    fireEvent.click(getByText('Paste'));
    expect(onPasteElements).toHaveBeenCalledTimes(1);
  });

  it('Generate with AI opens the Co-pilot drawer', () => {
    const { container, getByText, queryByPlaceholderText } = renderEditor({});
    expect(queryByPlaceholderText(/Ask Co-pilot/i)).toBeNull(); // closed initially
    openCtx(container);
    fireEvent.click(getByText('Generate with AI'));
    expect(queryByPlaceholderText(/Ask Co-pilot/i)).not.toBeNull(); // drawer opened
  });

  it('Change layout opens a chooser whose options change the slide layout', () => {
    const onChangeLayout = vi.fn();
    const { container, getByText } = renderEditor({ onChangeLayout });
    openCtx(container);
    fireEvent.click(getByText('Change layout'));
    fireEvent.click(within(submenu(container, 'Change layout')).getByText('Agenda'));
    expect(onChangeLayout).toHaveBeenCalledWith('agenda');
  });

  it('Apply theme opens a chooser whose options change the deck theme', () => {
    const onChangeTheme = vi.fn();
    const { container, getByText } = renderEditor({ onChangeTheme });
    openCtx(container);
    fireEvent.click(getByText('Apply theme'));
    fireEvent.click(within(submenu(container, 'Apply theme')).getByText('Emerald'));
    expect(onChangeTheme).toHaveBeenCalledWith('emerald');
  });

  it('positions the menu from the canvas rect, not the right-clicked child', () => {
    // Position from clientX/Y minus the canvas rect — NOT offsetX/Y, which is
    // relative to whatever child (a shape/text box) was right-clicked, so it
    // mispositions the menu. A non-zero canvas rect distinguishes the two: jsdom
    // mirrors offsetX←clientX, so only the rect-subtracting math gives 150-50.
    const { container } = renderEditor({});
    const canvas = container.querySelector('.canvas-area');
    canvas.getBoundingClientRect = () => ({ left: 50, top: 30, right: 0, bottom: 0, width: 0, height: 0, x: 50, y: 30, toJSON() {} });
    fireEvent.contextMenu(canvas, { clientX: 150, clientY: 200 });
    const menu = container.querySelector('.ctx');
    expect(menu.style.left).toBe('100px'); // 150 - 50
    expect(menu.style.top).toBe('170px');  // 200 - 30
  });

  it('closes the menu on a click outside it (e.g. the toolbar or inspector)', () => {
    const { container, queryByText } = renderEditor({});
    openCtx(container);
    expect(queryByText('Paste')).not.toBeNull(); // open
    fireEvent.click(document.body); // a click outside any .ctx menu
    expect(queryByText('Paste')).toBeNull(); // closed
  });
});
