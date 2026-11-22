import { StrictMode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEditor } from '@stagecraft/core';
import { EditorProvider, EditorSurface, useEditor, useEditorSnapshot } from './EditorProvider.jsx';

const captured = vi.hoisted(() => new Map());
vi.mock('./StagecraftEditor.jsx', () => ({
  StagecraftEditor: props => {
    captured.set(props.className, props);
    return <section aria-label={props.className}>
      <output>{props.deck.title}</output>
      <button onClick={() => props.onDeckChange(draft => ({ ...draft, title: draft.title + '!' }))}>Edit</button>
      <button onClick={() => props.onDeckChange({ title: 'Replacement' })}>Replace</button>
      <button disabled={!props.canUndo} onClick={props.onUndo}>Undo</button>
      <button disabled={!props.canRedo} onClick={props.onRedo}>Redo</button>
    </section>;
  },
}));

function Status() {
  const editor = useEditor();
  const snapshot = useEditorSnapshot();
  return <output aria-label="status">{snapshot.revision}:{editor.getSnapshot().document.title}</output>;
}

describe('headless React bindings', () => {
  it('renders command changes and UI edits through one history', () => {
    const editor = createEditor({ document: { title: 'First' }, plugins: [{
      id: 'test', version: '1', commands: [{ id: 'rename', apply: (draft, title) => ({ ...draft, title }) }],
    }] });
    render(<EditorProvider editor={editor}><Status /><EditorSurface className="main" /></EditorProvider>);
    act(() => editor.dispatch('rename', 'Plugin'));
    expect(screen.getByLabelText('status').textContent).toBe('1:Plugin');
    fireEvent.click(screen.getByText('Edit'));
    expect(editor.getSnapshot().document.title).toBe('Plugin!');
    fireEvent.click(screen.getByText('Undo'));
    expect(screen.getByLabelText('main').textContent).toContain('Plugin');
    fireEvent.click(screen.getByText('Undo'));
    expect(editor.getSnapshot().document.title).toBe('First');
    fireEvent.click(screen.getByText('Redo'));
    expect(editor.getSnapshot().document.title).toBe('Plugin');
    fireEvent.click(screen.getByText('Replace'));
    expect(editor.getSnapshot().document).toEqual({ title: 'Replacement' });
  });

  it('isolates nested providers and unsubscribes without disposing host editors', () => {
    const first = { ...createEditor({ document: { title: 'One' } }), dispose: vi.fn() };
    const second = { ...createEditor({ document: { title: 'Two' } }), dispose: vi.fn() };
    const subscriptions = new Set();
    const subscribe = first.subscribe;
    first.subscribe = listener => {
      subscriptions.add(listener);
      const unsubscribe = subscribe(listener);
      return () => { subscriptions.delete(listener); unsubscribe(); };
    };
    const { unmount } = render(<StrictMode><EditorProvider editor={first}>
      <EditorSurface className="first" />
      <EditorProvider editor={second}><EditorSurface className="second" /></EditorProvider>
    </EditorProvider></StrictMode>);
    fireEvent.click(within(screen.getByLabelText('first')).getByText('Edit'));
    expect(first.getSnapshot().document.title).toBe('One!');
    expect(second.getSnapshot().document.title).toBe('Two');
    unmount();
    expect(subscriptions.size).toBe(0);
    expect(first.dispose).not.toHaveBeenCalled();
    expect(second.dispose).not.toHaveBeenCalled();
    first.update(() => ({ title: 'Alive' }));
    expect(first.getSnapshot().document.title).toBe('Alive');
  });

  it('switches subscription when the supplied editor changes', () => {
    const first = createEditor({ document: { title: 'One' } });
    const second = createEditor({ document: { title: 'Two' } });
    const { rerender } = render(<EditorProvider editor={first}><Status /></EditorProvider>);
    rerender(<EditorProvider editor={second}><Status /></EditorProvider>);
    act(() => first.update(() => ({ title: 'Old' })));
    expect(screen.getByLabelText('status').textContent).toBe('0:Two');
    act(() => second.update(() => ({ title: 'New' })));
    expect(screen.getByLabelText('status').textContent).toBe('1:New');
  });

  it('rejects stale UI callbacks instead of overwriting newer plugin edits', () => {
    const editor = createEditor({ document: { title: 'One' } });
    const onError = vi.fn();
    render(<EditorProvider editor={editor}><EditorSurface className="stale" onError={onError} /></EditorProvider>);
    const stale = captured.get('stale');
    act(() => editor.update(() => ({ title: 'New' })));
    stale.onDeckChange({ title: 'Old' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'STALE_REVISION' }));
    expect(editor.getSnapshot().document.title).toBe('New');
  });

  it('reports denied UI edits and leaves the document untouched', () => {
    const editor = createEditor({ document: { title: 'One' }, authorize: () => false });
    const onError = vi.fn();
    render(<EditorProvider editor={editor}><EditorSurface className="denied" onError={onError} /></EditorProvider>);
    fireEvent.click(screen.getByText('Edit'));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));
    expect(editor.getSnapshot().revision).toBe(0);
  });

  it('adapts legacy undefined object deletions without weakening the core boundary', () => {
    const original = { title: 'Legacy', slides: [{ fmt: { title: 'bold' }, elements: [{ id: 'shape', gradient: { angle: 90 }, shadow: { blur: 2 }, strokeDash: 'dash', opaque: { extension: true } }] }] };
    const editor = createEditor({ document: original });
    const onError = vi.fn();
    render(<EditorProvider editor={editor}><EditorSurface className="legacy" onError={onError} /></EditorProvider>);
    const updater = draft => ({ ...draft, slides: draft.slides.map(slide => ({ ...slide, fmt: undefined, elements: slide.elements.map(element => ({ ...element, gradient: undefined, shadow: undefined, strokeDash: undefined })) })) });
    expect(() => editor.update(updater)).toThrow(expect.objectContaining({ code: 'INVALID_JSON' }));
    act(() => captured.get('legacy').onDeckChange(updater));
    expect(onError).not.toHaveBeenCalled();
    expect(editor.getSnapshot().document.slides).toEqual([{ elements: [{ id: 'shape', opaque: { extension: true } }] }]);
    act(() => editor.undo());
    expect(editor.getSnapshot().document).toEqual(original);
  });

  it('keeps rejecting unsafe legacy results without evaluating accessors', () => {
    const editor = createEditor({ document: { title: 'Safe' } }), onError = vi.fn(), getter = vi.fn();
    render(<EditorProvider editor={editor}><EditorSurface className="unsafe" onError={onError} /></EditorProvider>);
    const cycle = {}; cycle.self = cycle;
    for (const bad of [{ values: [undefined] }, { values: [, 1] }, { number: NaN }, { number: Infinity }, cycle,
      Object.defineProperty({}, 'value', { enumerable: true, get: getter }), JSON.parse('{"__proto__":{}}'), { constructor: undefined }]) {
      captured.get('unsafe').onDeckChange({ title: 'Unsafe', bad });
      expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'INVALID_JSON' }));
      expect(editor.getSnapshot().revision).toBe(0);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('propagates mutation errors when the host has no error handler', () => {
    const editor = createEditor({ document: { title: 'One' }, authorize: () => false });
    render(<EditorProvider editor={editor}><EditorSurface className="throws" /></EditorProvider>);
    expect(() => captured.get('throws').onDeckChange({ title: 'No' })).toThrow();
  });

  it('requires a provider and rejects conflicting controlled props', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Status />)).toThrow('EditorProvider');
      const editor = createEditor({ document: { title: 'One' } });
      expect(() => render(<EditorProvider editor={editor}><EditorSurface deck={{ title: 'Conflict' }} /></EditorProvider>)).toThrow('deck');
      expect(() => render(<EditorProvider editor={null}><Status /></EditorProvider>)).toThrow('editor');
    } finally { log.mockRestore(); }
  });
});
