import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import StagecraftEditor from './StagecraftEditor.jsx';

const origRO = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterAll(() => { globalThis.ResizeObserver = origRO; });

const makeDeck = (elId, title = 'Slide') => ({
  theme: 'indigo',
  title: 'Deck',
  sections: [{ id: 'sec1', name: 'Sec', slides: ['s1'] }],
  slides: [
    {
      id: 's1',
      layout: 'text',
      title,
      body: '',
      elements: elId ? [{ id: elId, type: 'rect', x: 100, y: 100, w: 120, h: 80, fill: '#336699' }] : [],
    },
  ],
});

const pointerClick = (node) => {
  fireEvent(node, new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
  fireEvent(window, new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
};

describe('StagecraftEditor', () => {
  it('renders with sensible defaults in uncontrolled mode without mutating documentElement', () => {
    const prevTheme = document.documentElement.getAttribute('data-theme');
    const { container } = render(<StagecraftEditor />);
    const root = container.querySelector('.stagecraft-editor');
    expect(root).not.toBeNull();
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.getAttribute('data-density')).toBe('comfortable');
    expect(root.getAttribute('tabindex')).toBe('-1');
    expect(root.style.getPropertyValue('--accent')).toBeTruthy();
    expect(document.documentElement.getAttribute('data-theme')).toBe(prevTheme);
  });

  it('supports uncontrolled undo/redo via internal deck history', () => {
    const { container } = render(<StagecraftEditor defaultDeck={makeDeck('el-a')} />);
    const root = container.querySelector('.stagecraft-editor');
    expect(container.querySelectorAll('.el-hit')).toHaveLength(1);

    pointerClick(container.querySelector('.el-hit'));
    expect(root.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(root, { key: 'Delete' });
    expect(container.querySelectorAll('.el-hit')).toHaveLength(0);

    fireEvent.keyDown(root, { key: 'z', ctrlKey: true });
    expect(container.querySelectorAll('.el-hit')).toHaveLength(1);

    fireEvent.keyDown(root, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(container.querySelectorAll('.el-hit')).toHaveLength(0);
  });

  it('applies scoped theme, density, accent, className and style props', () => {
    const { container } = render(
      <StagecraftEditor
        deck={makeDeck(null)}
        onDeckChange={vi.fn()}
        theme="dark"
        density="compact"
        accent="emerald"
        className="host-embed"
        style={{ height: '540px' }}
      />
    );
    const root = container.querySelector('.stagecraft-editor');
    expect(root.classList.contains('host-embed')).toBe(true);
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-density')).toBe('compact');
    expect(root.style.height).toBe('540px');
    expect(root.style.getPropertyValue('--accent')).toContain('155');
  });

  it('hides Co-pilot by default and supports injected AI drawer', () => {
    const { queryByText, rerender } = render(
      <StagecraftEditor deck={makeDeck(null, 'Initial')} onDeckChange={vi.fn()} />
    );
    expect(queryByText('Co-pilot')).toBeNull();

    const onDeckChange = vi.fn();
    rerender(
      <StagecraftEditor
        deck={makeDeck(null, 'Initial')}
        onDeckChange={onDeckChange}
        renderAIDrawer={({ onClose, slideNum, slide, onApplyPatch }) => (
          <div data-testid="custom-ai">
            <span>AI slide {slideNum}: {slide.title}</span>
            <button type="button" onClick={() => onApplyPatch({ title: 'AI Updated' }, slide.id)}>Apply</button>
            <button type="button" onClick={onClose}>Close</button>
          </div>
        )}
      />
    );

    fireEvent.click(queryByText('Co-pilot'));
    expect(queryByText('AI slide 1: Initial')).not.toBeNull();
    fireEvent.click(queryByText('Apply'));
    expect(onDeckChange).toHaveBeenCalledTimes(1);
    const nextDeck = onDeckChange.mock.calls[0][0](makeDeck(null, 'Initial'));
    expect(nextDeck.slides[0].title).toBe('AI Updated');

    fireEvent.click(queryByText('Close'));
    expect(queryByText('AI slide 1: Initial')).toBeNull();
  });

  it('scopes keyboard shortcuts to the focused editor when multiple editors are mounted', () => {
    const onChange1 = vi.fn();
    const onChange2 = vi.fn();
    const { container } = render(
      <div>
        <div data-testid="ed1">
          <StagecraftEditor deck={makeDeck('el-1')} onDeckChange={onChange1} />
        </div>
        <div data-testid="ed2">
          <StagecraftEditor deck={makeDeck('el-2')} onDeckChange={onChange2} />
        </div>
      </div>
    );

    const ed1 = container.querySelector('[data-testid="ed1"] .stagecraft-editor');
    const ed2 = container.querySelector('[data-testid="ed2"] .stagecraft-editor');

    // Select elements in both editors.
    pointerClick(ed1.querySelector('.el-hit'));
    pointerClick(ed2.querySelector('.el-hit'));

    // Global body keydown does not trigger either focus-scoped editor.
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(onChange1).not.toHaveBeenCalled();
    expect(onChange2).not.toHaveBeenCalled();

    // Keydown inside editor 1 only deletes in editor 1.
    fireEvent.keyDown(ed1, { key: 'Delete' });
    expect(onChange1).toHaveBeenCalledTimes(1);
    expect(onChange2).not.toHaveBeenCalled();

    // Command palette shortcut inside editor 2 only opens palette in editor 2.
    fireEvent.keyDown(ed2, { key: 'k', ctrlKey: true });
    expect(within(ed1).queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    expect(within(ed2).queryByRole('dialog', { name: 'Command palette' })).not.toBeNull();
  });
  it('handles app shortcuts on non-text controls while preserving text undo', () => {
    const onUndo = vi.fn();
    const { container } = render(<StagecraftEditor deck={makeDeck(null)} onUndo={onUndo} canUndo />);
    const root = container.querySelector('.stagecraft-editor');
    for (const tag of ['select', 'checkbox', 'range', 'color']) {
      const control = document.createElement(tag === 'select' ? 'select' : 'input');
      if (tag !== 'select') control.type = tag;
      root.append(control);
      fireEvent.keyDown(control, { key: 'z', ctrlKey: true });
      control.remove();
    }
    expect(onUndo).toHaveBeenCalledTimes(4);
    const text = document.createElement('textarea');
    root.append(text);
    fireEvent.keyDown(text, { key: 'z', ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(4);
  });

  it('restores editor focus after closing the command palette', () => {
    const { container, getByRole, queryByRole } = render(<StagecraftEditor defaultDeck={makeDeck(null)} />);
    const root = container.querySelector('.stagecraft-editor');
    root.focus();
    fireEvent.keyDown(document.activeElement, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(within(getByRole('dialog', { name: 'Command palette' })).getByRole('combobox'));
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    expect(root.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement, { key: 'k', ctrlKey: true });
    expect(getByRole('dialog', { name: 'Command palette' })).not.toBeNull();
  });

});
