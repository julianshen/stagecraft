import { cloneJson } from '@stagecraft/core/editor';
/** Transport-neutral, trusted-host boundary. Never send the editor itself to a client. */
export class SessionError extends Error {
  constructor(code, revision, committed = false, outcome = committed ? 'committed' : 'not-committed') {
    super(code);
    this.name = 'SessionError';
    this.code = code;
    if (revision !== undefined) this.revision = revision;
    this.committed = committed;
    this.outcome = outcome;
  }
}

/**
 * One strict, descriptor-based validator/clone for every protected byte crossing the boundary:
 * accessors and toJSON are never invoked, non-finite numbers, functions, bigints and symbols are
 * rejected instead of silently coerced, depth and node counts are bounded, then a byte cap applies.
 * Output failures throw `code`; the input protocol path passes 'INVALID_REQUEST', protected outputs
 * pass 'INVALID_RESPONSE'. Byte overflow always stays RESPONSE_LIMIT.
 */
function strictJson(value, maxBytes, code, maxDepth = 64) {
  if (value === undefined) throw new SessionError('RESPONSE_LIMIT');
  const pending = [[value, 0]];
  let nodes = 0;
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (++nodes > 100000 || depth > maxDepth) throw new SessionError(code);
    if (item && typeof item === 'object') {
      for (const key of Reflect.ownKeys(item)) {
        if (Array.isArray(item) && key === 'length') continue;
        if (typeof key !== 'string') throw new SessionError(code);
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !('value' in descriptor)) throw new SessionError(code);
        pending.push([descriptor.value, depth + 1]);
      }
    } else if (typeof item === 'function' || typeof item === 'bigint' || typeof item === 'symbol') throw new SessionError(code);
    else if (typeof item === 'number' && !Number.isFinite(item)) throw new SessionError(code);
  }
  // cloneJson rejects cycles, prototype pollution and async thenables before serialization.
  const text = JSON.stringify(cloneJson(value));
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > maxBytes) throw new SessionError('RESPONSE_LIMIT');
  return JSON.parse(text);
}

// The handler wraps every session result in the protocol envelope `{"version":1,"ok":true,
// "result":…}` — one nesting level deeper and 32 bytes wider. Reserving that overhead inside
// the session's output budget keeps equal session/remote limits interoperable, so a committed
// result can never degrade into a client-side unknown receipt at the exact boundary.
const RESULT_DEPTH_LIMIT = 63;
const RESULT_ENVELOPE_BYTES = JSON.stringify({ version: 1, ok: true, result: 0 }).length - 1;

function json(value, maxBytes) {
  return strictJson(value, maxBytes - RESULT_ENVELOPE_BYTES, 'INVALID_RESPONSE', RESULT_DEPTH_LIMIT);
}

const publicCodes = new Set(['STALE_REVISION', 'UNKNOWN_COMMAND', 'INVALID_PAYLOAD', 'CANCELLED', 'UNAUTHORIZED', 'DISPOSED',
  'RESPONSE_LIMIT', 'SESSION_CLOSED', 'UNSUPPORTED', 'REVISION_REQUIRED', 'INVALID_REQUEST', 'INVALID_RESPONSE']);

