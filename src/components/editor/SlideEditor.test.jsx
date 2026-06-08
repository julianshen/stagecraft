import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import SlideEditor from './SlideEditor.jsx';

// jsdom has no ResizeObserver; CanvasSlide (rendered inside SlideEditor) needs one.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const deck = {
  theme: 'indigo',
  sections: [{ id: 'sec1', name: 'Intro', slides: ['sl1'] }],
  slides: [{ id: 'sl1', layout: 'text', elements: [] }],
};
const renderSlide = () => <div data-testid="slide" />;

function renderEditor(callbacks = {}) {
  return render(<SlideEditor deck={deck} renderSlide={renderSlide} callbacks={callbacks} />);
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
});
