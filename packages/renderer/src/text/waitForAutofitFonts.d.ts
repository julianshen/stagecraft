import type { CanonicalDocument } from '@stagecraft/core/document';
export type AutofitFontReadiness =
  | { status: 'ready' }
  | { status: 'skipped'; reason: string; count?: number; reasons?: Record<string, number> }
  | { status: 'failed'; reason: 'error'; message: string };
export function waitForAutofitFonts(document: CanonicalDocument, options?: { fonts?: FontFaceSet; timeoutMs?: number; kinds?: Array<'shrink' | 'resize'>; baseline?: CanonicalDocument }): Promise<{ shrink: AutofitFontReadiness; resize: AutofitFontReadiness }>;
