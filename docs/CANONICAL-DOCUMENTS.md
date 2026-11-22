# Canonical documents and native sources

This milestone adds headless document, transaction, plugin and file APIs. The existing `StagecraftEditor` remains a legacy-deck React wrapper. Canonical React surfaces, new authoring UI, protected sessions, remote transports and AI integration are outside this PR.

## Document model and editor

`@stagecraft/core/document` exports `createDocument`, `validateDocument`, `documentPlugin`, `presentationPlugin`, `migrateLegacyDeck` and `toLegacyDeck`. Version 1 uses EMU coordinates, globally unique IDs and explicit slide/layout/master/theme references. Objects contain paragraphs and runs; assets and relationships retain package references. Unknown JSON-safe extension data survives transactions. Source references identify format, part and DOM-node path; they contain no bytes and confer no access rights.

`@stagecraft/core/editor` exports `createEditor`. It clones inputs and drafts, freezes public snapshots, validates candidate documents, and supplies revisions, atomic transactions, undo/redo and plugin lifecycle. Type declarations require TypeScript 5.4 or newer.

```js
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { openPresentation } from '@stagecraft/source';

const source = await openPresentation(file, { format: 'pptx' });
const editor = createEditor({
  document: source.document,
  validateDocument,
  plugins: [documentPlugin, presentationPlugin],
});

// existingRunId comes from an eligible run in this document.
editor.dispatch('document.setRunText', {
  runId: existingRunId, text: 'Revised text',
}, { expectedRevision: editor.getSnapshot().revision });

const result = await source.export(editor.getSnapshot().document);
// The host chooses how to save result.bytes and presents result.diagnostics.
source.dispose();
editor.dispose();
```

Commands are synchronous and must have no external side effects. Executable validators enforce payloads; exposed JSON schemas describe commands but are not interpreted as validators. `transact([{ type, payload }, ...], meta)` commits once or leaves document/history unchanged. `expectedRevision` rejects stale writes. `dryRun: true` returns an immutable candidate without history or notifications; it skips commit-time hooks and does not guarantee a subsequent commit. Undo/redo advance revision and pass the current authorization, validation and cancellation gates.

`subscribe` observes state. A `beforeTransaction` listener can cancel a commit; notification failures are reported to the optional `onError` callback and `error` listeners without reversing a committed result; failures in those error handlers are swallowed to avoid recursive reporting. Reentrant mutation is rejected. Plugin dependencies must already be registered; duplicate commands and removal of required plugins are rejected. Setup can return cleanup, and the host disposes the editor when finished. Plugins are trusted in-process JavaScript, not sandboxed extensions. An editor authorization callback is not a remote security boundary.

## Native authoring contracts

The source foundation includes native authoring commands for later UI integration. These are bounded contracts, not arbitrary Office document editing. Consult each command's executable validator and the source session's capabilities before offering an operation.

| Contract | Supported scope and limits |
| --- | --- |
| Existing text | `document.setRunText` edits eligible mapped runs; fields and unsupported mixed content remain opaque. |
| Existing run format | `document.setRunFormat` changes bold, italic, font size, font family and RGB color on eligible native or authored runs. Sizes are points, 1–4000 with at most two decimal places. `null` removes a PPTX direct override or restores an ODP imported property. |
| Paragraph/body layout | `document.setParagraphFormat` and `document.setTextBodyLayout` expose validated subsets of paragraph alignment, spacing, indents, bullets and text-body layout. They do not resolve all native inheritance. |
| Range formatting | `document.setRunRangeFormat` splits authored runs over code-point ranges and supports bold, italic, font size, font family and RGB color. It is restricted to authored objects. |
| Slides and objects | `presentationPlugin` adds/removes/reorders slides and objects, changes supported geometry/fill and slide properties, and authors supported text, tables, images and charts. Existing object editability is gated; native chart data is read-only. ODP nonzero rotation edits are rejected. |

Font-family authoring is limited to the Latin/Western font contract. In PPTX it writes DrawingML `a:latin`; it does not implement East Asian or complex-script font selection, fallback, shaping or full theme-font resolution. ODP font-family and named-font handling is also incomplete. Unicode text support must not be interpreted as complete multilingual typography support.

ODP existing-run formatting uses run-local overrides and newly named automatic text styles rather than modifying shared styles. Clearing an override restores the imported baseline, which changes when exported bytes are reopened. Derived appearance metadata is read-only for export. Retained source/style fields and unrelated native properties are preserved where the supported writer does not change them.

For authored ODP paragraphs, removing a bullet at a nonzero list level requires resetting `level` to `null` or `0` in the same `document.setParagraphFormat` command. Retaining a nonzero level without a bullet is unsupported and rejects the transaction without changing the document.

