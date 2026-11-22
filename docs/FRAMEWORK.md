# Framework foundation

Stagecraft is an embeddable editor framework in private npm workspaces. This foundation keeps the existing deck schema while introducing revisioned transactions, plugin commands, React bindings and host-controlled I/O. The additive canonical model and targeted source-preserving text edits are described in [Canonical documents](CANONICAL-DOCUMENTS.md).

## Embed a plugin-enabled editor

```jsx
import { createEditor } from '@stagecraft/core/editor';
import { SAMPLE_DECK } from '@stagecraft/core';
import { EditorProvider, EditorSurface } from '@stagecraft/react/editor';
import '@stagecraft/react/styles.css';

const editor = createEditor({
  document: SAMPLE_DECK,
  plugins: [{
    id: 'title', version: '1',
    commands: [{
      id: 'deck.setTitle',
      description: 'Set the presentation title',
      inputSchema: { type: 'string', maxLength: 200 },
      validate: value => typeof value === 'string' && value.length <= 200,
      apply: (draft, title) => ({ ...draft, title }),
    }],
  }],
});

export function DeckEditor() {
  return <EditorProvider editor={editor}>
    <EditorSurface style={{ height: 720 }} />
  </EditorProvider>;
}

const unsubscribe = editor.on('transaction', event => console.log(event.result.revision));
editor.dispatch('deck.setTitle', 'Quarterly review', { expectedRevision: 0 });
// After unmount, the owner calls unsubscribe() and editor.dispose().
```

Create each editor once in the owning component/service lifecycle. Avoid a module singleton for per-user SSR state. Providers do not dispose externally owned editors. The standalone consumer in `tests/consumer` demonstrates this integration without the playground backend.

Commands return the next document. The React surface removes undefined object properties produced by legacy UI deletion actions; arrays and all other invalid JSON values remain rejected. The engine clones inputs/drafts and freezes public snapshots. A batch is `editor.transact([{type, payload}, ...], meta)`: it commits once or leaves state/history unchanged. Payload validation is executable; JSON schemas describe tools but are not automatically interpreted as validators. Commands must perform no external side effects and must be synchronous. `expectedRevision` detects stale writes; `dryRun: true` produces an immutable candidate without events or history. Dry runs skip event hooks, including commit-time cancellation; success does not guarantee a later commit will be allowed. Undo/redo advance the revision and pass current authorization/validation/cancellation gates.

`subscribe` observes state; `on('beforeTransaction', callback)` can return false to cancel a commit. `change`, `transaction`, `plugin` and `error` listeners are notifications. Reentrant mutation is rejected; schedule follow-up work separately. Listener failures go to `onError` without changing a committed result. Plugin dependencies must already exist; duplicate commands and removal of required plugins are rejected. Setup may register subscriptions and return cleanup; plugins must release their external resources in cleanup. Trusted in-process plugins have ordinary JavaScript privileges.

## Local and server file I/O

```js
import { importDocument, exportDocument } from '@stagecraft/io';
import { pptxAdapter } from '@stagecraft/pptx';

const loaded = await importDocument(file, { adapter: pptxAdapter });
// Examine loaded.diagnostics before accepting conversion losses.
const result = await exportDocument(loaded.document, { adapter: pptxAdapter });
// result.bytes is a Uint8Array; the host chooses download, storage or upload.
```

An opaque source identifier requires `load(source, {signal, maxBytes})`. A `save(bytes, metadata)` callback receives the export. No network or filesystem access occurs implicitly. Authenticated HTTP, storage credentials and URL allowlists belong to those host callbacks. Signals are checked at async boundaries; they cannot preempt synchronous parsing. Expanded ZIP limits supplement compressed source limits. Parsing hostile packages still needs a host process/worker with memory and time limits.

PPTX byte output uses `writePptx`. The native `odpAdapter` is available from `@stagecraft/odp`; its [subset contract](../packages/odp/README.md) lists supported objects and explicit export rejections. The existing `exportToPPTX` remains the browser download convenience function. XML parsing/serialization in a non-browser runtime requires an injected XML runtime; image orientation preparation is a separate host capability. See the adapter declarations and tests for the exact options. Existing PowerPoint conversion limitations remain.