export function createProtectedSession({ editor, identity, authorize, project, context, exportDocument, maxResponseBytes = 1048576 }) {
  if (!editor || typeof authorize !== 'function' || typeof project !== 'function' || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new TypeError('editor, authorize, project and a positive response limit are required');
  }
  // Identity is supplied by the authenticated host, copied once, never by request metadata.
  const actor = json(cloneJson(identity), maxResponseBytes);
  let closed = false;
  const check = () => { if (closed) throw new SessionError('SESSION_CLOSED'); };
  async function permit(operation, snapshot, request) {
    check();
    if (await authorize({ identity: json(actor, maxResponseBytes), operation, snapshot, request }) !== true) throw new SessionError('UNAUTHORIZED');
    check();
  }
  async function projection(snapshot, operation) {
    const value = await project({ identity: json(actor, maxResponseBytes), operation, snapshot });
    check();
    return json(value, maxResponseBytes);
  }
  function sanitize(error, revision, committed = false) {
    let code = 'OPERATION_FAILED';
    try { const candidate = error?.code; if (publicCodes.has(candidate)) code = candidate; } catch { /* Even error objects are untrusted. */ }
    return new SessionError(code, revision, committed);
  }
  async function readOperation(operation, request = {}) {
    try {
      check();
      const snapshot = editor.getSnapshot();
      const input = json(cloneJson(request), maxResponseBytes);
      await permit(operation, snapshot, input);
      // Returning from permit crossed an await boundary; re-check before any callback runs.
      check();
      const document = await projection(snapshot, operation);
      let result;
      if (operation === 'context') {
        // A provider sees ONLY the projected document, never the canonical snapshot.
        check();
        result = context ? await context({ document, revision: snapshot.revision, request: input }) : { revision: snapshot.revision };
      } else if (operation === 'export') {
        if (!exportDocument) throw new SessionError('UNSUPPORTED');
        check();
        result = await exportDocument({ document, revision: snapshot.revision, request: input });
      } else result = { document, revision: snapshot.revision };
      check();
      // Export callbacks return transport-safe JSON (e.g. an authorized artifact ID), not package handles.
      return json(result, maxResponseBytes);
    } catch (error) { throw sanitize(error); }
  }
  async function mutate(operation, request) {
    let committed = false;
    let revision;
    try {
      check();
      const input = json(cloneJson(request), maxResponseBytes);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new SessionError('REVISION_REQUIRED');
      const snapshot = editor.getSnapshot();
      if (snapshot.revision !== input.expectedRevision) throw new SessionError('STALE_REVISION');
      if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') throw new SessionError('INVALID_REQUEST');
      await permit(operation, snapshot, input);
      // Returning from permit crossed an await boundary; re-check closure before the kernel can
      // commit, so a close landing in that window never reaches the editor.
      check();
      // The kernel checks this revision synchronously; authorization cannot race a second writer.
      const meta = { expectedRevision: snapshot.revision, dryRun: input.dryRun === true, origin: 'remote' };
      const result = operation === 'transact' ? editor.transact(input.commands, meta)
        : editor[operation](meta);
      revision = result.revision;
      committed = result.changed && !result.dryRun;
      // Capture the exact result before awaiting projection. Never reread a newer editor state.
      check();
      const document = await projection({ document: result.document, revision }, operation);
      // Returning from projection crossed an await boundary: a close during post-commit
      // projection must yield the committed SESSION_CLOSED receipt, never a success.
      check();
      return json({ document, revision, changed: result.changed, dryRun: result.dryRun }, maxResponseBytes);
    } catch (error) {
      // A projection failure after commit is an explicit receipt, not a misleading rollback.
      throw sanitize(error, revision, committed);
    }
  }
  return Object.freeze({
    read: () => readOperation('read'),
    context: request => readOperation('context', request),
    export: request => readOperation('export', request),
    async dispatch(request) {
      let input;
      try {
        input = cloneJson(request);
        if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.type !== 'string') throw new SessionError('INVALID_REQUEST');
      } catch (error) { throw sanitize(error); }
      const { type, payload = null, expectedRevision, dryRun } = input;
      return mutate('transact', { commands: [{ type, payload }], ...(expectedRevision === undefined ? {} : { expectedRevision }), ...(dryRun === undefined ? {} : { dryRun }) });
    },
    transact: request => mutate('transact', request),
    undo: request => mutate('undo', request),
    redo: request => mutate('redo', request),
    async listCommands() {
      try {
        check();
        const snapshot = editor.getSnapshot();
        await permit('tools', snapshot, {});
        check();
        const commands = [];
        for (const command of editor.getCommands()) {
          // Re-check after every policy await regardless of the allow/deny outcome, so a close
          // cannot start the next callback, and a hanging later policy can never stall an
          // already-closed session.
          const permitted = await authorize({ identity: json(actor, maxResponseBytes), operation: 'tool', snapshot, request: { type: command.id } });
          check();
          if (permitted !== true) continue;
          // Explicit descriptors: undefined description/inputSchema keys would fail the strict
          // output validation (undefined values are never silently coerced or dropped).
          commands.push({ id: command.id, ...(command.description === undefined ? {} : { description: command.description }), ...(command.inputSchema === undefined ? {} : { inputSchema: command.inputSchema }) });
        }
        check();
        return json(commands, maxResponseBytes);
      } catch (error) { throw sanitize(error); }
    },
    close() { closed = true; },
  });
}


