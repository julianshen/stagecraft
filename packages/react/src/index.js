export { StagecraftEditor } from './StagecraftEditor.jsx';
export { default as Editor } from './components/editor/Editor.jsx';
export { default as SlideEditor } from './components/editor/SlideEditor.jsx';
export { Slide } from './components/slides/SlideRenderer.jsx';
export { default as SlideCanvas } from './components/ui/SlideCanvas.jsx';
export { useDeckHistory } from './hooks/useDeckHistory.js';
export { EditorProvider, EditorSurface, useEditor, useEditorSnapshot } from './EditorProvider.jsx';
export { CanonicalEditorSurface } from './CanonicalEditorSurface.jsx';
export {
  PresentationEditor,
  PresentationEditorProvider,
  usePresentationEditor,
  DeckList,
  SlideList,
  PresentationToolbar,
  PresentationCanvas,
  AttributePanel,
  NotesPanel,
} from './PresentationEditor.jsx';
export {
  PresentationPluginProvider,
  usePresentationPlugins,
  createPresentationPluginRegistry,
} from './presentationPlugins.jsx';
