import { describe, expect, it } from 'vitest';
import { createEditor } from '@stagecraft/core/editor';
// Consumer-style gate: resolve the package through its published exports the way a
// standalone host would, not through relative source paths.
import { createProtectedSession, createRemoteSession, createSessionRequestHandler, SessionError } from '@stagecraft/server';

describe('@stagecraft/server consumer entrypoint', () => {
  it('round trips the JSON protocol through the workspace package exports', async () => {
    const editor = createEditor({ document: { title: 'consumer' }, plugins: [{ id: 'c', version: '1', commands: [{ id: 'title', apply(d, value) { d.title = value; return d; } }] }] });
    const session = createProtectedSession({ editor, identity: { id: 'host' }, authorize: () => true, project: ({ snapshot }) => ({ title: snapshot.document.title }) });
    const remote = createRemoteSession({ request: createSessionRequestHandler(session) });
    expect(await remote.read()).toEqual({ document: { title: 'consumer' }, revision: 0 });
    expect(await remote.dispatch({ type: 'title', payload: 'edited', expectedRevision: 0 })).toMatchObject({ revision: 1, document: { title: 'edited' } });
    await expect(remote.dispatch({ type: 'title', payload: 'stale', expectedRevision: 0 })).rejects.toMatchObject({ code: 'STALE_REVISION', outcome: 'not-committed' });
    expect(new SessionError('X').code).toBe('X');
    session.close();
    await expect(remote.read()).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    expect(editor.getSnapshot().document.title).toBe('edited');
  });
});
