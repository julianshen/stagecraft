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
export interface OpenPresentationOptions extends SourceLimits {
    format: 'pptx' | 'odp';
    xml?: XmlRuntime;
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
export interface RegisteredImage { assetId: string; contentType: 'image/png' | 'image/jpeg' }
export interface ImageBytes { bytes: Uint8Array; contentType: 'image/png' | 'image/jpeg' }
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
    export(document: CanonicalDocument, options?: SourceLimits): Promise<SourceExport>;
    dispose(): void;
}
export function openPresentation(source: Uint8Array | ArrayBuffer | Blob, options: OpenPresentationOptions): Promise<SourceSession>;
