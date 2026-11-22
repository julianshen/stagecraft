import type { Editor, CommandRequest } from '@stagecraft/core/editor';
export interface Snapshot<D = unknown> { readonly document: D; readonly revision: number }
export interface CommandInfo { readonly id: string; readonly description?: string; readonly inputSchema?: unknown }
export interface MutationRequest { expectedRevision: number; dryRun?: boolean }
export interface MutationResult<P = unknown> extends Snapshot<P> { changed: boolean; dryRun: boolean }
export interface Command extends CommandRequest {}
export interface Session<P = unknown> {
  read(): Promise<Snapshot<P>>;
  context(request?: unknown): Promise<unknown>;
  export(request?: unknown): Promise<unknown>;
  dispatch(request: MutationRequest & Command): Promise<MutationResult<P>>;
  transact(request: MutationRequest & { commands: Command[] }): Promise<MutationResult<P>>;
  undo(request: MutationRequest): Promise<MutationResult<P>>;
  redo(request: MutationRequest): Promise<MutationResult<P>>;
  listCommands(): Promise<CommandInfo[]>;
  close(): void;
}
export type SessionOutcome = 'unknown' | 'committed' | 'not-committed';
export class SessionError extends Error {
  constructor(code: string, revision?: number, committed?: boolean, outcome?: SessionOutcome);
  readonly code: string;
  readonly revision?: number;
  /** Known positive commit receipt only. false does not imply rollback; inspect outcome. */
  readonly committed: boolean;
  /** Remote failures after sending a mutation can have an unknown outcome. */
  readonly outcome: SessionOutcome;
}
export interface SessionOptions<D, P> {
  editor: Pick<Editor<D>, 'getSnapshot' | 'getCommands' | 'transact' | 'undo' | 'redo'>;
  identity: unknown;
  authorize(input: { identity: unknown; operation: string; snapshot: Snapshot<D>; request: unknown }): boolean | Promise<boolean>;
  project(input: { identity: unknown; operation: string; snapshot: Snapshot<D> }): P | Promise<P>;
  context?(input: { document: P; revision: number; request: unknown }): unknown | Promise<unknown>;
  /** Return JSON metadata such as an authorized artifact ID; send binary data via a host transport. */
  exportDocument?(input: { document: P; revision: number; request: unknown }): unknown | Promise<unknown>;
  maxResponseBytes?: number;
}
export function createProtectedSession<D, P>(options: SessionOptions<D, P>): Session<P>;

export type SessionOperation = 'read' | 'context' | 'export' | 'dispatch' | 'transact' | 'undo' | 'redo' | 'listCommands';
export type SessionProtocolRequest =
  | { version: 1; operation: 'read' | 'listCommands'; input: Record<string, never> }
  | { version: 1; operation: 'context' | 'export'; input: unknown }
  | { version: 1; operation: 'dispatch'; input: MutationRequest & Command }
  | { version: 1; operation: 'transact'; input: MutationRequest & { commands: Command[] } }
  | { version: 1; operation: 'undo' | 'redo'; input: MutationRequest };
export type SessionProtocolResponse =
  | { version: 1; ok: true; result: unknown }
  | { version: 1; ok: false; error: { code: string; committed: boolean; revision?: number; outcome?: SessionOutcome } };
/** No network listener or authentication is created; bind to a host-authenticated session. */
export function createSessionRequestHandler(session: Session, options?: { maxRequestBytes?: number }): (request: unknown) => Promise<SessionProtocolResponse>;
export interface RemoteSessionOptions {
  /** Transport carries JSON envelopes and supplies host authentication and routing. */
  request(message: SessionProtocolRequest): unknown | Promise<unknown>;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}
/** close() rejects pending work locally; it does not cancel an already committed host operation. */
export function createRemoteSession<P = unknown>(options: RemoteSessionOptions): Session<P>;
