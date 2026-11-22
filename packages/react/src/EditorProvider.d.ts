import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { Editor, EditorSnapshot } from '@stagecraft/core/editor';

/** The host owns the editor lifecycle; unmounting never disposes it. */
export function EditorProvider<Document>(props: { editor: Editor<Document>; children?: ReactNode }): ReactElement;
/** Specify the document type used when constructing the provider's editor. */
export function useEditor<Document = unknown>(): Editor<Document>;
export function useEditorSnapshot<Document = unknown>(): EditorSnapshot<Document>;

export interface EditorSurfaceProps {
  theme?: 'light' | 'dark';
  accent?: string;
  density?: 'comfortable' | 'compact';
  layoutVariant?: string;
  onPresent?: () => void;
  onOpenExport?: () => void;
  keysEnabled?: boolean;
  keyboardScope?: 'focus' | 'window';
  className?: string;
  style?: CSSProperties;
  onError?: (error: unknown) => void;
  renderAIDrawer?: ReactNode | ((props: {
    onClose: () => void;
    slideNum: number;
    slide: unknown;
    onApplyPatch: (patch: unknown, slideId?: string) => void;
  }) => ReactNode);
  slots?: {
    aiDrawer?: EditorSurfaceProps['renderAIDrawer'];
    toolbarExtras?: ReactNode;
    belowCanvas?: ReactNode;
    inspectorExtra?: ReactNode;
  };
}
/** UI for the existing Stagecraft deck schema, using engine state and history. */
export function EditorSurface(props: EditorSurfaceProps): ReactElement;
