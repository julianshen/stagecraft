import type { CanonicalDocument, DocumentObject } from '@stagecraft/core/document';
export type CanonicalSceneReason = 'no-slide' | 'not-canonical' | 'unsupported-format' | 'unsupported-content' | 'unresolved-appearance' | 'inherited-appearance' | 'invalid-geometry';
export type CanonicalDiagnostic = { readonly code: string; readonly objectId?: string };
export interface CanonicalNode {
 readonly id: string;
 readonly type: 'text' | 'shape';
 readonly geometry: Readonly<NonNullable<DocumentObject['geometry']>>;
 /** CSS slide pixels, 9525 EMU/px; rotation in degrees about the frame center. */
 readonly frame: Readonly<{ x: number; y: number; width: number; height: number; rotation: number }>;
 readonly hitShape: 'rect' | 'ellipse';
 readonly textIds: readonly { readonly paragraphId: string; readonly runIds: readonly string[] }[];
}
export interface CanonicalScene {
 readonly slideId: string;
 readonly width: number;
 readonly height: number;
 readonly background: string;
 readonly nodes: readonly CanonicalNode[];
}
export type CanonicalSceneResult = { status: 'ready'; scene: CanonicalScene } | { status: 'unsupported'; reason: CanonicalSceneReason; diagnostics: readonly CanonicalDiagnostic[] };
/** No source parsing; authored canonical content only. Unsupported content refuses the whole scene. */
export function buildCanonicalScene(document: CanonicalDocument, slideId: string | null): CanonicalSceneResult;
export interface CanonicalPaintEnvironment {
 readonly fontEpoch: number;
 invalidateFonts(): void;
 dispose(): void;
 getStats(): { layoutEntries: number; geometryEntries: number; layoutBuilds: number; disposed: boolean };
}
export function createCanonicalPaintEnvironment(options?: { cacheLimit?: number }): CanonicalPaintEnvironment;
/** Local frame painting only: caller applies placement/center rotation and viewport/DPR transform. Node must come from buildCanonicalScene. */
export function paintCanonicalNode(ctx: CanvasRenderingContext2D, node: CanonicalNode, environment: CanonicalPaintEnvironment): void;
/** Background and ordered nodes including placement/center rotation; caller applies viewport/DPR transform. */
export function paintCanonicalScene(ctx: CanvasRenderingContext2D, scene: CanonicalScene, environment: CanonicalPaintEnvironment): void;
export type CanonicalFontReadiness = {status:'ready'} | {status:'skipped';reason:'fonts-unavailable'|'fonts-timeout'} | {status:'failed';reason:'error';message:string};
/** One bounded pass over scene fonts only. Host invalidates environment's font epoch after relevant font changes and suppresses obsolete completions. */
export function waitForCanonicalFonts(scene: CanonicalScene, options?: { fonts?: Pick<FontFaceSet,'load'|'check'>; timeoutMs?: number }): Promise<CanonicalFontReadiness>;
