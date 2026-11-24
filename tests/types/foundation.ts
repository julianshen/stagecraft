// Compile-only consumer: package exports must resolve without source aliases or React.
import {
  createDocument, createEditor, validateDocument, documentPlugin, presentationPlugin,
  SAMPLE_DECK, ACCENTS, flattenDeck, normalizeDeck, slideDims, resolveNotes,
  type CanonicalDocument, type Editor, type EditorPlugin,
} from '@stagecraft/core';
import {
  createDocument as createDocumentSubpath, migrateLegacyDeck, toLegacyDeck,
  type DocumentCommandPayloads, type PresentationCommandPayloads,
} from '@stagecraft/core/document';
import {
  createEditor as createEditorSubpath, cloneJson, type EditorResult, type EditorSnapshot,
  type TransactionEvent, type JsonValue,
} from '@stagecraft/core/editor';
import {
  importDocument, exportDocument, readBytes, safeXmlParse, createSafeXmlRuntime,
  type FormatAdapter, type ByteSource, type Diagnostic, type ExportMetadata, type XmlRuntime as IoXmlRuntime,
} from '@stagecraft/io';
import { inspectZip, type ZipOptions } from '@stagecraft/io/zip';
import { pptxAdapter, importPptx, writePptx, type Deck, type PptxOptions } from '@stagecraft/pptx';
import { odpAdapter, importOdp, writeOdp, type OdpDocument, type OdpOptions } from '@stagecraft/odp';
import { openPresentation, type SourceSession, type SourceCapability, type XmlRuntime } from '@stagecraft/source';

function expectType<T>(_value: T): void {}
function assertJsonPayloads<T extends Record<keyof T, JsonValue>>(): void {}
assertJsonPayloads<DocumentCommandPayloads>();
assertJsonPayloads<PresentationCommandPayloads>();
type IsAny<T> = 0 extends (1 & T) ? true : false;

const document = createDocument({ id: 'document', size: { width: 9144000, height: 5143500 } });
expectType<CanonicalDocument>(createDocumentSubpath());
expectType<true>(validateDocument(document));
expectType<CanonicalDocument>(cloneJson(document));
expectType<{ w: number; h: number }>(slideDims(normalizeDeck(SAMPLE_DECK)));
expectType<string>(resolveNotes(flattenDeck(SAMPLE_DECK)[0]));
expectType<number>(ACCENTS.indigo.hue);
const migrated = migrateLegacyDeck({ slides: [], sections: [] });
expectType<CanonicalDocument>(migrated.document);
expectType<string>(migrated.diagnostics[0].code);
expectType<CanonicalDocument>(migrateLegacyDeck(toLegacyDeck(document).deck).document);

const plugin: EditorPlugin<CanonicalDocument> = {
  id: 'example.metadata', version: '1.0.0',
  commands: [{
    id: 'example.rename', description: 'Set the title', inputSchema: { type: 'string' },
    validate(payload) { return typeof payload === 'string'; },
    apply(current, payload, context) {
      expectType<JsonValue>(payload);
      expectType<number | undefined>(context.meta.expectedRevision);
      return { ...current, metadata: { ...current.metadata, title: payload } };
    },
  }],
  setup(editor) {
    const unsubscribe = editor.subscribe(() => expectType<CanonicalDocument>(editor.getSnapshot().document));
    return unsubscribe;
  },
};
const editor = createEditor({ document, plugins: [documentPlugin, presentationPlugin, plugin], validateDocument });
expectType<Editor<CanonicalDocument>>(editor);
expectType<Editor<CanonicalDocument>>(createEditorSubpath({ document, validateDocument }));
const inferredDocumentIsAny: IsAny<ReturnType<typeof editor.getSnapshot>['document']> = false;
expectType<false>(inferredDocumentIsAny);
const unsubscribe = editor.on('beforeTransaction', event => {
  expectType<TransactionEvent<CanonicalDocument>>(event);
  expectType<CanonicalDocument>(event.candidate);
  return event.meta.expectedRevision === undefined;
});
editor.on('change', snapshot => expectType<EditorSnapshot<CanonicalDocument>>(snapshot));
editor.on('transaction', event => expectType<EditorResult<CanonicalDocument>>(event.result));
editor.on('plugin', event => expectType<'register' | 'unregister'>(event.action));
editor.on('error', error => expectType<unknown>(error));
const setText: DocumentCommandPayloads['document.setRunText'] = { runId: 'run', text: 'Edited' };
const addSlide: PresentationCommandPayloads['presentation.addSlide'] = { slideId: 'slide' };
expectType<EditorResult<CanonicalDocument>>(editor.dispatch('document.setRunText', setText, { expectedRevision: 0, dryRun: true }));
editor.transact([{ type: 'presentation.addSlide', payload: addSlide }]);
const runFormat: DocumentCommandPayloads['document.setRunFormat'] = { runId: 'run', format: { fontFamily: 'Arial', color: '#abcdef' } };
editor.dispatch('document.setRunFormat', runFormat);
const geometry: PresentationCommandPayloads['presentation.setGeometry'] = {
  slideId: 'slide', objectId: 'shape', geometry: { x: 0, y: 0, width: 9525, height: 9525 },
};
editor.dispatch('presentation.setGeometry', geometry);
const text: PresentationCommandPayloads['presentation.setText'] = {
  slideId: 'slide', objectId: 'text', text: { paragraphs: [{ id: 'p', runs: [{
    id: 'r', text: 'Typed text', editable: true, style: {}, extensions: { stagecraftAuthored: true },
  }] }] },
};
editor.dispatch('presentation.setText', text);
editor.update(current => ({ ...current, metadata: { title: 'Updated' } }));
editor.undo();
editor.redo();
editor.registerPlugin(plugin);
editor.unregisterPlugin(plugin.id);
expectType<string>(editor.getCommands()[0].id);
unsubscribe();
// @ts-expect-error Canonical state remains typed even with the unknown-accepting validator.
editor.update(() => 'not a document');
// @ts-expect-error Command payloads remain JSON data rather than arbitrary host objects.
editor.dispatch('example.invalid', { callback: () => {} });
// @ts-expect-error Unknown hook names must not silently acquire any-typed event parameters.
editor.on('missing', () => {});
// @ts-expect-error The canonical coordinate system is EMU.
createDocument({ units: 'px' });
// @ts-expect-error Built-in command payload fields retain their value types.
const invalidText: DocumentCommandPayloads['document.setRunText'] = { runId: 'run', text: 1 };
void invalidText;
editor.dispose();

