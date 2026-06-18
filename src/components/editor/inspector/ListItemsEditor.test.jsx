import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ListItemsEditor from './ListItemsEditor.jsx';

// agenda items are objects {n,t,d}; list items are bare strings. The editor edits
// both through the shared `items` collection and commits a validated patch via
// onApply — the same path the Co-pilot uses. Reorder/delete remap index-keyed
// `fmt` so per-item formatting follows its item.
const agenda = (over = {}) => ({
  id: 's', layout: 'agenda',
  items: [{ n: '01', t: 'Why', d: 'intro' }, { n: '02', t: 'What', d: 'inside' }],
  ...over,
});
const list = (over = {}) => ({ id: 's', layout: 'list', items: ['First', 'Second', 'Third'], ...over });

describe('ListItemsEditor', () => {
  it('renders each agenda item’s number, title, and description', () => {
    render(<ListItemsEditor slide={agenda()} onApply={vi.fn()} />);
    expect(screen.getByDisplayValue('01')).toBeTruthy();
    expect(screen.getByDisplayValue('Why')).toBeTruthy();
    expect(screen.getByDisplayValue('inside')).toBeTruthy();
  });

  it('renders each list item as a single text field', () => {
    render(<ListItemsEditor slide={list()} onApply={vi.fn()} />);
    expect(screen.getByDisplayValue('First')).toBeTruthy();
    expect(screen.getByDisplayValue('Third')).toBeTruthy();
  });

  it('edits an agenda item field and commits the updated items', () => {
    const onApply = vi.fn();
    render(<ListItemsEditor slide={agenda()} onApply={onApply} />);
    fireEvent.change(screen.getByDisplayValue('Why'), { target: { value: 'Why Stagecraft' } });
    expect(onApply).toHaveBeenCalledWith({
      items: [{ n: '01', t: 'Why Stagecraft', d: 'intro' }, { n: '02', t: 'What', d: 'inside' }],
    });
  });

  it('edits a list item’s text and commits the updated items', () => {
    const onApply = vi.fn();
    render(<ListItemsEditor slide={list()} onApply={onApply} />);
    fireEvent.change(screen.getByDisplayValue('Second'), { target: { value: 'Second!' } });
    expect(onApply).toHaveBeenCalledWith({ items: ['First', 'Second!', 'Third'] });
  });

  it('adds a blank agenda item (object) at the end', () => {
    const onApply = vi.fn();
    render(<ListItemsEditor slide={agenda({ items: [{ n: '01', t: 'A', d: '' }] })} onApply={onApply} />);
    fireEvent.click(screen.getByText('Add item'));
    expect(onApply).toHaveBeenCalledWith({ items: [{ n: '01', t: 'A', d: '' }, { n: '', t: '', d: '' }] });
  });

  it('adds a blank list item (string) at the end', () => {
    const onApply = vi.fn();
    render(<ListItemsEditor slide={list({ items: ['A'] })} onApply={onApply} />);
    fireEvent.click(screen.getByText('Add item'));
    expect(onApply).toHaveBeenCalledWith({ items: ['A', ''] });
  });

  it('deletes an item and shifts later items’ formatting down', () => {
    const onApply = vi.fn();
    const slide = list({ items: ['A', 'B', 'C'], fmt: { 'items.0': { bold: true }, 'items.2': { italic: true } } });
    render(<ListItemsEditor slide={slide} onApply={onApply} />);
    fireEvent.click(screen.getAllByTitle('Remove item')[1]); // delete B (index 1)
    expect(onApply).toHaveBeenCalledWith({
      items: ['A', 'C'],
      fmt: { 'items.0': { bold: true }, 'items.1': { italic: true } }, // old items.2 → items.1
    });
  });

  it('moves an item up and remaps its formatting to the new index', () => {
    const onApply = vi.fn();
    const slide = list({ items: ['A', 'B'], fmt: { 'items.1': { bold: true } } });
    render(<ListItemsEditor slide={slide} onApply={onApply} />);
    fireEvent.click(screen.getAllByTitle('Move up')[1]); // move B up → swap
    expect(onApply).toHaveBeenCalledWith({ items: ['B', 'A'], fmt: { 'items.0': { bold: true } } });
  });

  it('moves an item down and remaps its formatting', () => {
    const onApply = vi.fn();
    const slide = list({ items: ['A', 'B'], fmt: { 'items.0': { bold: true } } });
    render(<ListItemsEditor slide={slide} onApply={onApply} />);
    fireEvent.click(screen.getAllByTitle('Move down')[0]); // move A down → swap
    expect(onApply).toHaveBeenCalledWith({ items: ['B', 'A'], fmt: { 'items.1': { bold: true } } });
  });

  it('disables Move up on the first item and Move down on the last', () => {
    render(<ListItemsEditor slide={list({ items: ['A', 'B'] })} onApply={vi.fn()} />);
    expect(screen.getAllByTitle('Move up')[0].disabled).toBe(true);
    expect(screen.getAllByTitle('Move down')[1].disabled).toBe(true);
  });

  it('deletes with no formatting present → sends items only', () => {
    const onApply = vi.fn();
    render(<ListItemsEditor slide={list({ items: ['A', 'B'] })} onApply={onApply} />);
    fireEvent.click(screen.getAllByTitle('Remove item')[0]);
    expect(onApply).toHaveBeenCalledWith({ items: ['B'] });
  });

  it('tolerates ragged items (missing fields, a nullish item) without rendering "undefined"/"null"', () => {
    const { container } = render(
      <ListItemsEditor slide={{ id: 's', layout: 'agenda', items: [{ t: 'only a title' }, null] }} onApply={vi.fn()} />,
    );
    for (const input of container.querySelectorAll('input')) {
      expect(input.value).not.toBe('undefined'); // missing n/d, or a null item, fall back to ''
      expect(input.value).not.toBe('null');
    }
    // and a nullish list item renders as an empty field, not the string "null"
    const { container: listC } = render(
      <ListItemsEditor slide={{ id: 's2', layout: 'list', items: [null, 'B'] }} onApply={vi.fn()} />,
    );
    expect(listC.querySelector('input').value).toBe('');
  });

  it('coerces a non-string (object) list item to a blank field, matching the renderer', () => {
    // A layout switch (agenda→list via changeLayout) leaves object items on a
    // list slide; the canvas renders those blank (SlideRenderer coerces object→''),
    // so the inspector must too — never show the string "[object Object]".
    const { container } = render(
      <ListItemsEditor slide={{ id: 's', layout: 'list', items: [{ n: '01', t: 'x', d: 'y' }, 'B'] }} onApply={vi.fn()} />,
    );
    const inputs = container.querySelectorAll('input');
    expect(inputs[0].value).toBe('');  // object item → blank, not "[object Object]"
    expect(inputs[1].value).toBe('B');
  });

  it('handles a slide with no items yet — shows only the Add control', () => {
    const onApply = vi.fn();
    render(<ListItemsEditor slide={{ id: 's', layout: 'list' }} onApply={onApply} />);
    expect(screen.getByText('Add item')).toBeTruthy();
    expect(screen.queryAllByTitle('Remove item')).toHaveLength(0); // no rows
    fireEvent.click(screen.getByText('Add item'));
    expect(onApply).toHaveBeenCalledWith({ items: [''] });
  });
});