## Whole-source sessions

Canonical documents opened through `@stagecraft/source` retain the original package: a session's canonical view is partial, unsupported content stays opaque, and exports keep untouched parts byte-identical. Source sessions are whole-package capabilities and must never be handed to clients the host does not trust with the original file. Retained packages may contain hidden, deleted or unreferenced data; deletion in the canonical view is not sanitization. Signed documents permit an unchanged export only. See [Canonical documents](CANONICAL-DOCUMENTS.md) for the exact retention guarantees and the mapped-command subset.

## Protected sessions

```js
import { createProtectedSession } from '@stagecraft/server';

const session = createProtectedSession({
  editor, // Remains on the server in protected mode.
  identity: authenticatedIdentity,
  authorize: ({ identity, operation, snapshot, request }) =>
    hostPolicy(identity, operation, snapshot, request),
  project: ({ identity, operation, snapshot }) =>
    hostProjection(identity, operation, snapshot.document),
  context: ({ document, revision }) => ({ title: document.title, revision }),
});
```

The host supplies authenticated identity and mandatory policy/projection functions. Client requests cannot override identity. Policy operation names are `read`, `transact`, `undo`, `redo`, `context`, `export`, `tools`, and `tool` (individual command discovery). For `transact`, inspect every command in `request.commands`; discovery permission alone never authorizes execution. Authorization runs before the revision check, so a denied identity cannot probe the current revision through stale mutations. For `undo` and `redo`, the policy additionally receives `request.candidate` — the `{document, revision}` snapshot the operation would restore, computed by a kernel dry run — because undo permission otherwise grants unrestricted write over shared history; undo/redo permission must be granted with that in mind. Async authorization receives the captured canonical snapshot, and the engine checks its revision again synchronously. Remote undo/redo also require an expected revision. A local host can use the same session interface, but browser-local policies cannot defend against the browser owner.

All remote documents, including dry-run candidates, pass through projection. Context/export callbacks receive only that projection. The default context is revision metadata; text needs an explicit callback. `session.export()` returns bounded JSON artifact metadata from the host callback, not raw canonical bytes. The host can export the authorized document with a format adapter and securely deliver its bytes separately. Do not attach retained original parts to a redacted export.

Every protected output — projections, context, export metadata and command discovery — crosses one strict, descriptor-based validator before it leaves the session: accessors and `toJSON` are never invoked, non-finite numbers, functions, bigints, symbols and `undefined` values are rejected instead of silently coerced, non-enumerable keys and non-plain objects (Date/Map/class instances) are rejected, and depth, node count and encoded bytes are bounded. The session reserves the protocol envelope's overhead — one nesting level, three counted nodes and 32 bytes — inside its output budget, so equal session/remote limits interoperate exactly at the boundary; a validation failure after a committed edit is an authoritative committed receipt (`committed: true` with its revision), never a malformed success. The node budget is a session option (`maxResponseNodes`, default 100000, paired with the remote's) — without it, an oversized document would commit and then be unreadable; smaller budgets trade expressiveness for bounded delivery, and raising the cap is the host remedy for an oversized document: configurability bounds delivery but does not prevent a still-oversized commit. Response byte limits below 192 bytes and node budgets below 16 (the eight-node error envelope, with margin) are rejected at construction: the largest error receipt envelope (~127 bytes: committed receipt, longest public code, maximum revision digits) must always fit, so a session can deliver its own post-commit failure. Request protocol data crosses the same validator with request-code semantics against a separate request budget (`maxRequestBytes`), before any rewrap.

Errors expose stable codes, never host exception details. If projection fails **after** an edit committed, the error has `committed: true` and its `revision`; resynchronize instead of blindly retrying. An async projection uses the snapshot for that operation even if another edit commits meanwhile. `session.close()` rejects pending operations at their next async boundary and future operations — closure is re-checked after every await, before each policy callback, before command discovery scans, and before the kernel mutation, so a close landing between an authorization await and the editor call can never commit; it does not dispose the underlying editor. Durable revocation, audit, isolated parsing, final-raster transport and a remote React surface are not supplied by this foundation. An agent-facing tool layer over these sessions (bounded projected context, command discovery, atomic tool batches) is planned future work; MCP/function-calling transports would adapt the session interface, and no provider SDK or credentials are bundled.