const xml: XmlRuntime = {
  parse: text => new DOMParser().parseFromString(text, 'application/xml'),
  serialize: doc => new XMLSerializer().serializeToString(doc),
};
const ioXml: IoXmlRuntime = xml;
const safeXml = createSafeXmlRuntime(ioXml);
safeXml.parse('<root/>');
safeXml.serialize?.(safeXml.parse('<root/>'));
safeXmlParse('<root/>', ioXml);
const bytes = new Uint8Array();
const signal = new AbortController().signal;
const zipOptions: ZipOptions = { maxBytes: 1024, maxEntries: 10, maxEntryBytes: 1024, maxExpandedBytes: 4096, signal };
const pptxOptions: PptxOptions = { ...zipOptions, xml, includeNotes: true, range: { from: 1, to: 2 } };
const odpOptions: OdpOptions = { ...zipOptions, xml };
expectType<FormatAdapter<Deck, PptxOptions>>(pptxAdapter);
expectType<FormatAdapter<OdpDocument, OdpOptions>>(odpAdapter);

async function localAndHostIO() {
  expectType<Uint8Array>(await readBytes(new Blob([bytes]), { signal }));
  expectType<number>((await inspectZip(bytes, zipOptions)).entryCount);
  const pptx = await importDocument(bytes, { adapter: pptxAdapter, ...pptxOptions });
  expectType<Deck>(pptx.document);
  const pptxDocumentIsAny: IsAny<typeof pptx.document> = false;
  expectType<false>(pptxDocumentIsAny);
  expectType<Diagnostic[]>(pptx.diagnostics);
  const directPptx = await importPptx(bytes, pptxOptions);
  expectType<Deck>(directPptx.deck);
  expectType<Uint8Array>(await writePptx(directPptx.deck, pptxOptions));
  const odp = await importDocument(new Blob([bytes]), { adapter: odpAdapter, ...odpOptions });
  expectType<OdpDocument>(odp.document);
  expectType<OdpDocument>((await importOdp(bytes, odpOptions)).document);
  expectType<Uint8Array>(await writeOdp(odp.document, odpOptions));
  const loaded = await importDocument('host-document-id', {
    adapter: pptxAdapter, ...pptxOptions,
    async load(source, options) {
      expectType<unknown>(source);
      expectType<AbortSignal | undefined>(options.signal);
      return bytes;
    },
  });
  const saved = await exportDocument(loaded.document, {
    adapter: pptxAdapter, ...pptxOptions, fileName: 'edited.pptx',
    async save(output, metadata) {
      expectType<Uint8Array>(output);
      expectType<ExportMetadata>(metadata);
      expectType<AbortSignal | undefined>(metadata.signal);
    },
  });
  expectType<Uint8Array>(saved.bytes);
  expectType<string>(saved.metadata.fileName);
  expectType<Uint8Array>((await exportDocument(odp.document, { adapter: odpAdapter, ...odpOptions })).bytes);
  expectType<ByteSource>((await pptxAdapter.export(loaded.document, pptxOptions)).bytes);
  // @ts-expect-error Adapter exports require the adapter's document shape.
  await exportDocument('invalid document', { adapter: pptxAdapter });
}

