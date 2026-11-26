import type { CanonicalDocument, DocumentDiagnostic } from '@stagecraft/core/document';
export interface XmlRuntime {
    parse(text: string): Document;
    serialize(document: Document): string;
}
export interface SourceLimits {
    maxBytes?: number;
    maxEntries?: number;
    maxEntryBytes?: number;
    maxExpandedBytes?: number;
    signal?: AbortSignal;
}
/** Transient export measurements; the canonical document is never changed. */
export interface SourceExportOptions extends SourceLimits {
    /** Shrink hints use hundred-thousandths: 100000 is unchanged scale and 10000 is one line-spacing reduction step.
     *  Hints apply only to authored boxes and native boxes whose text, geometry, or bodyLayout changed since import; stale native hints throw. */
    fit?: Map<string, { fontScale: number; lnSpcReduction: number }> | Record<string, { fontScale: number; lnSpcReduction: number }>;
    /** Grow-only text-frame heights in EMU (12700 EMU = 1pt), not shrink-scale units.
     *  Applies to top-level unrotated PPTX text boxes; untouched native hints throw and y follows the text anchor. */
    resize?: Map<string, { height: number }> | Record<string, { height: number }>;
}
export interface OpenPresentationOptions extends SourceLimits {
    format: 'pptx' | 'odp';
    xml?: XmlRuntime;
}
export interface CreatePresentationOptions {
    format: 'pptx' | 'odp';
    title?: string;
    xml?: XmlRuntime;
    signal?: AbortSignal;
}
export interface SourceExport {
    bytes: Uint8Array;
    dirtyParts: string[];
    diagnostics: readonly DocumentDiagnostic[];
}
export type SourceCapability =
    | 'existing-run-text' | 'existing-run-format' | 'slide-structure' | 'object-structure'
    | 'object-geometry' | 'object-style' | 'slide-properties' | 'object-text'
    | 'object-table' | 'object-image' | 'object-chart'
    | 'paragraph-format' | 'text-body-layout' | 'run-range-format';
/** Host-supplied image bytes. PNG or JPEG only; validated by magic and byte/count limits. */
export interface RegisteredImage {
    assetId: string;
    contentType: 'image/png' | 'image/jpeg';
    /** Marks the bytes as consumed by a committed edit; the edit's undo history keeps them reachable. Throws after release(). */
    commit(): void;
    /** Frees the quota of a registration that never reached a committed edit (denied/failed dispatch).
     *  Idempotent; refuses (false) committed or already-released bytes. Throws when the session is disposed. */
    release(): boolean;
}
export interface ImageBytes { bytes: Uint8Array; contentType: 'image/png' | 'image/jpeg' }
/** Hard limits for host-supplied image bytes and retained previews. */
export const IMAGE_LIMITS: Readonly<{ maxBytes: 5242880; maxTotalBytes: 33554432; maxImages: 64 }>;
export interface SourceSession {
    document: CanonicalDocument;
    diagnostics: readonly DocumentDiagnostic[];
    capabilities: Readonly<{
        edits: readonly SourceCapability[];
        readOnly: boolean;
        preservesUntouchedParts: true;
        exactNoOp: true;
        nativeVisualCertification: false;
        trustedWholeSource: true;
    }>;
    /**
     * Register PNG/JPEG bytes for an authored image. Bounds: 5 MiB per image, 32 MiB and 64 images
     * per session. Bytes never enter the canonical document; the returned assetId is put in
     * `document.assets` through `presentation.addImage`.
     */
    registerImage(input: { bytes: Uint8Array; contentType?: 'image/png' | 'image/jpeg' }): RegisteredImage;
    /** Copied preview bytes for an authored or reopened native image; null when unavailable. */
    getImage(assetId: string): ImageBytes | null;
    /** Asset ids with previewable bytes (authored plus retained native PNG/JPEG). */
    readonly images: readonly string[];
    export(document: CanonicalDocument, options?: SourceExportOptions): Promise<SourceExport>;
    dispose(): void;
}
export function openPresentation(source: Uint8Array | ArrayBuffer | Blob, options: OpenPresentationOptions): Promise<SourceSession>;
export function createPresentation(options: CreatePresentationOptions): Promise<SourceSession>;
