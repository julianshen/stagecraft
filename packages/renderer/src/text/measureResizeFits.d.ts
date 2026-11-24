import type { CanonicalDocument } from '@stagecraft/core/document';
export type ResizeReason = 'no-resize' | 'already-fits' | 'empty-text' | 'not-pptx' | 'grouped' | 'rotated' | 'wrap-none' | 'unsupported-geometry' | 'unsupported-metrics' | 'fonts-unavailable' | 'fonts-timeout' | 'canvas-unavailable' | 'locked' | 'no-capability' | 'permission-revoked' | 'error';
export interface ResizeFitOutcome {
 status: 'measured' | 'skipped' | 'failed';
 count: number;
 reason?: ResizeReason;
 message?: string;
 stats: { candidates: number; measured: number; skipped: number; failed: number };
 reasons: Partial<Record<ResizeReason, number>>;
}
export interface ResizeMeasurement extends ResizeFitOutcome { resize: Map<string, { height: number }> }
export function measureResizeFits(document: CanonicalDocument, options?: { fonts?: FontFaceSet; canvas?: HTMLCanvasElement }): ResizeMeasurement;
export function resizeFallback(document: CanonicalDocument, status: 'skipped' | 'failed', reason: ResizeReason, message?: string): ResizeMeasurement;
export const RESIZE_FIT_POLICY: Readonly<{ heightMargin: number }>;
