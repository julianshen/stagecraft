import { describe, it, expect, vi } from 'vitest';
import { createEditor } from '../../core/src/index.js';
import { createProtectedSession, createSessionRequestHandler, SessionError } from './index.js';

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
  it('validates protected outputs strictly: no accessors, no NaN coercion, bounded depth', async () => {
    class Secret {}
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
    await expect(fixture({ project: () => new Date(0) }).session.read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fixture({ project: () => new Secret() }).session.read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fixture({ project: () => hidden }).session.read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fixture({ project: () => ({ nested: undefined }) }).session.read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fixture({ project: () => undefined }).session.read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    let invoked = 0;
    await expect(fixture({ project: () => ({ get value() { invoked++; return NaN; } }) }).session.read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(invoked).toBe(0);
    await expect(fixture({ project: () => NaN }).session.read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    let deep = {}; for (let n = 0; n < 70; n++) deep = { nested: deep };
    const { editor, session } = fixture({ project: ({ snapshot }) => snapshot.document });
    await session.dispatch({ type: 'title', payload: 'committed', expectedRevision: 0 });
    await expect(fixture({ project: () => deep }).session.read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fixture({ project: () => deep }).session.dispatch({ type: 'title', payload: 'deep', expectedRevision: 0 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', committed: true, revision: 1 });
    expect(editor.getSnapshot().revision).toBe(1);
    const handler = createSessionRequestHandler(fixture({ project: () => deep }).session);
    expect(await handler({ version: 1, operation: 'read', input: {} })).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE', committed: false, outcome: 'not-committed' } });
    expect(await handler({ version: 1, operation: 'dispatch', input: { type: 'title', expectedRevision: 0 } })).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE', committed: true, outcome: 'committed', revision: 1 } });
  });
  it('caps projections, rejects non-JSON providers and redacts leaked errors', async () => {
    await expect(fixture({ project: () => { throw new SessionError('RESTRICTED'); } }).session.read()).rejects.toMatchObject({ code: 'OPERATION_FAILED', message: 'OPERATION_FAILED' });
    await expect(fixture({ project: () => { throw { get code() { throw Error('RESTRICTED'); } }; } }).session.read()).rejects.toMatchObject({ code: 'OPERATION_FAILED', message: 'OPERATION_FAILED' });
    await expect(fixture({ maxResponseBytes: 192, project: () => 'x'.repeat(200) }).session.read()).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
    await expect(fixture({ context: () => undefined }).session.context()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fixture({ context: () => { throw Error('RESTRICTED'); } }).session.context()).rejects.toMatchObject({ message: 'OPERATION_FAILED' });
  });
  it('authorizes undo against the candidate it would restore', async () => {
    const editor = createEditor({ document: { title: 'restricted' }, plugins: [{ id: 'test', version: '1', commands: [{ id: 'title', apply(d, p) { d.title = p; return d; } }] }] });
    const session = createProtectedSession({ editor, identity: { id: 'limited' }, authorize: ({ operation, request }) =>
      operation !== 'undo' || request?.candidate?.document?.title !== 'restricted', project: ({ snapshot }) => ({ title: snapshot.document.title }) });
    await session.dispatch({ type: 'title', payload: 'public', expectedRevision: 0 });
    await expect(session.undo({ expectedRevision: 1 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(editor.getSnapshot().document.title).toBe('public');
    await session.dispatch({ type: 'title', payload: 'public again', expectedRevision: 1 });
    expect(await session.undo({ expectedRevision: 2 })).toMatchObject({ revision: 3, document: { title: 'public' } });
  });
  it('denies revision probing through unauthorized stale mutations', async () => {
    const { editor, session } = fixture({ authorize: () => false });
    await expect(session.dispatch({ type: 'title', payload: 'probe', expectedRevision: 5 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(session.undo({ expectedRevision: 5 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(editor.getSnapshot().revision).toBe(0);
  });
  it('supports session node budgets paired with the protocol envelope', async () => {
    const { editor, session } = fixture({ maxResponseNodes: 50, project: ({ snapshot }) => ({ title: snapshot.document.title, list: Array(41).fill(0) }) });
    // A wrapped {title, Array(N)} result costs N+7 nodes: 41+7 exceeds the 50−3 budget.
    await expect(session.dispatch({ type: 'title', payload: 'big', expectedRevision: 0 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', committed: true, revision: 1 });
    expect(editor.getSnapshot().revision).toBe(1);
    const small = fixture({ maxResponseNodes: 50, project: ({ snapshot }) => ({ title: snapshot.document.title, list: Array(40).fill(0) }) });
    await expect(small.session.dispatch({ type: 'title', payload: 'fits', expectedRevision: 0 })).resolves.toMatchObject({ revision: 1 });
  });
  it('bounds request inputs with a request budget and request code', async () => {
    const { session } = fixture({ maxRequestBytes: 64 });
    await expect(session.dispatch({ type: 'title', payload: 'x'.repeat(200), expectedRevision: 0 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(session.dispatch({ type: 'title', payload: 'ok', expectedRevision: 0, get extra() { return 1; } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const { editor, session: open } = fixture();
    await expect(open.dispatch({ type: 'title', payload: NaN, expectedRevision: 0 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(editor.getSnapshot().document.title).toBe('public');
  });
  it('rejects non-JSON payloads before serialization can coerce them', async () => {
    const { session, editor } = fixture();
    await expect(session.dispatch({ type: 'title', payload: NaN, expectedRevision: 0 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(editor.getSnapshot().document.title).toBe('public');
  });
  it('rejects non-function context and export callbacks at construction', () => {
    expect(() => fixture({ context: 'nope' })).toThrow(TypeError);
    expect(() => fixture({ exportDocument: 7 })).toThrow(TypeError);
  });
  it('rejects sparse and non-index array request input with public codes on every mutation entry', async () => {
    const { editor, session } = fixture();
    const sparse = [, 1];
    const extraKey = [1, 2]; extraKey.extra = 'x';
    const stretched = [1]; stretched.length = 3;
    for (const [operation, request] of [
      ['transact', { commands: sparse, expectedRevision: 0 }],
      ['undo', { expectedRevision: 0, x: extraKey }],
      ['redo', { expectedRevision: 0, x: stretched }],
      ['dispatch', { type: 'title', payload: sparse, expectedRevision: 0 }],
    ]) {
      const pending = session[operation](request);
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(editor.getSnapshot().revision).toBe(0);
  });
  it('rejects sparse and non-index array protected outputs with the response code', async () => {
    const extraKey = [1, 2]; extraKey.extra = 'x';
    const stretched = [1]; stretched.length = 2;
    await expect(fixture({ project: () => sparseOutput() }).session.read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fixture({ project: () => extraKey }).session.read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fixture({ project: () => stretched }).session.read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  function sparseOutput() { return [, 1]; }
  it('rejects invalid mutation input through promises with sanitized public codes', async () => {
    const { editor, session } = fixture();
    for (const [operation, request] of [
      ['transact', { commands: [{ type: 'title', payload: 'x' }], expectedRevision: 0, bad: new Date() }],
      ['undo', { expectedRevision: 0, x: new Date() }],
      ['redo', { expectedRevision: 0, x: new Date() }],
      ['undo', { expectedRevision: 0, constructor: 'x' }],
    ]) {
      const pending = session[operation](request);
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(editor.getSnapshot().revision).toBe(0);
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
  it('refuses to reach the kernel when close lands in the authorization microtask', async () => {
    const { editor, session } = fixture();
    const pending = session.dispatch({ type: 'title', payload: 'closed', expectedRevision: 0 });
    queueMicrotask(() => session.close());
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CLOSED', committed: false });
    expect(editor.getSnapshot().revision).toBe(0);
    expect(editor.getSnapshot().document.title).toBe('public');
  });
  it('retains an authoritative committed receipt when close lands during post-commit projection', async () => {
    const gate = deferred(); const entered = deferred();
    const { editor, session } = fixture({ project: async ({ snapshot }) => { entered.resolve(); await gate.promise; return { title: snapshot.document.title }; } });
    const pending = session.dispatch({ type: 'title', payload: 'committed', expectedRevision: 0 });
    await entered.promise;
    session.close(); gate.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CLOSED', committed: true, revision: 1 });
    expect(editor.getSnapshot().revision).toBe(1);
  });
  it('stops discovery policy callbacks once the session closes', async () => {
    const gate = deferred(); const calls = [];
    const editor = createEditor({ document: { title: 'x' }, plugins: [{ id: 'multi', version: '1', commands: [
      { id: 'a', apply: draft => draft }, { id: 'b', apply: draft => draft },
    ] }] });
    const session = createProtectedSession({ editor, identity: { id: 'trusted' }, authorize: ({ operation, request }) => {
      calls.push(`${operation}:${request?.type ?? ''}`);
      if (operation === 'tool' && request.type === 'a') return gate.promise;
      return true;
    }, project: ({ snapshot }) => snapshot.document });
    const pending = session.listCommands();
    for (let i = 0; i < 100 && !calls.includes('tool:a'); i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls).toContain('tool:a');
    session.close(); gate.resolve(true);
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    expect(calls).toEqual(['tools:', 'tool:a']);
  });
  it('checks closure after a denied discovery policy too', async () => {
    const gate = deferred(); const calls = [];
    const editor = createEditor({ document: { title: 'x' }, plugins: [{ id: 'multi', version: '1', commands: [
      { id: 'a', apply: draft => draft }, { id: 'b', apply: draft => draft },
    ] }] });
    // Discovery itself stays authorized; only the per-command policies deny.
    const session = createProtectedSession({ editor, identity: { id: 'trusted' }, authorize: ({ operation, request }) => {
      calls.push(`${operation}:${request?.type ?? ''}`);
      if (operation === 'tool' && request.type === 'a') return gate.promise;
      return operation !== 'tool';
    }, project: ({ snapshot }) => snapshot.document });
    const pending = session.listCommands();
    for (let i = 0; i < 100 && !calls.includes('tool:a'); i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls).toContain('tool:a');
    session.close(); gate.resolve(false);
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    expect(calls).toEqual(['tools:', 'tool:a']);
  });
  it('does not deliver mutation success after closure in the post-commit projection window', async () => {
    const editor = createEditor({ document: { title: 'public' }, plugins: [{ id: 'test', version: '1', commands: [{ id: 'title', apply(d, p) { d.title = p; return d; } }] }] });
    let session;
    session = createProtectedSession({ editor, identity: { id: 'trusted' }, authorize: () => true,
      project: ({ snapshot }) => { queueMicrotask(() => queueMicrotask(() => session.close())); return { title: snapshot.document.title }; } });
    const pending = session.dispatch({ type: 'title', payload: 'committed', expectedRevision: 0 });
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CLOSED', committed: true, revision: 1 });
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
