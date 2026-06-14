import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FormatToolbar from './FormatToolbar.jsx';

// A focusable host field plus the toolbar, matching the editor layout: the
// toolbar tracks focus on any [data-fmt-key] element in the document.
function setup({ slide = { id: 's', fmt: {} }, onFormat = vi.fn() } = {}) {
  const utils = render(
    <>
      <span data-fmt-key="title" tabIndex={0} style={{ fontSize: '48px' }}>Quarterly Review</span>
      <FormatToolbar currentSlide={slide} onFormat={onFormat} />
    </>,
  );
  const field = screen.getByText('Quarterly Review');
  return { ...utils, field, onFormat };
}

describe('FormatToolbar', () => {
  it('renders nothing until a formattable field is focused', () => {
    const { container } = setup();
    expect(container.querySelector('.format-toolbar')).toBeNull();
  });

  it('appears when a [data-fmt-key] field is focused, with B/I/U, colour and size controls', () => {
    const { field, container } = setup();
    fireEvent.focusIn(field);
    expect(container.querySelector('.format-toolbar')).toBeTruthy();
    expect(screen.getByLabelText('Bold')).toBeTruthy();
    expect(screen.getByLabelText('Italic')).toBeTruthy();
    expect(screen.getByLabelText('Underline')).toBeTruthy();
    expect(screen.getByLabelText('Text color')).toBeTruthy();
  });

  it('toggles bold on for an unformatted field', () => {
    const { field, onFormat } = setup();
    fireEvent.focusIn(field);
    fireEvent.click(screen.getByLabelText('Bold'));
    expect(onFormat).toHaveBeenCalledWith('title', 'bold', true);
  });

  it('toggles bold off when the field is already bold', () => {
    const { field, onFormat } = setup({ slide: { id: 's', fmt: { title: { bold: true } } } });
    fireEvent.focusIn(field);
    expect(screen.getByLabelText('Bold').className).toContain('active');
    fireEvent.click(screen.getByLabelText('Bold'));
    expect(onFormat).toHaveBeenCalledWith('title', 'bold', false);
  });

  it('keeps field focus by preventing default on the toolbar mousedown', () => {
    const { field } = setup();
    fireEvent.focusIn(field);
    const bold = screen.getByLabelText('Bold');
    const prevented = !fireEvent.mouseDown(bold); // fireEvent returns false if defaultPrevented
    expect(prevented).toBe(true);
  });

  it('sets the text colour from the colour input', () => {
    const { field, onFormat } = setup();
    fireEvent.focusIn(field);
    fireEvent.input(screen.getByLabelText('Text color'), { target: { value: '#ff0000' } });
    expect(onFormat).toHaveBeenCalledWith('title', 'color', '#ff0000');
  });

  it('steps the font size up from the focused field’s rendered size', () => {
    const { field, onFormat } = setup();
    fireEvent.focusIn(field); // host span renders at 48px
    fireEvent.click(screen.getByLabelText('Increase size'));
    expect(onFormat).toHaveBeenCalledWith('title', 'fontSize', 50);
  });

  it('hides again when focus leaves the field', () => {
    const { field, container } = setup();
    fireEvent.focusIn(field);
    expect(container.querySelector('.format-toolbar')).toBeTruthy();
    fireEvent.focusOut(field);
    expect(container.querySelector('.format-toolbar')).toBeNull();
  });
});