const operations = new Set(['read', 'context', 'export', 'dispatch', 'transact', 'undo', 'redo', 'listCommands']);
const mutationOperations = new Set(['dispatch', 'transact', 'undo', 'redo']);
const protocolCodes = new Set([...publicCodes, 'OPERATION_FAILED']);
const invalid = () => { throw new SessionError('INVALID_REQUEST'); };
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid();
}
function boundedJson(value, limit) {
  // Input protocol data crosses the same strict traversal; every failure maps to the request code.
  try { return strictJson(value, limit, 'INVALID_REQUEST'); }
  catch { invalid(); }
}
function validateRequest(value, limit) {
  const message = boundedJson(value, limit);
  keys(message, ['version', 'operation', 'input']);
  if (message.version !== 1 || !operations.has(message.operation) || !Object.hasOwn(message, 'input')) invalid();
  const { operation, input } = message;
  if (operation === 'read' || operation === 'listCommands') keys(input, []);
  if (mutationOperations.has(operation)) {
    keys(input, ['expectedRevision', 'dryRun', ...(operation === 'dispatch' ? ['type', 'payload'] : operation === 'transact' ? ['commands'] : [])]);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new SessionError('REVISION_REQUIRED');
    if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') invalid();
    if (operation === 'dispatch' && (typeof input.type !== 'string' || !input.type)) invalid();
    if (operation === 'transact') {
      if (!Array.isArray(input.commands)) invalid();
      for (const command of input.commands) {
        keys(command, ['type', 'payload']);
        if (typeof command.type !== 'string' || !command.type) invalid();
      }
    }
  }
  return message;
}
function limitOption(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('A positive JSON byte limit is required');
  return limit;
}
function errorReceipt(error) {
  let code = 'OPERATION_FAILED', committed = false, revision, outcome = 'not-committed';
  try {
    if (error instanceof SessionError) {
      if (protocolCodes.has(error.code)) code = error.code;
      committed = error.committed === true;
      outcome = committed ? 'committed' : error.outcome === 'unknown' ? 'unknown' : 'not-committed';
      if (Number.isSafeInteger(error.revision) && error.revision >= 0) revision = error.revision;
    }
  } catch { /* Never expose host errors or their messages. */ }
  return { code, committed, outcome, ...(revision === undefined ? {} : { revision }) };
}

/** Bind this handler to a host-authenticated session. It does not create a network listener. */
export function createSessionRequestHandler(session, { maxRequestBytes = 1048576 } = {}) {
  limitOption(maxRequestBytes);
  if (!session || [...operations].some(operation => typeof session[operation] !== 'function')) throw new TypeError('A session is required');
  return async request => {
    try {
      const { operation, input } = validateRequest(request, maxRequestBytes);
      const result = await session[operation](input);
      return { version: 1, ok: true, result };
    } catch (error) {
      return { version: 1, ok: false, error: errorReceipt(error) };
    }
  };
}

