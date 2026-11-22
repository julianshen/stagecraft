import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { StagecraftEditor } from './StagecraftEditor.jsx';
import { EditorError } from '@stagecraft/core/editor';

const EditorContext = createContext(null);

/** The host owns the editor lifecycle, including disposal after unmount. */
export function EditorProvider({ editor, children }) {
  if (!editor || typeof editor.getSnapshot !== 'function' || typeof editor.subscribe !== 'function') {
    throw new TypeError('EditorProvider requires a headless editor.');
  }
  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>;
}

export function useEditor() {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('useEditor must be used inside EditorProvider.');
  return editor;
}

export function useEditorSnapshot() {
  const editor = useEditor();
  const subscribe = useCallback(listener => editor.subscribe(listener), [editor]);
  const getSnapshot = useCallback(() => editor.getSnapshot(), [editor]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const controlledProps = ['deck', 'defaultDeck', 'onDeckChange', 'onUndo', 'onRedo', 'canUndo', 'canRedo'];

// Legacy controls use undefined object properties to mean deletion. Adapt only
// that convention; retain all other strict JSON checks at the engine boundary.
function legacyDocument(value, ancestors = new Set()) {
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) throw new EditorError('INVALID_JSON');
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
  ancestors.add(value);
  const result = array ? new Array(value.length) : {};
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor.enumerable || !('value' in descriptor)) {
      throw new EditorError('INVALID_JSON');
    }
    if (!array && descriptor.value === undefined) continue;
    Object.defineProperty(result, key, { value: legacyDocument(descriptor.value, ancestors), enumerable: true, configurable: true, writable: true });
  }
  ancestors.delete(value);
  return result;
}

/** Existing UI backed by the provider's revisioned document and history. */
export function EditorSurface({ onError, ...props }) {
  const editor = useEditor();
  const snapshot = useEditorSnapshot();
  for (const name of controlledProps) {
    if (Object.hasOwn(props, name)) throw new TypeError(`EditorSurface owns ${name}; use the headless editor to change state.`);
  }
  function mutate(operation) {
    try { return operation({ expectedRevision: snapshot.revision, origin: 'react' }); }
    catch (error) {
      if (!onError) throw error;
      onError(error);
    }
  }
  return <StagecraftEditor
    {...props}
    deck={snapshot.document}
    onDeckChange={updater => mutate(meta => editor.update(
      draft => legacyDocument(typeof updater === 'function' ? updater(draft) : updater), meta,
    ))}
    onUndo={() => mutate(meta => editor.undo(meta))}
    onRedo={() => mutate(meta => editor.redo(meta))}
    canUndo={snapshot.canUndo}
    canRedo={snapshot.canRedo}
  />;
}
