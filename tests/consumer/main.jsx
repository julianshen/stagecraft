import React from 'react';
import { createRoot } from 'react-dom/client';
import { StagecraftEditor, DeckList, NotesPanel, createPresentationPluginRegistry } from '@stagecraft/react';
import { EditorProvider } from '@stagecraft/react/editor';
import { CanonicalEditorSurface } from '@stagecraft/react/canonical';
import { PresentationEditor, PresentationEditorProvider } from '@stagecraft/react/presentation';
import { SAMPLE_DECK, createDocument, createEditor, documentPlugin, presentationPlugin } from '@stagecraft/core';
import { importDocument, exportDocument } from '@stagecraft/io';
import { openPresentation } from '@stagecraft/source';
import { odpAdapter } from '@stagecraft/odp';
import { buildScene } from '@stagecraft/renderer';
import { importPptx, exportToPPTX, pptxAdapter } from '@stagecraft/pptx';
import '@stagecraft/react/styles.css';
// Exercise public package exports without the playground or its server config.
globalThis.stagecraftFormats = { buildScene, importPptx, exportToPPTX, pptxAdapter, odpAdapter, openPresentation, importDocument, exportDocument };
const headless = createEditor({ document: createDocument(), plugins: [documentPlugin, presentationPlugin] });
globalThis.stagecraftDocument = headless.getSnapshot().document;
globalThis.stagecraftPluginRegistry = createPresentationPluginRegistry();
createRoot(document.getElementById('root')).render(<>
  <DeckList items={[{ id: 'one', title: 'Demo' }]} onSelect={() => {}} />
  <EditorProvider editor={headless}>
    <PresentationEditor showToolbar showSlideList showAttributePanel showNotesPanel={false} />
    <PresentationEditorProvider><NotesPanel /></PresentationEditorProvider>
    <CanonicalEditorSurface />
  </EditorProvider>
  <StagecraftEditor defaultDeck={SAMPLE_DECK} style={{ height: 720 }} />
</>);