/** A JSON-only client. The host supplies authentication, routing and network transport. */
export function createRemoteSession({ request, maxRequestBytes = 1048576, maxResponseBytes = 1048576 } = {}) {
  if (typeof request !== 'function') throw new TypeError('A request transport is required');
  limitOption(maxRequestBytes); limitOption(maxResponseBytes);
  let closed = false;
  const pending = new Set();
  async function call(operation, input = {}) {
    if (closed) throw new SessionError('SESSION_CLOSED');
    let message;
    try { message = validateRequest({ version: 1, operation, input }, maxRequestBytes); }
    catch (error) { const receipt = errorReceipt(error); throw new SessionError(receipt.code); }
    return new Promise((resolve, reject) => {
      let sent = false;
      const failure = code => new SessionError(code, undefined, false, sent && mutationOperations.has(operation) ? 'unknown' : 'not-committed');
      const cancel = () => reject(failure('SESSION_CLOSED'));
      pending.add(cancel);
      Promise.resolve().then(() => {
        if (closed) throw new SessionError('SESSION_CLOSED');
        sent = true;
        return request(message);
      }).then(raw => {
        if (closed) throw failure('SESSION_CLOSED');
        let response;
        try {
          response = boundedJson(raw, maxResponseBytes);
          if (response.ok === true) keys(response, ['version', 'ok', 'result']);
          else if (response.ok === false) keys(response, ['version', 'ok', 'error']);
          else invalid();
          if (response.version !== 1) invalid();
          if (response.ok) {
            if (!Object.hasOwn(response, 'result')) invalid();
            if (operation === 'read') {
              keys(response.result, ['document', 'revision']);
              if (!Object.hasOwn(response.result, 'document') || !Number.isSafeInteger(response.result.revision) || response.result.revision < 0) invalid();
            } else if (operation === 'listCommands') {
              if (!Array.isArray(response.result)) invalid();
              for (const command of response.result) {
                keys(command, ['id', 'description', 'inputSchema']);
                if (typeof command.id !== 'string' || !command.id) invalid();
                if (command.description !== undefined && typeof command.description !== 'string') invalid();
              }
            } else if (mutationOperations.has(operation)) {
              keys(response.result, ['document', 'revision', 'changed', 'dryRun']);
              if (!Object.hasOwn(response.result, 'document') || !Number.isSafeInteger(response.result.revision) ||
                  response.result.revision < 0 || typeof response.result.changed !== 'boolean' || typeof response.result.dryRun !== 'boolean') invalid();
            }
          } else {
            keys(response.error, ['code', 'committed', 'revision', 'outcome']);
            if (!protocolCodes.has(response.error.code) || typeof response.error.committed !== 'boolean' ||
                (response.error.committed && response.error.revision === undefined) ||
                (response.error.outcome !== undefined && !['unknown', 'committed', 'not-committed'].includes(response.error.outcome)) ||
                (response.error.outcome !== undefined && (response.error.committed !== (response.error.outcome === 'committed'))) ||
                (response.error.revision !== undefined && (!Number.isSafeInteger(response.error.revision) || response.error.revision < 0))) invalid();
          }
        } catch { throw failure('INVALID_RESPONSE'); }
        if (!response.ok) throw new SessionError(response.error.code, response.error.revision, response.error.committed, response.error.outcome);
        resolve(response.result);
      }, () => { throw failure(closed ? 'SESSION_CLOSED' : 'TRANSPORT_FAILED'); })
        .catch(error => reject(error instanceof SessionError ? error : failure('TRANSPORT_FAILED')))
        .finally(() => pending.delete(cancel));
    });
  }
  return Object.freeze({
    read: () => call('read'), context: input => call('context', input), export: input => call('export', input),
    dispatch: input => call('dispatch', input), transact: input => call('transact', input),
    undo: input => call('undo', input), redo: input => call('redo', input), listCommands: () => call('listCommands'),
    // Closing a client is local. A host decides when to close its authenticated session.
    close() { closed = true; for (const cancel of pending) cancel(); pending.clear(); },
  });
}