async function retainedSource() {
  const session = await openPresentation(bytes, { format: 'pptx', xml, ...zipOptions });
  expectType<SourceSession>(session);
  expectType<CanonicalDocument>(session.document);
  const sourceDocumentIsAny: IsAny<typeof session.document> = false;
  expectType<false>(sourceDocumentIsAny);
  expectType<readonly SourceCapability[]>(session.capabilities.edits);
  expectType<true>(session.capabilities.exactNoOp);
  expectType<false>(session.capabilities.nativeVisualCertification);
  expectType<string>(session.diagnostics[0].code);
  const image = session.registerImage({ bytes, contentType: 'image/png' });
  expectType<string>(image.assetId);
  const preview = session.getImage(image.assetId);
  if (preview) expectType<Uint8Array>(preview.bytes);
  expectType<readonly string[]>(session.images);
  await session.export(session.document, { resize: new Map([['box', { height: 1905000 }]]) });
  await session.export(session.document, { resize: { box: { height: 1905000 } }, fit: { shrink: { fontScale: 85000, lnSpcReduction: 10000 } } });
  // @ts-expect-error Resize accepts a height-only hint, not arbitrary position changes.
  await session.export(session.document, { resize: { box: { height: 1905000, y: 0 } } });
  // @ts-expect-error Resize height is numeric EMU.
  await session.export(session.document, { resize: { box: { height: '1905000' } } });
  const result = await session.export(session.document, zipOptions);
  expectType<Uint8Array>(result.bytes);
  expectType<string[]>(result.dirtyParts);
  session.dispose();
  // @ts-expect-error Source-preserving sessions support only PPTX and ODP.
  await openPresentation(bytes, { format: 'pdf' });
  // @ts-expect-error Source sessions export canonical documents, not legacy decks.
  await session.export({ slides: [], sections: [] });
}
void localAndHostIO;
void retainedSource;

// Script-specific fonts extend existing formatting without changing the Latin alias.
const scriptFonts: import('@stagecraft/core/document').RunFormat = { fontFamily: 'Arial', eastAsian: '+mj-ea', complexScript: null };
const authoredScriptFonts: import('@stagecraft/core/document').AuthoredRunStyle = { typeface: 'Arial', eastAsian: 'Yu Gothic', complexScript: '+mn-cs' };
void scriptFonts; void authoredScriptFonts;

// Renderer measurement diagnostics are a discriminated outcome, not a Map.
import { measureShrinkFits, waitForShrinkFonts, scaledTextBody, type ShrinkMeasurement } from '@stagecraft/renderer/text/measureShrinkFits';
const shrinkMeasurement: ShrinkMeasurement = measureShrinkFits(createDocument(), { fonts: globalThis.document.fonts, baseline: createDocument() });
shrinkMeasurement.fit.get('object')?.fontScale.toFixed();
shrinkMeasurement.stats.skipped.toFixed();
shrinkMeasurement.reasons['unchanged-native']?.toFixed();
if (shrinkMeasurement.status === 'skipped') shrinkMeasurement.reason.toUpperCase();
if (shrinkMeasurement.status === 'failed') shrinkMeasurement.message.toUpperCase();
// @ts-expect-error The old bare Map result is no longer supported.
shrinkMeasurement.get('object');
void waitForShrinkFonts(createDocument(), { fonts: globalThis.document.fonts, baseline: createDocument() }).then(result => {
  if (result.status === 'skipped') result.reason.toUpperCase();
});

const scaledBody = scaledTextBody({paragraphs:[{runs:[{fontSizePt:18}],endProperties:{fontSizePt:18},lineSpacing:{kind:'percent',value:1}}]}, {fontScale:50000,lnSpcReduction:0});
expectType<'percent'>(scaledBody.paragraphs[0].lineSpacing.kind);
expectType<number>(scaledBody.paragraphs[0].runs[0].fontSizePt);

import { measureResizeFits, type ResizeMeasurement } from '@stagecraft/renderer/text/measureResizeFits';
import { waitForAutofitFonts } from '@stagecraft/renderer/text/waitForAutofitFonts';
const resized: ResizeMeasurement = measureResizeFits(createDocument(), { baseline: createDocument() });
resized.resize.get('box')?.height.toFixed();
resized.stats.skipped.toFixed();
waitForAutofitFonts(createDocument(), { kinds: ['resize', 'shrink'], timeoutMs: 2000, baseline: createDocument() });
// @ts-expect-error Unsupported measurement kind.
waitForAutofitFonts(createDocument(), { kinds: ['rotate'] });
