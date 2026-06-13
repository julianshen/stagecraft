import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import EditableText from './EditableText.jsx';

describe('EditableText', () => {
  it('renders read-only as the given tag with the value, not editable', () => {
    const { container } = render(<EditableText value="Hello" as="h1" />);
    const h1 = container.querySelector('h1');
    expect(h1.textContent).toBe('Hello');
    expect(h1.getAttribute('contenteditable')).toBeNull();
  });

  it('renders an editable element when editable', () => {
    const { container } = render(<EditableText editable value="Hi" as="span" onCommit={vi.fn()} />);
    const el = container.querySelector('span');
    expect(el.getAttribute('contenteditable')).toBe('true');
  });

  it('commits the new text on blur when it changed', () => {
    const onCommit = vi.fn();
    const { container } = render(<EditableText editable value="A" onCommit={onCommit} />);
    const el = container.querySelector('[contenteditable]');
    el.textContent = 'B';
    fireEvent.blur(el);
    expect(onCommit).toHaveBeenCalledWith('B');
  });

  it('does not commit when the text is unchanged', () => {
    const onCommit = vi.fn();
    const { container } = render(<EditableText editable value="A" onCommit={onCommit} />);
    const el = container.querySelector('[contenteditable]');
    el.textContent = 'A';
    fireEvent.blur(el);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('tolerates a nullish value and a missing onCommit without throwing', () => {
    const { container } = render(<EditableText editable value={undefined} />);
    const el = container.querySelector('[contenteditable]');
    expect(el.textContent).toBe('');           // value ?? '' seeded empty
    el.textContent = 'typed';
    expect(() => fireEvent.blur(el)).not.toThrow(); // no onCommit → no crash
  });

  it('re-syncs the DOM when the value prop changes from outside', () => {
    const { container, rerender } = render(<EditableText editable value="A" onCommit={vi.fn()} />);
    rerender(<EditableText editable value="B" onCommit={vi.fn()} />);
    expect(container.querySelector('[contenteditable]').textContent).toBe('B');
  });

  it('commits on Enter (without Shift) and prevents the newline', () => {
    const onCommit = vi.fn();
    const { container } = render(<EditableText editable value="A" onCommit={onCommit} />);
    const el = container.querySelector('[contenteditable]');
    el.textContent = 'C';
    el.focus();
    const prevented = !fireEvent.keyDown(el, { key: 'Enter' });
    expect(prevented).toBe(true);    // default (newline) prevented
    expect(onCommit).toHaveBeenCalledWith('C'); // Enter blurred → committed
  });
});
