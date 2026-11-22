import { describe, it, expect, vi } from 'vitest';
import { createEditor } from '../../core/src/index.js';
import { createProtectedSession, createRemoteSession, createSessionRequestHandler } from './index.js';
function setup(options = {}) {
  const editor = createEditor({ document: { title: 'public', secret: 'PRIVATE' }, plugins: [{ id: 'test', version: '1', commands: [
    { id: 'title', apply(document, payload) { document.title = payload; return document; } },
  ] }] });
  const session = createProtectedSession({ editor, identity: { id: 'trusted' }, authorize: () => true,
    project: ({ snapshot }) => ({ title: snapshot.document.title }),
    context: ({ document }) => document, exportDocument: ({ document }) => ({ artifact: document.title }), ...options });
  const handler = createSessionRequestHandler(session);
  // Simulate a real JSON boundary in both directions.
  const request = vi.fn(async message => JSON.parse(JSON.stringify(await handler(JSON.parse(JSON.stringify(message))))));
  return { editor, session, handler, request, remote: createRemoteSession({ request }) };
}
describe('remote session protocol', () => {
  it('round trips every operation with authorized projections and revision receipts', async () => {
    const { remote, request, editor } = setup();
    expect(await remote.read()).toEqual({ document: { title: 'public' }, revision: 0 });
    expect(await remote.context()).toEqual({ title: 'public' });
    expect(await remote.export()).toEqual({ artifact: 'public' });
    expect(await remote.listCommands()).toEqual([expect.objectContaining({ id: 'title' })]);
    expect(await remote.dispatch({ type: 'title', payload: 'dry', expectedRevision: 0, dryRun: true })).toMatchObject({ revision: 0, dryRun: true });
    expect(await remote.transact({ commands: [{ type: 'title', payload: 'new' }], expectedRevision: 0 })).toMatchObject({ revision: 1, document: { title: 'new' } });
    expect(await remote.undo({ expectedRevision: 1 })).toMatchObject({ revision: 2, document: { title: 'public' } });
    expect(await remote.redo({ expectedRevision: 2 })).toMatchObject({ revision: 3, document: { title: 'new' } });
    expect(request.mock.calls[0][0]).toEqual({ version: 1, operation: 'read', input: {} });
    expect(editor.getSnapshot().document.secret).toBe('PRIVATE');
  });
  it('rejects unknown operations, extra keys, missing revisions and non-JSON input before execution', async () => {
    const { handler, editor } = setup();
    const invalid = [
      { version: 2, operation: 'read', input: {} }, { version: 1, operation: 'close', input: {} },
      { version: 1, operation: 'read', input: {}, identity: { id: 'admin' } },
      { version: 1, operation: 'read', input: { actor: 'admin' } },
      { version: 1, operation: 'dispatch', input: { type: 'title', expectedRevision: 0, actor: 'admin' } },
      { version: 1, operation: 'transact', input: { expectedRevision: 0, commands: [{ type: 'title', meta: {} }] } },
      { version: 1, operation: 'dispatch', input: { type: 'title', expectedRevision: 0, payload: NaN } },
    ];
    for (const message of invalid) expect(await handler(message)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST', committed: false } });
    expect(await handler({ version: 1, operation: 'undo', input: {} })).toMatchObject({ error: { code: 'REVISION_REQUIRED' } });
    expect(editor.getSnapshot().revision).toBe(0);
  });
  it('surfaces unknown commands as sanitized public codes end to end', async () => {
    const { handler, remote, editor } = setup();
    expect(await handler({ version: 1, operation: 'dispatch', input: { type: 'nosuch', expectedRevision: 0 } })).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND', committed: false, outcome: 'not-committed' } });
    await expect(remote.dispatch({ type: 'nosuch', expectedRevision: 0 })).rejects.toMatchObject({ code: 'UNKNOWN_COMMAND', outcome: 'not-committed' });
    expect(editor.getSnapshot().revision).toBe(0);
  });
  it('bounds payload sizes and depth without invoking getters', async () => {
    const { session } = setup();
    const handler = createSessionRequestHandler(session, { maxRequestBytes: 100 });
    expect(await handler({ version: 1, operation: 'context', input: 'x'.repeat(100) })).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    const getter = vi.fn();
    expect((await handler({ get version() { getter(); return 1; } })).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    let nested = {}; for (let n = 0; n < 70; n++) nested = { nested };
    expect((await handler(nested)).ok).toBe(false);
  });
  it('preserves post-commit receipts but sanitizes host and transport errors', async () => {
    const { remote, editor } = setup({ project() { throw Error('PRIVATE'); } });
    await expect(remote.dispatch({ type: 'title', payload: 'committed', expectedRevision: 0 })).rejects.toMatchObject({ message: 'OPERATION_FAILED', committed: true, revision: 1 });
    expect(editor.getSnapshot().revision).toBe(1);
    await expect(remote.read()).rejects.toMatchObject({ message: 'OPERATION_FAILED', committed: false });
    await expect(createRemoteSession({ request() { throw Error('PRIVATE'); } }).read()).rejects.toMatchObject({ message: 'TRANSPORT_FAILED', committed: false });
    await expect(createRemoteSession({ request: () => ({ version: 1, ok: false, error: { code: 'PRIVATE', committed: false } }) }).read()).rejects.toMatchObject({ message: 'INVALID_RESPONSE' });
  });
  it('keeps the whole response envelope within the shared depth budget', async () => {
    const nested = levels => { let node = { leaf: true }; for (let i = 0; i < levels; i++) node = { nested: node }; return node; };
    let deep = null;
    const { handler, editor } = setup({ project: () => ({ title: 'doc', deep }) });
    const remote = createRemoteSession({ request: async message => JSON.parse(JSON.stringify(await handler(JSON.parse(JSON.stringify(message))))) });
    deep = nested(60);
    expect(await remote.dispatch({ type: 'title', payload: 'committed', expectedRevision: 0 })).toMatchObject({ revision: 1 });
    deep = nested(61);
    await expect(remote.dispatch({ type: 'title', payload: 'second', expectedRevision: 1 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', committed: true, outcome: 'committed', revision: 2 });
    expect(editor.getSnapshot().revision).toBe(2);
  });
  it('keeps the whole response envelope within equal byte limits at the exact boundary', async () => {
    const projector = { text: '' };
    const editor = createEditor({ document: { title: 'public', secret: 'PRIVATE' }, plugins: [{ id: 'test', version: '1', commands: [{ id: 'title', apply(d, p) { d.title = p; return d; } }] }] });
    const session = createProtectedSession({ editor, identity: { id: 'trusted' }, authorize: () => true,
      project: () => ({ text: projector.text }), maxResponseBytes: 1024,
      context: ({ document }) => document, exportDocument: ({ document }) => ({ artifact: document.title }) });
    const handler = createSessionRequestHandler(session);
    const remote = createRemoteSession({ request: async message => JSON.parse(JSON.stringify(await handler(JSON.parse(JSON.stringify(message))))), maxResponseBytes: 1024 });
    projector.text = 'x'.repeat(924);
    expect(await remote.dispatch({ type: 'title', payload: 'committed', expectedRevision: 0 })).toMatchObject({ revision: 1, document: { text: projector.text } });
    projector.text = 'x'.repeat(925);
    await expect(remote.dispatch({ type: 'title', payload: 'second', expectedRevision: 1 })).rejects.toMatchObject({ code: 'RESPONSE_LIMIT', committed: true, outcome: 'committed', revision: 2 });
    expect(editor.getSnapshot().revision).toBe(2);
  });
  it('reserves the envelope nodes so the committed receipt survives the exact node boundary', async () => {
    // Default limits: the shared node cap is 100000 and the success envelope counts three extra
    // nodes ({version, ok, result}); an Array(N) mutation result costs N+5 nodes.
    const editor = createEditor({ document: { n: 0 }, plugins: [{ id: 'inc', version: '1', commands: [{ id: 'inc', apply(d) { d.n += 1; return d; } }] }] });
    const pair = list => {
      // The review's exact repro shape: the projector returns the bare array.
      const session = createProtectedSession({ editor, identity: {}, authorize: () => true, project: () => list });
      const handler = createSessionRequestHandler(session);
      return createRemoteSession({ request: async message => JSON.parse(JSON.stringify(await handler(JSON.parse(JSON.stringify(message))))) });
    };
    expect(await pair(Array(99992).fill(0)).dispatch({ type: 'inc', expectedRevision: 0 })).toMatchObject({ revision: 1 });
    await expect(pair(Array(99993).fill(0)).dispatch({ type: 'inc', expectedRevision: 1 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', committed: true, outcome: 'committed', revision: 2 });
    expect(editor.getSnapshot().revision).toBe(2);
  });
  it('rejects response limits too small to carry an error receipt on both ends', async () => {
    const editor = createEditor({ document: { title: 'x' }, plugins: [{ id: 't', version: '1', commands: [{ id: 'title', apply: (d, v) => ({ ...d, title: v }) }] }] });
    expect(() => createProtectedSession({ editor, identity: {}, authorize: () => true, project: ({ snapshot }) => snapshot.document, maxResponseBytes: 100 })).toThrow(/response limit/);
    expect(() => createRemoteSession({ request: () => ({}), maxResponseBytes: 100 })).toThrow(/response limit/);
    // The supported minimum itself constructs fine.
    expect(() => createProtectedSession({ editor, identity: {}, authorize: () => true, project: ({ snapshot }) => snapshot.document, maxResponseBytes: 192 })).not.toThrow();
  });
  it('rejects node budgets too small to carry an error receipt on both ends', async () => {
    const editor = createEditor({ document: { title: 'x' }, plugins: [{ id: 't', version: '1', commands: [{ id: 'title', apply: (d, v) => ({ ...d, title: v }) }] }] });
    for (const nodes of [4, 7]) {
      expect(() => createProtectedSession({ editor, identity: {}, authorize: () => true, project: () => 0, maxResponseNodes: nodes })).toThrow(/node limit/);
      expect(() => createRemoteSession({ request: () => ({}), maxResponseNodes: nodes })).toThrow(/node limit/);
    }
    // The supported minimum carries the eight-node receipt end to end.
    const session = createProtectedSession({ editor, identity: {}, authorize: () => true, project: () => 0, maxResponseNodes: 16 });
    const handler = createSessionRequestHandler(session);
    const remote = createRemoteSession({ request: async message => JSON.parse(JSON.stringify(await handler(JSON.parse(JSON.stringify(message))))) , maxResponseNodes: 16 });
    expect(await remote.dispatch({ type: 'title', payload: 'fits', expectedRevision: 0 })).toMatchObject({ revision: 1 });
  });
  it('validates read and discovery success shapes against the protocol', async () => {
    await expect(createRemoteSession({ request: () => ({ version: 1, ok: true, result: 17 }) }).read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(createRemoteSession({ request: () => ({ version: 1, ok: true, result: { document: {}, revision: -1 } }) }).read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(createRemoteSession({ request: () => ({ version: 1, ok: true, result: { document: {}, revision: Number.MAX_SAFE_INTEGER + 1 } }) }).read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(createRemoteSession({ request: () => ({ version: 1, ok: true, result: { document: {} } }) }).read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(createRemoteSession({ request: () => ({ version: 1, ok: true, result: null }) }).listCommands()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(createRemoteSession({ request: () => ({ version: 1, ok: true, result: [{ id: 7 }] }) }).listCommands()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(createRemoteSession({ request: () => ({ version: 1, ok: true, result: [{ id: 'a', unknown: true }] }) }).listCommands()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    // Context/export stay arbitrary bounded JSON by contract.
    expect(await createRemoteSession({ request: () => ({ version: 1, ok: true, result: 17 }) }).context()).toBe(17);
    expect(await createRemoteSession({ request: () => ({ version: 1, ok: true, result: null }) }).export()).toBeNull();
  });
  it('enforces permissions and filters command discovery', async () => {
    const { remote } = setup({ authorize: ({ identity, operation }) => identity.id === 'trusted' && !['tool', 'export'].includes(operation) });
    expect(await remote.listCommands()).toEqual([]);
    await expect(remote.export()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('rejects missing revisions locally without invoking transport', async () => {
    const { remote, request } = setup();
    await expect(remote.undo({})).rejects.toMatchObject({ code: 'REVISION_REQUIRED' });
    expect(request).not.toHaveBeenCalled();
  });
  it('closes immediately while transport hangs and rejects late responses', async () => {
    let finish;
    const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const remote = createRemoteSession({ request });
    const pending = remote.read();
    await Promise.resolve();
    remote.close();
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    finish({ version: 1, ok: true, result: { secret: 'late' } });
    await expect(remote.read()).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('remote mutation outcome receipts', () => {
  it('marks oversized and lost post-commit responses unknown instead of reporting rollback', async () => {
    for (const mode of ['oversized', 'lost', 'malformed']) {
      const { handler, editor } = setup();
      const remote = createRemoteSession({ maxResponseBytes: mode === 'oversized' ? 192 : 1048576,
        request: async message => {
          const response = await handler(message);
          if (mode === 'lost') throw Error('private network diagnostic');
          if (mode === 'malformed') return { version: 1, ok: true, result: { revision: 1 } };
          return response;
        } });
      await expect(remote.dispatch({ type: 'title', payload: 'x'.repeat(150), expectedRevision: 0 })).rejects.toMatchObject({
        code: mode === 'lost' ? 'TRANSPORT_FAILED' : 'INVALID_RESPONSE', committed: false, outcome: 'unknown',
      });
      expect(editor.getSnapshot().revision).toBe(1);
    }
  });
  it('marks close after sending a mutation unknown even if its response arrives later', async () => {
    const { handler, editor } = setup();
    let release, committed;
    const gate = new Promise(resolve => { release = resolve; });
    const reached = new Promise(resolve => { committed = resolve; });
    const remote = createRemoteSession({ request: async message => {
      const response = await handler(message); committed(); await gate; return response;
    } });
    const pending = remote.dispatch({ type: 'title', payload: 'committed', expectedRevision: 0 });
    await reached;
    remote.close();
    await expect(pending).rejects.toMatchObject({ committed: false, outcome: 'unknown', code: 'SESSION_CLOSED' });
    expect(editor.getSnapshot().revision).toBe(1);
    release();
  });
  it('retains authoritative committed and not-committed receipts', async () => {
    const { remote } = setup({ project() { throw Error('private'); } });
    await expect(remote.dispatch({ type: 'title', payload: 'committed', expectedRevision: 0 })).rejects.toMatchObject({ committed: true, outcome: 'committed', revision: 1 });
    await expect(remote.dispatch({ type: 'title', payload: 'stale', expectedRevision: 0 })).rejects.toMatchObject({ committed: false, outcome: 'not-committed', code: 'STALE_REVISION' });
  });
  it('preserves unknown outcomes across a handler wrapping another remote session', async () => {
    const { handler, editor } = setup();
    const upstream = createRemoteSession({ request: async message => { await handler(message); throw Error('lost'); } });
    const remote = createRemoteSession({ request: createSessionRequestHandler(upstream) });
    await expect(remote.dispatch({ type: 'title', payload: 'committed', expectedRevision: 0 })).rejects.toMatchObject({ outcome: 'unknown', committed: false });
    expect(editor.getSnapshot().revision).toBe(1);
  });
  it('reports not-committed for validation and close before sending', async () => {
    const request = vi.fn();
    const remote = createRemoteSession({ request });
    await expect(remote.undo({})).rejects.toMatchObject({ outcome: 'not-committed' });
    const pending = remote.undo({ expectedRevision: 0 });
    remote.close();
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CLOSED', outcome: 'not-committed' });
    await expect(remote.undo({ expectedRevision: 0 })).rejects.toMatchObject({ outcome: 'not-committed' });
    expect(request).not.toHaveBeenCalled();
  });
});
