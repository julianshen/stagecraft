import type { CanonicalDocument } from '@stagecraft/core/document';
export type ShrinkSkipReason = 'not-pptx' | 'fonts-unavailable' | 'canvas-unavailable' | 'no-shrink' | 'empty-text' | 'unsupported-metrics' | 'already-fits' | 'unchanged-native';
export type ShrinkFit = { fontScale: number; lnSpcReduction: number };
export interface ShrinkFitStats { candidates: number; measured: number; skipped: number; failed: number }
export type ShrinkMeasurement = { fit: Map<string, ShrinkFit>; stats: ShrinkFitStats; reasons: Partial<Record<ShrinkSkipReason, number>> } & (
  | { status: 'measured'; count: number }
  | { status: 'skipped'; count: 0; reason: ShrinkSkipReason }
  | { status: 'failed'; count: 0; reason: 'error'; message: string }
);
export type ShrinkFontReadiness =
  | { status: 'ready' }
  | { status: 'skipped'; reason: ShrinkSkipReason; count?: number; reasons?: Partial<Record<ShrinkSkipReason, number>> }
  | { status: 'failed'; reason: 'error'; message: string };
export function measureShrinkFits(document: CanonicalDocument, options?: { fonts?: FontFaceSet; canvas?: HTMLCanvasElement; baseline?: CanonicalDocument }): ShrinkMeasurement;
export function waitForShrinkFonts(document: CanonicalDocument, options?: { fonts?: FontFaceSet; timeoutMs?: number; baseline?: CanonicalDocument }): Promise<ShrinkFontReadiness>;
export const SHRINK_FIT_POLICY: Readonly<{ fontScales: readonly number[]; lineReductions: readonly number[]; heightMargin: number }>;

export interface ScalableParagraph {
  runs: Array<{ fontSizePt: number; [key: string]: unknown }>;
  endProperties: { fontSizePt: number; [key: string]: unknown };
  lineSpacing?: { kind?: string; value?: number };
  spaceBefore?: { value: number; [key: string]: unknown };
  spaceAfter?: { value: number; [key: string]: unknown };
  [key: string]: unknown;
}
export function scaledTextBody(
  body: { paragraphs: ScalableParagraph[]; [key: string]: unknown },
  fit: ShrinkFit,
  options?: {
    snapFontSize?: boolean;
    /** Applied only when snapFontSize is true; sets the post-snap minimum font size. */
    minimumSnappedFontSizePt?: number;
    lineSpacingReduction?: 'multiplicative' | 'subtractive';
  },
): {
  paragraphs: Array<ScalableParagraph & { lineSpacing: { kind: 'percent'; value: number } }>;
  [key: string]: unknown;
};
