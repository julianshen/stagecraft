import { describe, it, expect, vi } from 'vitest';
import { createEditor } from '../../core/src/index.js';
import { createProtectedSession, SessionError } from './index.js';

const plugin = { id: 'test', version: '1', commands: [{ id: 'title', apply(draft, payload) { draft.title = payload; return draft; } }] };
function fixture(options = {}) {
  const editor = createEditor({ document: { title: 'public', secret: 'RESTRICTED' }, plugins: [plugin] });
  const session = createProtectedSession({ editor, identity: { id: 'trusted' }, authorize: () => true,
    project: ({ snapshot }) => ({ title: snapshot.document.title }), ...options });
  return { editor, session };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

describe('protected sessions', () => {
  it('projects reads, dry runs, commits and history without canonical fields', async () => {
    const { session, editor } = fixture();
    expect(await session.read()).toEqual({ document: { title: 'public' }, revision: 0 });
    expect(await session.dispatch({ type: 'title', payload: 'new', expectedRevision: 0, dryRun: true })).toEqual({ document: { title: 'new' }, revision: 0, changed: true, dryRun: true });
    expect(editor.getSnapshot().revision).toBe(0);
    expect(await session.dispatch({ type: 'title', payload: 'new', expectedRevision: 0 })).toMatchObject({ document: { title: 'new' }, revision: 1 });
    expect(await session.undo({ expectedRevision: 1 })).toMatchObject({ document: { title: 'public' }, revision: 2 });
    expect(await session.redo({ expectedRevision: 2 })).toMatchObject({ document: { title: 'new' }, revision: 3 });
    expect(editor.getSnapshot().document.secret).toBe('RESTRICTED');
  });
  it('fails closed for missing policy, denied policy and thrown secret errors', async () => {
    expect(() => createProtectedSession({})).toThrow();
    for (const authorize of [() => false, () => undefined, () => { throw Error('RESTRICTED'); }]) {
      const { session } = fixture({ authorize });
      await expect(session.read()).rejects.not.toThrow('RESTRICTED');
      await expect(session.dispatch({ type: 'title', payload: 'new', expectedRevision: 0 })).rejects.toThrow();
    }
  });
  it('requires revisions and rejects malformed requests', async () => {
    const { session } = fixture();
    await expect(session.dispatch(null)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(session.undo({})).rejects.toMatchObject({ code: 'REVISION_REQUIRED' });
    await expect(session.redo({ expectedRevision: 9 })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    await expect(session.transact({ expectedRevision: 0, dryRun: 'yes' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
  it('surfaces unknown commands as public codes without committing the batch', async () => {
    const { editor, session } = fixture();
    await expect(session.dispatch({ type: 'nosuch', payload: {}, expectedRevision: 0 })).rejects.toMatchObject({ code: 'UNKNOWN_COMMAND', committed: false });
    await expect(session.transact({ commands: [{ type: 'title', payload: 'queued' }, { type: 'nosuch' }], expectedRevision: 0 })).rejects.toMatchObject({ code: 'UNKNOWN_COMMAND', committed: false });
    expect(editor.getSnapshot().revision).toBe(0);
    expect(editor.getSnapshot().document.title).toBe('public');
  });
  it('binds async authorization to the captured revision', async () => {
    const gate = deferred();
    const { editor, session } = fixture({ authorize: () => gate.promise });
    const pending = session.dispatch({ type: 'title', payload: 'remote', expectedRevision: 0 });
    editor.dispatch('title', 'concurrent');
    gate.resolve(true);
    await expect(pending).rejects.toMatchObject({ code: 'STALE_REVISION', committed: false });
    expect(editor.getSnapshot().document.title).toBe('concurrent');
  });
  it('projects the committed snapshot even if another write occurs during projection', async () => {
    const gate = deferred();
    const entered = deferred();
    const { editor, session } = fixture({ project: async ({ snapshot }) => { entered.resolve(); await gate.promise; return { title: snapshot.document.title }; } });
    const pending = session.dispatch({ type: 'title', payload: 'first', expectedRevision: 0 });
    await entered.promise;
    editor.dispatch('title', 'second');
    gate.resolve();
    expect(await pending).toMatchObject({ document: { title: 'first' }, revision: 1 });
  });
  it('redacts command and projector errors and acknowledges post-commit failure', async () => {
    const { editor, session } = fixture({ project() { throw Error('RESTRICTED'); } });
    editor.registerPlugin({ id: 'bad', version: '1', commands: [{ id: 'bad', apply() { throw Error('RESTRICTED'); } }] });
    await expect(session.dispatch({ type: 'bad', payload: {}, expectedRevision: 0 })).rejects.toMatchObject({ message: 'OPERATION_FAILED', committed: false });
    await expect(session.dispatch({ type: 'title', payload: 'committed', expectedRevision: 0 })).rejects.toMatchObject({ message: 'OPERATION_FAILED', committed: true, revision: 1 });
    await expect(session.read()).rejects.toMatchObject({ message: 'OPERATION_FAILED' });
  });
  it('separately gates context/export and only supplies projected data', async () => {
    const context = vi.fn(({ document }) => document);
    const exportDocument = vi.fn(({ document }) => ({ artifact: document.title }));
    const { session } = fixture({ context, exportDocument });
    expect(await session.context()).toEqual({ title: 'public' });
    expect(await session.export()).toEqual({ artifact: 'public' });
    expect(context.mock.calls[0][0]).not.toHaveProperty('snapshot');
    expect(await fixture().session.context()).toEqual({ revision: 0 });
    await expect(fixture().session.export()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(fixture({ authorize: ({ operation }) => operation !== 'context' }).session.context()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('caps projections, rejects non-JSON providers and redacts leaked errors', async () => {
    await expect(fixture({ project: () => { throw new SessionError('RESTRICTED'); } }).session.read()).rejects.toMatchObject({ code: 'OPERATION_FAILED', message: 'OPERATION_FAILED' });
    await expect(fixture({ project: () => { throw { get code() { throw Error('RESTRICTED'); } }; } }).session.read()).rejects.toMatchObject({ code: 'OPERATION_FAILED', message: 'OPERATION_FAILED' });
    await expect(fixture({ maxResponseBytes: 100, project: () => 'x'.repeat(101) }).session.read()).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    await expect(fixture({ context: () => undefined }).session.context()).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    await expect(fixture({ context: () => { throw Error('RESTRICTED'); } }).session.context()).rejects.toMatchObject({ message: 'OPERATION_FAILED' });
  });
  it('rejects non-JSON payloads before serialization can coerce them', async () => {
    const { session, editor } = fixture();
    await expect(session.dispatch({ type: 'title', payload: NaN, expectedRevision: 0 })).rejects.toMatchObject({ code: 'OPERATION_FAILED' });
    expect(editor.getSnapshot().document.title).toBe('public');
  });
  it('uses trusted identity, filters commands, and closes without disposing editor', async () => {
    const identity = { id: 'original' };
    const authorize = vi.fn(({ identity, operation }) => identity.id === 'original' && operation !== 'tool');
    const { editor, session } = fixture({ identity, authorize });
    identity.id = 'modified';
    expect(await session.listCommands()).toEqual([]);
    await session.transact({ commands: [{ type: 'title', payload: 'new' }], expectedRevision: 0, actor: { id: 'forged' } });
    expect(authorize.mock.calls.every(([arg]) => arg.identity.id === 'original')).toBe(true);
    session.close();
    await expect(session.read()).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    await expect(session.listCommands()).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    expect(editor.getSnapshot().revision).toBe(1);
  });
  it('rejects an in-flight operation after close', async () => {
    const gate = deferred();
    const { session, editor } = fixture({ authorize: () => gate.promise });
    const pending = session.undo({ expectedRevision: 0 });
    session.close(); gate.resolve(true);
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    expect(editor.getSnapshot().revision).toBe(0);
  });
});
