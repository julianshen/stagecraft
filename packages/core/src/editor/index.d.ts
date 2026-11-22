export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface EditorMeta { expectedRevision?: number; dryRun?: boolean; [key: string]: unknown }
export interface EditorSnapshot<Document = JsonValue> { readonly document: Document; readonly revision: number; readonly canUndo: boolean; readonly canRedo: boolean }
export interface EditorResult<Document = JsonValue> { readonly document: Document; readonly revision: number; readonly changed: boolean; readonly dryRun: boolean }
export interface CommandRequest { type: string; payload?: JsonValue }
export interface TransactionEvent<Document = JsonValue> { readonly operation: string; readonly document: Document; readonly candidate: Document; readonly commands: readonly CommandRequest[]; readonly meta: Readonly<EditorMeta> }
export interface CommandDefinition<Document = JsonValue> { id: string; description?: string; inputSchema?: JsonValue; validate?(payload: JsonValue): boolean | void; apply(document: Document, payload: JsonValue, context: { meta: Readonly<EditorMeta> }): Document }
export interface EditorPlugin<Document = JsonValue> { id: string; version: string; requires?: string[]; commands?: CommandDefinition<Document>[]; setup?(editor: Editor<Document>): void | (() => void) }
export interface EditorOptions<Document = JsonValue> { document: Document; plugins?: EditorPlugin<Document>[]; validateDocument?(document: Document): boolean | void; authorize?(event: TransactionEvent<Document>): boolean; onError?(error: unknown): void; historyLimit?: number }
export interface Editor<Document = JsonValue> {
  getSnapshot(): EditorSnapshot<Document>;
  subscribe(listener: () => void): () => void;
  on(name: 'beforeTransaction', listener: (event: TransactionEvent<Document>) => boolean | void): () => void;
  on(name: 'change', listener: (snapshot: EditorSnapshot<Document>) => void): () => void;
  on(name: 'transaction', listener: (event: TransactionEvent<Document> & { result: EditorResult<Document> }) => void): () => void;
  on(name: 'plugin', listener: (event: { action: 'register' | 'unregister'; id: string }) => void): () => void;
  on(name: 'error', listener: (error: unknown) => void): () => void;
  dispatch(type: string, payload?: JsonValue, meta?: EditorMeta): EditorResult<Document>;
  transact(commands: CommandRequest[], meta?: EditorMeta): EditorResult<Document>;
  update(updater: (document: Document) => Document, meta?: EditorMeta): EditorResult<Document>;
  undo(meta?: EditorMeta): EditorResult<Document>;
  redo(meta?: EditorMeta): EditorResult<Document>;
  registerPlugin(plugin: EditorPlugin<Document>): void;
  unregisterPlugin(id: string): void;
  getCommands(): readonly Readonly<Pick<CommandDefinition<Document>, 'id' | 'description' | 'inputSchema'>>[];
  dispose(): void;
}
export class EditorError extends Error { readonly code: string; constructor(code: string, message?: string) }
/** Infer document state from the supplied document, not broad validation callback parameters. Requires TypeScript 5.4+. */
export function createEditor<Document = JsonValue>(options: { document: Document } & Omit<EditorOptions<NoInfer<Document>>, 'document'>): Editor<Document>;
export function cloneJson<T>(value: T): T;
