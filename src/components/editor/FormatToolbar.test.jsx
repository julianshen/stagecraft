import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FormatToolbar from './FormatToolbar.jsx';

// A focusable host field plus the toolbar, matching the editor layout: the
// toolbar tracks focus on any [data-fmt-key] element in the document.
function setup({ slide = { id: 's', fmt: {} }, onFormat = vi.fn() } = {}) {
  const utils = render(
    <>
      <span data-fmt-key="title" tabIndex={0} style={{ fontSize: '48px' }}>Quarterly Review</span>
      <button type="button">Co-pilot</button>{/* an unrelated focusable control, outside the toolbar */}
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

  it('targets a per-item field by its index key, reading + writing that key', async () => {
    const onFormat = vi.fn();
    render(
      <>
        <span data-fmt-key="items.0.t" tabIndex={0} style={{ fontSize: '38px' }}>First point</span>
        <FormatToolbar currentSlide={{ id: 's', fmt: { 'items.0.t': { italic: true } } }} onFormat={onFormat} />
      </>,
    );
    await userEvent.click(screen.getByText('First point')); // focusing the per-item field shows the bar
    expect(screen.getByLabelText('Italic').className).toContain('active'); // reads the per-item key's fmt
    await userEvent.click(screen.getByLabelText('Bold'));
    expect(onFormat).toHaveBeenCalledWith('items.0.t', 'bold', true); // writes to the per-item key
  });

  it('keeps field focus by preventing default on the toolbar mousedown', () => {
    const { field } = setup();
    fireEvent.focusIn(field);
    const bold = screen.getByLabelText('Bold');
    const prevented = !fireEvent.mouseDown(bold); // fireEvent returns false if defaultPrevented
    expect(prevented).toBe(true);
  });

  it('sets the text colour once on change (not continuously while dragging the picker)', () => {
    const { field, onFormat } = setup();
    fireEvent.focusIn(field);
    fireEvent.change(screen.getByLabelText('Text color'), { target: { value: '#ff0000' } });
    expect(onFormat).toHaveBeenCalledWith('title', 'color', '#ff0000');
  });

  it('steps the font size up from the focused field’s rendered size', () => {
    const { field, onFormat } = setup();
    fireEvent.focusIn(field); // host span renders at 48px
    fireEvent.click(screen.getByLabelText('Increase size'));
    expect(onFormat).toHaveBeenCalledWith('title', 'fontSize', 50);
  });

  it('hides again when focus leaves the field to nowhere', async () => {
    const { field, container } = setup();
    fireEvent.focusIn(field);
    expect(container.querySelector('.format-toolbar')).toBeTruthy();
    fireEvent.focusOut(field); // blur with no following focusin (clicked empty canvas)
    await new Promise((r) => setTimeout(r));
    expect(container.querySelector('.format-toolbar')).toBeNull();
  });

  it('stays open when focus moves to the colour picker and back (does not dismiss mid-pick)', async () => {
    const { field, container } = setup();
    fireEvent.focusIn(field);
    const color = screen.getByLabelText('Text color');
    // Clicking the colour input blurs the field, then focuses the input; opening
    // the native picker may then blur the input with relatedTarget null. A
    // following focusin (return from the dialog) must cancel the pending hide.
    fireEvent.focusOut(field);
    fireEvent.focusIn(color);    // focus entered the toolbar's colour input
    fireEvent.focusOut(color);   // native picker opened — blur to nowhere
    fireEvent.focusIn(color);    // picker closed — focus returned
    await new Promise((r) => setTimeout(r));
    expect(container.querySelector('.format-toolbar')).toBeTruthy();
  });

  it('hides when focus moves to an unrelated control (not a field, not the toolbar)', async () => {
    const { field, container } = setup();
    fireEvent.focusIn(field);
    expect(container.querySelector('.format-toolbar')).toBeTruthy();
    fireEvent.focusOut(field);
    fireEvent.focusIn(screen.getByText('Co-pilot')); // unrelated button — must not keep the bar bound to the stale field
    await new Promise((r) => setTimeout(r));
    expect(container.querySelector('.format-toolbar')).toBeNull();
  });

  it('re-measures its position when the canvas scrolls', () => {
    const { field, container } = setup();
    let top = 200;
    field.getBoundingClientRect = () => ({ top, left: 50, right: 0, bottom: 0, width: 0, height: 0 });
    fireEvent.focusIn(field);
    const before = container.querySelector('.format-toolbar').style.top;
    top = 80; // the field scrolled up
    fireEvent.scroll(window);
    const after = container.querySelector('.format-toolbar').style.top;
    expect(after).not.toBe(before); // toolbar followed the field
  });
});
