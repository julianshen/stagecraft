import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import SlideEditor from './SlideEditor.jsx';

// The command registry (lib/commands.js) drives the editor's keys, its
// context menus and the ⌘K palette. jsdom reports a non-Mac platform, so
// shortcut labels read Ctrl+….

const origRO = globalThis.ResizeObserver;
beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { globalThis.ResizeObserver = origRO; });

const rect = (id, x) => ({ id, type: 'rect', x, y: 100, w: 200, h: 100, fill: '#123456' });
const deck = {
  theme: 'indigo',
  sections: [{ id: 'sec1', name: 'Intro', slides: ['sl1', 'sl2'] }],
  slides: [
    { id: 'sl1', layout: 'blank', bgColor: '#FFFFFF', elements: [rect('a', 100), rect('b', 400)] },
    { id: 'sl2', layout: 'blank', bgColor: '#FFFFFF', elements: [] },
  ],
};
const renderSlide = () => <div data-testid="slide" />;

function renderEditor(callbacks = {}, { sel = [], current = 'sl1', ...extra } = {}) {
  return render(
    <SlideEditor
      deck={deck}
      renderSlide={renderSlide}
      callbacks={callbacks}
      currentSlideId={current}
      selectedElementIds={sel}
      selectedElementCount={sel.length}
      {...extra}
    />,
  );
}
const menu = (container) => container.querySelector('.ctx');
const labels = (el) => [...el.querySelectorAll('.ctx-item .lbl')].map((n) => n.textContent);

describe('editor keyboard commands', () => {
  it('Ctrl+M adds a new slide', () => {
    const onNewSlide = vi.fn();
    renderEditor({ onNewSlide });
    fireEvent.keyDown(document.body, { key: 'm', ctrlKey: true });
    expect(onNewSlide).toHaveBeenCalledTimes(1);
  });

  it('PageDown / PageUp move between slides', () => {
    const onCurrentSlideChange = vi.fn();
    const { unmount } = renderEditor({}, { onCurrentSlideChange });
    fireEvent.keyDown(document.body, { key: 'PageDown' });
    expect(onCurrentSlideChange).toHaveBeenLastCalledWith('sl2');
    fireEvent.keyDown(document.body, { key: 'PageUp' }); // already first → stays
    expect(onCurrentSlideChange).toHaveBeenCalledTimes(1);
    unmount();
    renderEditor({}, { onCurrentSlideChange, current: 'sl2' });
    fireEvent.keyDown(document.body, { key: 'PageUp' });
    expect(onCurrentSlideChange).toHaveBeenLastCalledWith('sl1');
  });

  it('Ctrl+A selects every element on the slide', () => {
    const onMarqueeSelect = vi.fn();
    renderEditor({ onMarqueeSelect });
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    expect(onMarqueeSelect).toHaveBeenCalledWith(['a', 'b']);
  });

  it('Ctrl+Shift+] / [ bring the single selected element to front / back', () => {
    const onArrangeElement = vi.fn();
    renderEditor({ onArrangeElement }, { sel: ['a'] });
    fireEvent.keyDown(document.body, { key: '}', code: 'BracketRight', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true });
    expect(onArrangeElement.mock.calls).toEqual([['front'], ['back']]);
  });

  it('V and P switch tools; I opens the image picker', () => {
    const { getByTitle, container } = renderEditor({});
    const pickerClick = vi.spyOn(container.querySelector('input[type=file]'), 'click');
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(getByTitle(/^Pen/).className).toMatch(/active/);
    fireEvent.keyDown(document.body, { key: 'v' });
    expect(getByTitle(/^Select/).className).toMatch(/active/);
    fireEvent.keyDown(document.body, { key: 'i' });
    expect(pickerClick).toHaveBeenCalled();
  });

  it('tooltips show the real bound shortcut', () => {
    const { getByTitle } = renderEditor({});
    expect(getByTitle('Select · V')).toBeTruthy();
    expect(getByTitle('Pen · P')).toBeTruthy();
    expect(getByTitle('Image · I')).toBeTruthy();
    expect(getByTitle('Bring to front · Ctrl+Shift+]')).toBeTruthy();
  });

  it('nudges with arrows (Shift = 5× grid)', () => {
    const onNudgeElements = vi.fn();
    renderEditor({ onNudgeElements }, { sel: ['a'] });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowUp', shiftKey: true });
    expect(onNudgeElements.mock.calls).toEqual([[8, 0], [0, -40]]);
  });
});

