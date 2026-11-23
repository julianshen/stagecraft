import { createEditor } from '@stagecraft/core/editor';
import { EditorProvider, EditorSurface, useEditorSnapshot } from '@stagecraft/react/editor';
import { importDocument, exportDocument } from '@stagecraft/io';
import { pptxAdapter } from '@stagecraft/pptx';
import { odpAdapter } from '@stagecraft/odp';
import { createDocument, validateDocument, documentPlugin, migrateLegacyDeck, toLegacyDeck } from '@stagecraft/core/document';
import { openPresentation } from '@stagecraft/source';
import { CanonicalEditorSurface } from '@stagecraft/react/canonical';

const editor = createEditor({ document: { title: 'Typed host', slides: [], sections: [] }, plugins: [{
  id: 'title', version: '1', commands: [{ id: 'title', apply: (draft, payload) => ({ ...draft, title: String(payload) }) }],
}] });
void importDocument(new Uint8Array(), { adapter: pptxAdapter });
void importDocument(new Uint8Array(), { adapter: odpAdapter });
void exportDocument({ slides: [], sections: [] }, { adapter: odpAdapter });
void exportDocument(editor.getSnapshot().document, { adapter: pptxAdapter, save: async (bytes, metadata) => {
  bytes.byteLength; metadata.mimeType;
} });
function Status() { return <span>{useEditorSnapshot<{ title: string }>().document.title}</span>; }
export const view = <EditorProvider editor={editor}><Status /><EditorSurface /></EditorProvider>;

const canonical = createDocument();
const canonicalEditor = createEditor({ document: canonical, validateDocument, plugins: [documentPlugin] });
canonicalEditor.dispatch('document.setRunText', { runId: 'run', text: 'Revised' });
canonicalEditor.dispatch('document.setRunFormat', { runId: 'run', format: { bold: true, fontSize: 24 } });
canonicalEditor.dispatch('document.setRunFormat', { runId: 'run', format: { fontFamily: 'Arial', color: '#224488' } });
canonicalEditor.dispatch('document.setParagraphFormat', { paragraphId: 'p', format: { alignment: 'center', spaceAfter: 12, bullet: { type: 'number', format: 'arabicPeriod' } } });
canonicalEditor.dispatch('document.setTextBodyLayout', { objectId: 'o', layout: { autofit: 'shrink', insets: { left: 12700 } } });
canonicalEditor.dispatch('document.setRunRangeFormat', { objectId: 'o', range: {
  start: { paragraphId: 'p', runId: 'r', offset: 0 }, end: { paragraphId: 'p', runId: 'r', offset: 1 },
}, format: { bold: true } });
canonicalEditor.getSnapshot().document.slides.map(slide => slide.objects);
const migration = migrateLegacyDeck({ slides: [], sections: [] });
const legacyProjection = toLegacyDeck(migration.document);
legacyProjection.deck.slides;

async function editRetainedSource(bytes: Uint8Array) {
  const source = await openPresentation(bytes, { format: 'pptx' });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin] });
  const result = await source.export(editor.getSnapshot().document);
  const registered = source.registerImage({ bytes: new Uint8Array(), contentType: 'image/png' });
  source.getImage(registered.assetId)?.bytes.byteLength;
  const surface = <EditorProvider editor={editor}><CanonicalEditorSurface source={source}
    onExport={(exported, context) => { exported.bytes.byteLength; context.revision.toFixed(); }}
    onError={error => { String(error); }} /></EditorProvider>;
  void surface;
  result.bytes.byteLength;
  result.dirtyParts.map(part => part.toUpperCase());
  source.dispose();
}
void editRetainedSource;

