// Compile-only consumer: @stagecraft/server declarations must resolve and type-check
// without source aliases, including the protected-session/remote protocol surface.
import {
  createProtectedSession, createSessionRequestHandler, createRemoteSession, SessionError,
  type Session, type SessionError as SessionErrorType, type SessionOutcome,
  type MutationResult, type Snapshot, type CommandInfo,
} from '@stagecraft/server';
import { createEditor } from '@stagecraft/core/editor';

const editor = createEditor({ document: { title: 'Typed host' }, plugins: [{
  id: 'title', version: '1', commands: [{ id: 'title', apply: (draft, payload) => ({ ...draft, title: String(payload) }) }],
}] });

interface HostIdentity { id: string; scopes: string[] }

const session: Session<{ title: string }> = createProtectedSession({
  editor,
  identity: { id: 'host', scopes: ['read'] } satisfies HostIdentity,
  // SessionOptions types host identity as unknown: the host narrows its own shape.
  authorize: ({ identity, operation, request }) => (identity as HostIdentity).scopes.includes('read') && typeof operation === 'string',
  project: ({ snapshot }) => ({ title: snapshot.document.title }),
  context: ({ document, revision, request }) => ({ title: document.title, revision, hasRequest: request !== undefined }),
  exportDocument: ({ document, revision }) => ({ artifact: document.title, revision }),
  maxResponseBytes: 65536,
});

async function receipts(): Promise<void> {
  const snapshot: Snapshot<{ title: string }> = await session.read();
  const title: string = snapshot.document.title;
  const revision: number = snapshot.revision;
  const context: unknown = await session.context({ selective: true });
  const exported: unknown = await session.export();
  const command: CommandInfo[] = await session.listCommands();
  const mutated: MutationResult<{ title: string }> = await session.dispatch({
    type: 'title', payload: 'next', expectedRevision: revision,
  });
  const batch: MutationResult<{ title: string }> = await session.transact({
    commands: [{ type: 'title', payload: 'batched' }], expectedRevision: mutated.revision, dryRun: true,
  });
  const undone: MutationResult<{ title: string }> = await session.undo({ expectedRevision: batch.revision });
  await session.redo({ expectedRevision: undone.revision });
  session.close();
  void context; void exported; void command; void title;
}

const handler: (request: unknown) => Promise<{ version: 1; ok: true; result: unknown } | { version: 1; ok: false; error: { code: string; committed: boolean; revision?: number; outcome?: SessionOutcome } }> =
  createSessionRequestHandler(session, { maxRequestBytes: 4096 });

const remote: Session<{ title: string }> = createRemoteSession<{ title: string }>({
  request: message => handler(message),
  maxRequestBytes: 4096,
  maxResponseBytes: 65536,
});

const failure = new SessionError('OPERATION_FAILED', 2, true, 'committed');
const code: string = failure.code;
const committed: boolean = failure.committed;
const outcome: SessionOutcome = failure.outcome;
const known: SessionErrorType = failure;
if (outcome === 'unknown') void known;

void receipts; void remote; void code;
