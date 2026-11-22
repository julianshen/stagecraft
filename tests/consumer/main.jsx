import React from 'react';
import { createRoot } from 'react-dom/client';
import { StagecraftEditor } from '@stagecraft/react';
import { SAMPLE_DECK, createDocument, createEditor, documentPlugin } from '@stagecraft/core';
import { importDocument, exportDocument } from '@stagecraft/io';
import { openPresentation } from '@stagecraft/source';
import { odpAdapter } from '@stagecraft/odp';
import { buildScene } from '@stagecraft/renderer';
import { importPptx, exportToPPTX, pptxAdapter } from '@stagecraft/pptx';
import '@stagecraft/react/styles.css';
// Exercise public package exports without the playground or its server config.
globalThis.stagecraftFormats = { buildScene, importPptx, exportToPPTX, pptxAdapter, odpAdapter, openPresentation, importDocument, exportDocument };
const headless = createEditor({ document: createDocument(), plugins: [documentPlugin] });
globalThis.stagecraftDocument = headless.getSnapshot().document;
headless.dispose();
createRoot(document.getElementById('root')).render(<StagecraftEditor defaultDeck={SAMPLE_DECK} style={{ height: 720 }} />);
