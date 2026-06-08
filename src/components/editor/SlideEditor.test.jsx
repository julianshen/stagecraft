import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import SlideEditor from './SlideEditor.jsx';

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
});