describe('context-aware right-click menus', () => {
  it('right-clicking an element selects it and shows element commands', () => {
    const onSelectElement = vi.fn();
    const onCopyElements = vi.fn();
    const { container } = renderEditor({ onCopyElements, onDeleteElements: vi.fn(), onCutElements: vi.fn(), onPasteElements: vi.fn(), onDuplicateElements: vi.fn(), onArrangeElement: vi.fn(), onGroupElements: vi.fn(), onUngroupElements: vi.fn() }, { onSelectElement });
    const hit = container.querySelector('[data-el-id="b"]');
    fireEvent.contextMenu(hit);
    expect(onSelectElement).toHaveBeenCalledWith('b');
    // The menu is built for a fresh 1-element selection once the parent re-renders.
    const { container: c2 } = renderEditor({ onCopyElements, onDeleteElements: vi.fn(), onCutElements: vi.fn(), onPasteElements: vi.fn(), onDuplicateElements: vi.fn(), onArrangeElement: vi.fn(), onGroupElements: vi.fn(), onUngroupElements: vi.fn() }, { sel: ['b'] });
    fireEvent.contextMenu(c2.querySelector('[data-el-id="b"]'));
    const m = menu(c2);
    expect(labels(m)).toEqual(['Cut', 'Copy', 'Paste', 'Duplicate', 'Delete', 'Bring to front', 'Send to back', 'Ungroup']);
    expect(within(m).getByText('Copy').parentElement.querySelector('.kbd').textContent).toBe('Ctrl+C');
    fireEvent.click(within(m).getByText('Copy'));
    expect(onCopyElements).toHaveBeenCalled();
  });

  it('right-clicking an already-selected element keeps the multi-selection', () => {
    const onSelectElement = vi.fn();
    const { container } = renderEditor({ onGroupElements: vi.fn() }, { sel: ['a', 'b'], onSelectElement });
    fireEvent.contextMenu(container.querySelector('[data-el-id="a"]'));
    expect(onSelectElement).not.toHaveBeenCalled();
    expect(labels(menu(container))).toContain('Group');
  });

  it('the canvas menu labels only real shortcuts (no ⌘D on Duplicate slide)', () => {
    const { container } = renderEditor({ onPasteElements: vi.fn(), onNewSlide: vi.fn(), onDuplicateSlide: vi.fn(), onDeleteSlide: vi.fn(), onMarqueeSelect: vi.fn() });
    fireEvent.contextMenu(container.querySelector('.canvas-area'));
    const m = menu(container);
    expect(labels(m)).toEqual(['Paste', 'Select all', 'Generate with AI', 'Change layout', 'Apply theme', 'New slide', 'Duplicate slide', 'Delete slide']);
    const kbdOf = (l) => within(m).getByText(l).parentElement.querySelector('.kbd')?.textContent;
    expect(kbdOf('Duplicate slide')).toBeUndefined();
    expect(kbdOf('Delete slide')).toBeUndefined();
    expect(kbdOf('Generate with AI')).toBeUndefined();
    expect(kbdOf('New slide')).toBe('Ctrl+M');
  });

  it('Delete slide in the canvas menu deletes the current slide', () => {
    const onDeleteSlide = vi.fn();
    const { container } = renderEditor({ onDeleteSlide }, { current: 'sl2' });
    fireEvent.contextMenu(container.querySelector('.canvas-area'));
    fireEvent.click(within(menu(container)).getByText('Delete slide'));
    expect(onDeleteSlide).toHaveBeenCalledWith('sl2');
  });

  it('right-clicking a thumbnail makes it current and offers slide commands', () => {
    const onCurrentSlideChange = vi.fn();
    const onDuplicateSlide = vi.fn();
    const { container } = renderEditor({ onNewSlide: vi.fn(), onDuplicateSlide, onDeleteSlide: vi.fn() }, { onCurrentSlideChange });
    fireEvent.contextMenu(container.querySelector('[data-sid="sl2"]'), { clientX: 40, clientY: 60 });
    expect(onCurrentSlideChange).toHaveBeenCalledWith('sl2');
    const m = menu(container);
    expect(labels(m)).toEqual(['New slide', 'Duplicate slide', 'Delete slide']);
    expect(m.style.position).toBe('fixed');
    fireEvent.click(within(m).getByText('Duplicate slide'));
    expect(onDuplicateSlide).toHaveBeenCalled();
  });
});

describe('⌘K command palette', () => {
  it('Ctrl+K opens the palette; typing filters; Enter runs the top match', () => {
    const onDuplicateElements = vi.fn();
    const { getByRole, queryByRole } = renderEditor({ onDuplicateElements, onNewSlide: vi.fn() }, { sel: ['a'] });
    expect(queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    const dlg = getByRole('dialog', { name: 'Command palette' });
    const input = within(dlg).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'dupl' } });
    const opts = within(dlg).getAllByRole('option');
    expect(opts[0].textContent).toMatch(/Duplicate/);
    expect(opts[0].textContent).toMatch(/Ctrl\+D/);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onDuplicateElements).toHaveBeenCalled();
    expect(queryByRole('dialog', { name: 'Command palette' })).toBeNull(); // closes after running
  });

  it('arrow keys move the highlight, Escape closes', () => {
    const onNewSlide = vi.fn();
    const onDuplicateSlide = vi.fn();
    const { getByRole, queryByRole } = renderEditor({ onNewSlide, onDuplicateSlide });
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    const dlg = getByRole('dialog', { name: 'Command palette' });
    const input = within(dlg).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'slide' } });
    expect(within(dlg).getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(dlg).getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' }); // clamps at the top
    expect(within(dlg).getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('clicking an option runs it; no matches shows an empty state', () => {
    const onNewSlide = vi.fn();
    const { getByRole } = renderEditor({ onNewSlide });
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    const dlg = getByRole('dialog', { name: 'Command palette' });
    fireEvent.change(within(dlg).getByRole('combobox'), { target: { value: 'zzz' } });
    expect(within(dlg).getByText('No matching commands')).toBeTruthy();
    fireEvent.change(within(dlg).getByRole('combobox'), { target: { value: 'new slide' } });
    fireEvent.click(within(dlg).getByRole('option'));
    expect(onNewSlide).toHaveBeenCalled();
  });

  it('Generate with AI from the palette opens the Co-pilot', () => {
    const { getByRole, queryByPlaceholderText } = renderEditor({});
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    const dlg = getByRole('dialog', { name: 'Command palette' });
    fireEvent.change(within(dlg).getByRole('combobox'), { target: { value: 'generate' } });
    fireEvent.keyDown(within(dlg).getByRole('combobox'), { key: 'Enter' });
    expect(queryByPlaceholderText(/Ask Co-pilot/i)).not.toBeNull();
  });
});