import { PresentationEditor, PresentationEditorProvider, PresentationToolbar, SlideList, PresentationCanvas, AttributePanel, DeckList, usePresentationEditor } from '@stagecraft/react/presentation';
import { presentationPlugin } from '@stagecraft/core/document';
const visualEditor = createEditor({ document: createDocument(), validateDocument, plugins: [documentPlugin, presentationPlugin] });
function CustomToolbar() {
  const ui = usePresentationEditor();
  const canPara: boolean = ui.can('paragraph-format') && ui.can('text-body-layout') && ui.can('run-range-format');
  const paraFmt: ParagraphFormatInput = { alignment: 'center', bullet: { type: 'none' } };
  const bodyLayout: TextBodyLayoutInput = { autofit: 'resize', insets: { left: 12700 } };
  const resetInsets: TextBodyLayoutInput = { insets: null };
  const rangeInput: RunRangeInput = {
    start: { paragraphId: 'p', runId: 'r', offset: 0 },
    end: { paragraphId: 'p', runId: 'r', offset: 1 },
  };
  void (canPara && ui.setParagraphFormat('p', paraFmt) && ui.setTextBodyLayout('o', bodyLayout) && ui.setTextBodyLayout('o', resetInsets) && ui.setRunRangeFormat('o', rangeInput, { bold: true }));
  return <button onClick={() => ui.addObject('text')}>Text</button>;
}
export const visual = <EditorProvider editor={visualEditor}>
  <PresentationEditor onExport={(result, context) => { result.bytes.byteLength; context.shrinkFit.count.toFixed(); if (context.shrinkFit.status === "failed") context.shrinkFit.message.toUpperCase(); }} showToolbar={false} showSlideList showAttributePanel={false}
    showDeckList decks={[{ id: 'deck', title: 'Deck' }]} activeDeckId="deck"
    onDeckSelect={id => { id.toUpperCase(); }} onSelectionChange={selection => { selection.slideId?.toUpperCase(); }} />
</EditorProvider>;
export const composed = <EditorProvider editor={visualEditor}><PresentationEditorProvider>
  <PresentationToolbar /><CustomToolbar /><SlideList /><PresentationCanvas /><AttributePanel />
</PresentationEditorProvider></EditorProvider>;
export const decks = <DeckList items={[{ id: 'one', title: 'One' }]} onSelect={id => { id.toUpperCase(); }} />;

import {
  NotesPanel,
  PresentationEditor as RootPresentationEditor,
  createPresentationPluginRegistry,
  type PresentationUIPlugin,
  type ParagraphFormatInput,
  type TextBodyLayoutInput,
  type RunRangeInput,
} from '@stagecraft/react';
const extension: PresentationUIPlugin = {
  id: 'host-controls',
  toolbarActions: [{ id: 'blank', label: 'Add blank', onAction: ui => ui.addSlide() }],
  inspectorSections: [{ id: 'revision', title: 'Revision', render: ui => <span>{ui.snapshot.revision}</span> }],
};
const registry = createPresentationPluginRegistry([extension]);
const removeExtension = registry.registerPlugin({ id: 'temporary' }); removeExtension();
export const extendedEditor = <EditorProvider editor={visualEditor}><RootPresentationEditor plugins={[extension]} showNotesPanel /></EditorProvider>;
export const standaloneNotes = <EditorProvider editor={visualEditor}><PresentationEditorProvider><NotesPanel /></PresentationEditorProvider></EditorProvider>;

import { SlideCanvas } from '@stagecraft/react';
export const labeledCanvas = <SlideCanvas slide={{}} deck={{}} width={640} label="Quarterly results" env={{
  images: new Map<string, HTMLImageElement | false>(), imageLimit: 64,
  pending: new Map<string, Promise<boolean>>(), fonts: new Map<string, 'done' | Promise<boolean>>(),
  fontEpoch: 0, prepared: new WeakMap<object, unknown>(),
}} />;
// @ts-expect-error Height derives from the deck aspect ratio, not a height prop.
export const unsupportedCanvasHeight = <SlideCanvas slide={{}} deck={{}} height={360} />;
// @ts-expect-error Canvas scale is derived from width and device pixel ratio.
export const unsupportedCanvasScale = <SlideCanvas slide={{}} deck={{}} scale={2} />;
// @ts-expect-error The paint environment requires its caches and font epoch.
export const incompleteCanvasEnvironment = <SlideCanvas slide={{}} deck={{}} env={{ imageLimit: 64 }} />;
