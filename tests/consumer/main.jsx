import React from 'react';
import { createRoot } from 'react-dom/client';
import { StagecraftEditor } from '@stagecraft/react';
import { SAMPLE_DECK } from '@stagecraft/core';
import { buildScene } from '@stagecraft/renderer';
import { importPptx, exportToPPTX } from '@stagecraft/pptx';
import '@stagecraft/react/styles.css';
// Exercise public package exports without the playground or its server config.
globalThis.stagecraftFormats = { buildScene, importPptx, exportToPPTX };
createRoot(document.getElementById('root')).render(<StagecraftEditor defaultDeck={SAMPLE_DECK} style={{ height: 720 }} />);