Authored paragraphs support at most 200 runs, with at most 4,000 UTF-16 code units per run. Range-formatting splits and run-text edits that would exceed these export limits reject atomically. Imported native runs do not inherit the authored text-length limit.

`source.registerImage({ bytes, contentType })` accepts validated PNG/JPEG bytes and returns an asset ID for `presentation.addImage`. Limits are 5 MiB per image, 32 MiB and 64 registered images per session. Bytes stay outside canonical JSON. `getImage(assetId)` returns copied preview bytes or `null`; `images` lists available previews. Some retained images cannot be previewed within these bounds.

## Retained source sessions

`@stagecraft/source` opens native PPTX and ODP packages and retains their original bytes and mapping privately. A session's `document` is a canonical view, not a complete rendering of every native feature. Native themes, masters, group transforms and unsupported objects are not fully resolved; opaque content remains in the package.

ODP tables with repeated rows, columns or cells, or with row/column header and grouping containers, remain opaque native objects. The reader does not expand repetition or flatten these containers into a truncated table preview; their native XML is retained through unrelated edits.

Export independently validates and compares the candidate against its baseline. Unsupported changes, source-reference tampering and arbitrary partial/redacted documents are rejected. Dirty parts are derived from that comparison. Capability names indicate available categories, not permission to edit every object in that category. Supported visible deletions may leave unreferenced original parts and relationships, so deletion is not sanitization.

An unchanged export returns an independent copy of the exact input bytes. Undoing all document changes can therefore restore exact input bytes. Edited exports may reserialize affected XML and change ZIP metadata/compression; untouched entries retain their uncompressed bytes. Concurrent exports capture independent document snapshots and do not advance the baseline. Reopen exported bytes to establish a new baseline. IDs are deterministic for the same input, but rewriting text-node structure can change run IDs on reimport; persist canonical state with its matching source baseline.

Signed packages allow exact unchanged export only. Encryption, ambiguous/unsafe package paths and unsupported package forms are rejected. PPTX support targets transitional presentations, not strict OOXML, macro-enabled presentations or templates. ODP requires explicit styles, master/page-layout links and a single page size. External relationships remain inert metadata; opening a package does not fetch their targets.

A source session is access to the **entire original package**, including content absent from the canonical view. Do not give it to a client that should see only a redacted projection. This PR supplies no protected export/session API. A host needing redaction must construct an authorized output without copying hidden original parts.

## Conversion and host I/O

`migrateLegacyDeck` converts supported legacy elements and retains original payloads in extensions. `toLegacyDeck` is an explicit rendering projection to the legacy 1920-wide coordinate system, with diagnostics for unsupported or flattened content. It is not a lossless canonical editing binding. Do not write that projection back into a retained-source session.

`@stagecraft/io` supplies host-controlled byte import/export:

```js
import { importDocument, exportDocument } from '@stagecraft/io';
import { pptxAdapter } from '@stagecraft/pptx';

const loaded = await importDocument(file, { adapter: pptxAdapter });
const output = await exportDocument(loaded.document, { adapter: pptxAdapter });
// Inspect diagnostics; save output.bytes through the host.
```

`pptxAdapter` and `odpAdapter` convert to/from the legacy deck model. They do not retain original package parts. `writePptx` and `writeOdp` return bytes; existing `exportToPPTX` remains the browser download convenience function. The experimental [ODP subset](../packages/odp/README.md) supports a limited set of blank-slide text and shape content and rejects unsupported exports. It does not offer full Impress or PowerPoint fidelity.

Opaque input identifiers require a host `load(source, { signal, maxBytes })` callback; optional `save(bytes, metadata)` delivers output. No implicit file-system or network access is supplied by these I/O functions. The host owns credentials, authorization, URLs and storage.

Browser source sessions use `DOMParser` and `XMLSerializer`. Node/server hosts inject a namespace-aware `xml: { parse(text), serialize(document) }` runtime; individual conversion adapters have their own XML/runtime requirements. PPTX image orientation preparation is a separate host capability. No global DOM replacement is required.

Compressed-byte, entry-count, per-entry and expanded-byte limits bound accepted ZIPs. JSZip still allocates inflated entries before actual-size checks. For untrusted uploads, hosts need process/worker memory and time limits; these checks are not a strict hostile-input allocation cap. Abort signals and disposal are observed at asynchronous boundaries and cannot preempt synchronous parsing. Local browser use and server processing need different host isolation and resource policies.

## Validation limits

Tests check model validation, transaction behavior, supported conversion and native package edits, exact no-op bytes and untouched-entry preservation. Such checks establish implementation behavior, not full native visual compatibility. This PR does not claim full PowerPoint/Impress compatibility, complete canonical rendering or certified multilingual layout. Broader native-application validation and canonical editing UI remain separate work.