## Compatibility evidence

The additive canonical layer is documented in [Canonical documents and retained sources](CANONICAL-DOCUMENTS.md): a validated EMU model, explicit inheritance/source references and whole-source sessions for existing-text edits.

| Area | Foundation behavior | Further work |
| --- | --- | --- |
| Editing | Existing Stagecraft deck UI, transactions and history; bounded canonical EMU model for native sources | Broader canonical Office coverage, document migrations and format extension hooks |
| Plugins | Lifecycle, dependencies, commands and events; bounded object renderers/inspectors on the React workspace | Richer plugin contributions and editor-wide schema/format hooks |
| PPTX | Existing conversion plus bytes/host I/O; retained-source sessions keep untouched parts byte-identical | Native object fidelity beyond the mapped command subset |
| ODP | Explicit initial subset adapter | Impress themes, masters, rich content and fidelity fixtures |
| Protected mode | Policy/projection/session contracts with leak/race tests | Authentication/routing, production delivery, remote editing UI, revocation and audit |
| AI | Planned bounded projected context over protected sessions | MCP transport and feature-specific context providers |

Unit round trips establish implementation consistency, not native Office fidelity. Subsequent acceptance requires exported fixtures opened in PowerPoint/LibreOffice, visual comparison and untouched-package-part checks. Full PowerPoint compatibility is the target, not a claim about this milestone.

## Reusable native presentation editor

Use `PresentationEditor` under `EditorProvider` with both `documentPlugin` and `presentationPlugin`. Pass the matching retained `source` and an `onExport` callback to enable native export. `showToolbar`, `showSlideList`, and `showAttributePanel` default to true; `showDeckList` defaults to false and takes host-controlled `decks`, `activeDeckId`, and `onDeckSelect`.

For custom layouts, mount `PresentationEditorProvider` and any combination of `PresentationToolbar`, `SlideList`, `PresentationCanvas`, and `AttributePanel`. `DeckList` also works outside providers. See [Component specification](COMPONENT-SPEC.md) for the full API and supported editing scope. Source sessions are whole-package capabilities and must not enter protected clients.

## Authorized transport

`createSessionRequestHandler(session)` binds a versioned JSON protocol to a host-authenticated protected session. `createRemoteSession({ request })` is the corresponding client; the host supplies its own authenticated HTTP/WebSocket/IPC transport. The library does not create listeners or accept client-supplied identity. Closing the client rejects pending calls and ignores late responses without closing a shared server session.

```js
import { createProtectedSession, createSessionRequestHandler, createRemoteSession } from '@stagecraft/server';

// Server only: projectAuthorizedDocument must enforce the host's access policy.
const session = createProtectedSession({
  editor, identity: authenticatedIdentity, authorize, project: projectAuthorizedDocument,
});
const handle = createSessionRequestHandler(session);
// Bind handle to the host's authenticated transport. Do not send editor or source to the client.

// Client: authenticatedRequest returns the JSON protocol response.
const remote = createRemoteSession({ request: authenticatedRequest });
const snapshot = await remote.read();
await remote.dispatch({ type: 'presentation.addSlide', payload: { slideId: 'generated-slide' }, expectedRevision: snapshot.revision });
```

Requests and responses are bounded and depth-limited without invoking accessors; non-JSON values, unknown operations, extra keys and malformed envelopes are rejected before execution. Mutations are revisioned: a missing or stale `expectedRevision` is refused, and a batch commits once or leaves state and history unchanged. Errors are sanitized to stable public codes. Success results are shape-validated too: `read` must be a document/revision snapshot with a non-negative revision, and command discovery must be a list of command descriptors; context and export remain arbitrary bounded JSON by contract. A lost, malformed or oversized response after a mutation was sent — or a client close after send — yields `outcome: 'unknown'`: resynchronize before deciding whether to retry; `committed: false` alone does not establish rollback. Authoritative receipts distinguish committed, not-committed and unknown outcomes. Reconnect, idempotency and reconciliation, durable revocation and audit, and isolated parsing of hostile input remain host/product work; this package is a transport contract, not a deployed secure server.
