import type { CanonicalDocument } from '@stagecraft/core/document';
import type { ShrinkFontReadiness } from './measureShrinkFits.js';
export function waitForAutofitFonts(document: CanonicalDocument, options?: { fonts?: FontFaceSet; timeoutMs?: number; kinds?: Array<'shrink' | 'resize'> }): Promise<{ shrink: ShrinkFontReadiness; resize: ShrinkFontReadiness }>;
