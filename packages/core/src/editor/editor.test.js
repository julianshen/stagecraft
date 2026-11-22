import { describe, it, expect, vi } from 'vitest';
import { createEditor, cloneJson } from './index.js';

const plugin = { id: 'numbers', version: '1', commands: [
  { id: 'add', validate: n => typeof n === 'number', apply: (doc, n) => ({ ...doc, count: doc.count + n }) },
  { id: 'fail', apply: () => { throw new Error('failure'); } },
] };
const create = options => createEditor({ document: { count: 0, opaque: { extension: [1, 2] } }, plugins: [plugin], ...options });
const code = (action, expected) => { try { action(); throw new Error('did not throw'); } catch (error) { expect(error.code).toBe(expected); } };

describe('headless editor', () => {
  it('isolates input, drafts, payloads and stable frozen snapshots', () => {
    const input = { count: 0, nested: { name: 'original' } };
    const editor = create({ document: input });
    input.nested.name = 'external';
    const initial = editor.getSnapshot();
    expect(editor.getSnapshot()).toBe(initial);
    expect(initial.document.nested.name).toBe('original');
    expect(Object.isFrozen(initial.document.nested)).toBe(true);
    let retained;
    editor.update(doc => { retained = doc; doc.count = 1; return doc; });
    retained.count = 999;
    expect(editor.getSnapshot().document.count).toBe(1);
    expect(initial.document.count).toBe(0);
  });
  it('commits a batch once and rolls back failed commands', () => {
    const editor = create(), change = vi.fn();
    editor.subscribe(change);
    editor.transact([{ type: 'add', payload: 2 }, { type: 'add', payload: 3 }]);
    expect(editor.getSnapshot().revision).toBe(1);
    expect(change).toHaveBeenCalledTimes(1);
    expect(editor.getSnapshot().document.opaque).toEqual({ extension: [1, 2] });
    const previous = editor.getSnapshot();
    expect(() => editor.transact([{ type: 'add', payload: 7 }, { type: 'fail' }])).toThrow('failure');
    expect(editor.getSnapshot()).toBe(previous);
  });
  it('supports monotonic undo/redo, no-op equality and bounded history', () => {
    const editor = create({ historyLimit: 1 });
    editor.dispatch('add', 1); editor.dispatch('add', 1);
    editor.update(doc => ({ opaque: doc.opaque, count: doc.count }));
    expect(editor.getSnapshot().revision).toBe(2);
    editor.undo();
    expect(editor.getSnapshot()).toMatchObject({ revision: 3, canUndo: false, canRedo: true, document: { count: 1 } });
    editor.redo();
    expect(editor.getSnapshot()).toMatchObject({ revision: 4, canUndo: true, canRedo: false, document: { count: 2 } });
    editor.undo(); editor.dispatch('add', 5);
    expect(editor.getSnapshot().canRedo).toBe(false);
  });
  it('validates dry runs without notifying or changing history and rejects stale work', () => {
    const editor = create(), listener = vi.fn();
    editor.subscribe(listener); editor.on('beforeTransaction', listener); editor.on('transaction', listener);
    const before = editor.getSnapshot();
    expect(editor.dispatch('add', 4, { dryRun: true, expectedRevision: 0 })).toMatchObject({ changed: true, dryRun: true, revision: 0, document: { count: 4 } });
    expect(editor.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    code(() => editor.dispatch('add', 1, { expectedRevision: 4 }), 'STALE_REVISION');
  });
  it('gates dispatch, updates, history and dry run through current policy and validation', () => {
    let allowed = true;
    const authorize = vi.fn(() => allowed);
    const editor = create({ authorize, validateDocument: doc => doc.count >= 0 });
    code(() => editor.dispatch('add', -1), 'INVALID_DOCUMENT');
    editor.dispatch('add', 1); allowed = false;
    for (const action of [() => editor.undo(), () => editor.redo(), () => editor.update(doc => doc), () => editor.dispatch('add', 1, { dryRun: true })]) code(action, 'UNAUTHORIZED');
    expect(editor.getSnapshot().document.count).toBe(1);
    expect(authorize.mock.calls[0][0]).toMatchObject({ operation: 'dispatch', candidate: { count: -1 } });
    for (const result of [undefined, 1, 'yes']) code(() => create({ authorize: () => result }).dispatch('add', 1), 'UNAUTHORIZED');
  });
  it('cancellation rolls back including undo and reentrant callbacks cannot mutate', () => {
    const editor = create(); editor.dispatch('add', 1);
    const unsubscribe = editor.on('beforeTransaction', event => {
      expect(Object.isFrozen(event.candidate)).toBe(true);
      code(() => editor.undo(), 'REENTRANT');
      return false;
    });
    code(() => editor.undo(), 'CANCELLED');
    expect(editor.getSnapshot().revision).toBe(1);
    unsubscribe(); editor.undo(); expect(editor.getSnapshot().revision).toBe(2);
  });
  it('isolates listener failures, even error handlers, after successful commits', () => {
    const onError = vi.fn(() => { throw new Error('report failed'); });
    const editor = create({ onError });
    editor.on('transaction', () => editor.dispatch('add', 100));
    editor.on('error', () => { throw new Error('recursive'); });
    editor.subscribe(() => { throw new Error('subscriber'); });
    expect(editor.dispatch('add', 1).revision).toBe(1);
    expect(editor.getSnapshot().document.count).toBe(1);
    expect(onError).toHaveBeenCalledTimes(2);
  });
  it('rejects promise results from command, validation, updater, authorization and cancellation', () => {
    const editor = create();
    editor.registerPlugin({ id: 'async', version: '1', commands: [{ id: 'async', apply: async doc => doc }] });
    code(() => editor.dispatch('async'), 'ASYNC_UNSUPPORTED');
    code(() => editor.update(async doc => doc), 'ASYNC_UNSUPPORTED');
    code(() => create({ authorize: async () => true }).dispatch('add', 1), 'ASYNC_UNSUPPORTED');
    code(() => create({ validateDocument: async () => true }), 'ASYNC_UNSUPPORTED');
    editor.on('beforeTransaction', async () => true);
    code(() => editor.dispatch('add', 1), 'ASYNC_UNSUPPORTED');
  });
  it('reports command and payload errors without commits', () => {
    const editor = create();
    code(() => editor.dispatch('unknown'), 'UNKNOWN_COMMAND');
    code(() => editor.dispatch('add', 'x'), 'INVALID_PAYLOAD');
    code(() => editor.transact([null]), 'INVALID_PAYLOAD');
    expect(editor.getSnapshot().revision).toBe(0);
  });
  it('checks plugin registration and dependencies and removes commands on unload', () => {
    const editor = create(), cleanup = vi.fn();
    code(() => editor.registerPlugin(plugin), 'DUPLICATE_PLUGIN');
    code(() => editor.registerPlugin({ id: 'bad', version: '1', requires: ['missing'] }), 'MISSING_DEPENDENCY');
    code(() => editor.registerPlugin({ id: 'bad', version: '1', commands: plugin.commands }), 'DUPLICATE_COMMAND');
    editor.registerPlugin({ id: 'dependent', version: '1', requires: ['numbers'], setup: () => cleanup });
    code(() => editor.unregisterPlugin('numbers'), 'PLUGIN_REQUIRED');
    editor.unregisterPlugin('dependent'); expect(cleanup).toHaveBeenCalledOnce();
    editor.unregisterPlugin('numbers'); code(() => editor.dispatch('add', 1), 'UNKNOWN_COMMAND');
  });
  it('rolls back failed setup registrations and subscriptions, preventing setup mutations', () => {
    const editor = create(), listener = vi.fn();
    expect(() => editor.registerPlugin({ id: 'bad', version: '1', commands: [{ id: 'temp', apply: doc => doc }], setup: instance => {
      instance.subscribe(listener); instance.on('change', listener);
      code(() => instance.update(doc => doc), 'REENTRANT');
      throw new Error('setup failed');
    } })).toThrow('setup failed');
    expect(editor.getCommands().some(command => command.id === 'temp')).toBe(false);
    editor.dispatch('add', 1); expect(listener).not.toHaveBeenCalled();
    editor.registerPlugin({ id: 'bad', version: '1' });
  });
  it('cleans up reverse activation order on disposal and failed initialization', () => {
    const order = [];
    const a = { id: 'a', version: '1', setup: () => () => order.push('a') };
    const b = { id: 'b', version: '1', requires: ['a'], setup: () => () => order.push('b') };
    const editor = create({ plugins: [a, b] });
    editor.dispose(); editor.dispose(); expect(order).toEqual(['b', 'a']);
    code(() => editor.update(doc => doc), 'DISPOSED');
    code(() => editor.subscribe(() => {}), 'DISPOSED');
    expect(() => create({ plugins: [a, { id: 'bad', version: '1', setup: () => { throw new Error('setup'); } }] })).toThrow('setup');
    expect(order).toEqual(['b', 'a', 'a']);
  });
  it('keeps independent editor instances', () => {
    const a = create(), b = create(); a.dispatch('add', 1);
    expect(b.getSnapshot().document.count).toBe(0); expect(b.getSnapshot().canUndo).toBe(false);
  });
  it('blocks validation and policy reentrancy and freezes their input', () => {
    let editor;
    editor = create({ authorize: event => {
      code(() => editor.unregisterPlugin('numbers'), 'REENTRANT');
      expect(Object.isFrozen(event.commands[0].payload)).toBe(true);
      expect(() => { event.candidate.count = 100; }).toThrow();
      return true;
    }, validateDocument: doc => {
      if (editor) code(() => editor.dispose(), 'REENTRANT');
      expect(Object.isFrozen(doc)).toBe(true);
    } });
    editor.registerPlugin({ id: 'object', version: '1', commands: [{ id: 'object', apply: (doc, payload) => ({ ...doc, object: payload }) }] });
    const payload = { text: 'original' };
    editor.dispatch('object', payload);
    payload.text = 'modified';
    expect(editor.getSnapshot().document.object.text).toBe('original');
  });
});

describe('JSON boundary', () => {
  it('rejects unsafe data without invoking accessors', () => {
    const getter = vi.fn(); const accessor = Object.defineProperty({}, 'x', { enumerable: true, get: getter });
    const cycle = {}; cycle.self = cycle;
    for (const value of [undefined, NaN, Infinity, 1n, () => {}, new Date(), cycle, accessor, [, 1], JSON.parse('{"__proto__":{}}'), { constructor: 'x' }, { x: undefined }, { [Symbol('x')]: 1 }]) code(() => cloneJson(value), 'INVALID_JSON');
    expect(getter).not.toHaveBeenCalled();
  });
  it('accepts shared data by copying each branch and blocks transaction accessors', () => {
    const shared = { x: 1 }, copied = cloneJson({ a: shared, b: shared });
    expect(copied.a).not.toBe(copied.b);
    const getter = vi.fn(), editor = create();
    code(() => editor.transact([Object.defineProperty({}, 'type', { enumerable: true, get: getter })]), 'INVALID_JSON');
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects returned then accessors without invoking them and rejects malformed meta', () => {
    const editor = create(), getter = vi.fn();
    code(() => editor.update(() => Object.defineProperty({}, 'then', { enumerable: true, get: getter })), 'INVALID_JSON');
    expect(getter).not.toHaveBeenCalled();
    for (const meta of [null, [], 'meta', 1]) code(() => editor.undo(meta), 'INVALID_META');
    expect(editor.getSnapshot().revision).toBe(0);
  });
});
