import type { CSSProperties, ReactElement } from 'react';
import type { SourceExport, SourceSession } from '@stagecraft/source';
export interface CanonicalEditorSurfaceProps {
  /** Trusted local whole-package capability. Engine mutation authorization does
   * not authorize export. Do not provide it to protected/redacted client surfaces.
   */
  source?: SourceSession;
  readOnly?: boolean;
  onExport?: (result: SourceExport, context: { revision: number }) => void | Promise<void>;
  onError?: (error: unknown) => void;
  className?: string;
  style?: CSSProperties;
}
/** Requires EditorProvider with a canonical v1 document and documentPlugin.
 * Edits existing text runs and supported PPTX/ODP formatting. Never disposes the host's editor or source.
 * Imports scoped CSS. Native features remain preserved, but preview is simplified.
 */
export function CanonicalEditorSurface(props: CanonicalEditorSurfaceProps): ReactElement;
