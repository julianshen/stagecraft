import type { EditorPlugin, JsonValue } from '../editor/index.js';
/** Unknown fields remain opaque JSON and are checked at runtime. */
export interface Extensible { [key: string]: unknown }
export interface SourceReference extends Extensible { format: 'pptx' | 'odp'; part: string; path: number[]; kind?: string }
export interface DocumentEntity extends Extensible { id: string; source?: SourceReference; extensions?: Record<string, JsonValue> }
export interface TextRun extends DocumentEntity { text: string; style?: Record<string, JsonValue>; editable?: boolean }
export interface TextParagraph extends DocumentEntity { runs: TextRun[]; style?: Record<string, JsonValue> }
export interface DocumentObject extends DocumentEntity {
  type: 'text' | 'shape' | 'group' | 'opaque' | (string & {});
  geometry?: { x: number; y: number; width: number; height: number; rotation?: number; [key: string]: unknown };
  assetId?: string;
  text?: { paragraphs: TextParagraph[]; [key: string]: unknown };
  children?: DocumentObject[];
}
export interface DocumentSlide extends DocumentEntity { name?: string; layoutId?: string; objects: DocumentObject[] }
export interface DocumentLayout extends DocumentEntity { masterId?: string; objects?: DocumentObject[] }
export interface DocumentMaster extends DocumentEntity { themeId?: string; objects?: DocumentObject[] }
export interface DocumentTheme extends DocumentEntity {}
export interface DocumentAsset extends DocumentEntity { relationshipId?: string }
export interface DocumentRelationship extends DocumentEntity { ownerPart: string; target: string; type: string; mode: 'internal' | 'external' }
export interface CanonicalDocument extends DocumentEntity {
  schemaVersion: 1;
  units: 'emu';
  size: { width: number; height: number; [key: string]: unknown };
  metadata: Record<string, JsonValue>;
  themes: DocumentTheme[];
  masters: DocumentMaster[];
  layouts: DocumentLayout[];
  assets: DocumentAsset[];
  relationships: DocumentRelationship[];
  slides: DocumentSlide[];
  extensions: Record<string, JsonValue>;
}
export interface DocumentDiagnostic { code: string; message: string; objectId?: string }
export interface LegacyDeck extends Extensible { slides: Array<Record<string, JsonValue>>; sections?: JsonValue[]; size?: { w?: number; h?: number; [key: string]: unknown } }
export class DocumentError extends Error { readonly code: string; constructor(code: string, message?: string) }
export function createDocument(options?: Partial<CanonicalDocument>): CanonicalDocument;
export function validateDocument(document: unknown): true;
export function migrateLegacyDeck(deck: LegacyDeck): { document: CanonicalDocument; diagnostics: DocumentDiagnostic[] };
export function toLegacyDeck(document: CanonicalDocument): { deck: LegacyDeck; diagnostics: DocumentDiagnostic[] };
export const documentPlugin: EditorPlugin<CanonicalDocument>;
/** Supported bold/italic booleans and fontSize points; null/reset is not a value. */
export function isRunFormatValue(key: string, value: unknown): boolean;
// Command value shapes use closed type aliases so they remain assignable to JsonValue.
/** Portable authored geometry in integer EMU; rotation is finite degrees. */
export type AuthoredGeometry = { x: number; y: number; width: number; height: number; rotation?: number };
export type AuthoredRunStyle = {
  b?: '0' | '1'; i?: '0' | '1'; sz?: string;
  /** Direct font family (PPTX a:latin). */
  typeface?: string;
  /** Direct East Asian / complex-script font; PPTX theme tokens remain references. */
  eastAsian?: string; complexScript?: string;
  /** Direct colour, lowercase '#rrggbb' (PPTX srgbClr). */
  color?: string;
};
export type AuthoredRun = {
  id: string; text: string; editable: true;
  style: AuthoredRunStyle;
  extensions: { stagecraftAuthored: true };
};
/** Semantic run formatting values accepted by document.setRunFormat (null resets a value). */
export type RunFormatValue = boolean | number | string | null;
export type RunFormat = {
  bold?: boolean | null; italic?: boolean | null;
  fontSize?: number | null;            // points
  fontFamily?: string | null;          // 1..64 chars, XML-valid
  eastAsian?: string | null; complexScript?: string | null;
  color?: string | null;               // '#rrggbb'
};
export type BulletFormat =
  | { type: 'none' }
  | { type: 'char'; char: string }     // exactly one grapheme
  | { type: 'number'; format: 'arabicPeriod' | 'arabicParenR' | 'lowerAlphaPeriod' | 'upperAlphaPeriod' | 'lowerRomanPeriod' | 'upperRomanPeriod' };
/** Semantic paragraph formatting stored on `paragraph.style` (units: pt / percent / EMU). */
export type ParagraphFormat = {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  spaceBefore?: number; spaceAfter?: number;   // points
  lineSpacing?: number;                        // percent of single line, 50..500
  level?: number;                              // 0..8
  indentStart?: number; indentEnd?: number; firstLineIndent?: number;  // EMU
  bullet?: BulletFormat;
};
/** Semantic text-body layout stored on `object.bodyLayout`. */
export type TextBodyLayout = {
  autofit?: 'none' | 'shrink' | 'resize';
  wrap?: 'square' | 'none';
  anchor?: 'top' | 'middle' | 'bottom';
  insets?: TextBodyInsets;  // EMU
  /** Source-owned native shrink values actually present on a:normAutofit. */
  fit?: { fontScale?: number; lnSpcReduction?: number };
};
/** Portable authored layout excludes source-owned native fit values. */
export type AuthoredTextBodyLayout = Omit<TextBodyLayout, 'fit'>;
/** Payload patch: unchanged keys are omitted, a present key typed `null` resets that value. */
export type ParagraphFormatPatch = { [K in keyof ParagraphFormat]?: ParagraphFormat[K] | null };
export type TextBodyInsets = { left?: number; top?: number; right?: number; bottom?: number };
/** Payload patch for text-body layout; insets accept per-side `null` to reset one side. */
export type TextBodyLayoutPatch = {
  autofit?: TextBodyLayout['autofit'] | null;
  wrap?: TextBodyLayout['wrap'] | null;
  anchor?: TextBodyLayout['anchor'] | null;
  insets?: { left?: number | null; top?: number | null; right?: number | null; bottom?: number | null } | null;
};
export type RunRangePoint = { paragraphId: string; runId: string; offset: number };
export type RunRange = { start: RunRangePoint; end: RunRangePoint };
export type AuthoredParagraph = { id: string; runs: AuthoredRun[]; style?: ParagraphFormat };
export type AuthoredText = { paragraphs: AuthoredParagraph[] };
export type AuthoredTableCell = { id: string; text: AuthoredText };
export type AuthoredTableRow = { id: string; cells: AuthoredTableCell[] };
export type AuthoredTableColumn = { id: string; width: number };
export type AuthoredTable = { columns: AuthoredTableColumn[]; rows: AuthoredTableRow[] };
export type AuthoredImage = { assetId: string; alt?: string };
export type AuthoredChartSeries = { name: string; values: number[] };
/** Portable chart authoring subset: bar/line/pie, ≤100 categories, ≤20 series. */
export type AuthoredChart = { kind: 'bar' | 'line' | 'pie'; categories: string[]; series: AuthoredChartSeries[] };
/** Decorative JSON Schema for the authored chart subset; runtime validation is `validateChart`. */
export const chartSchema: Readonly<Record<string, unknown>>;
/**
 * Validates an authored chart and returns a detached copy.
 * Throws an `Error` whose `code` is `'INVALID_CHART'` for unknown keys, unsupported kind,
 * value/category count mismatch, non-finite values, negative pie values or XML-invalid text.
 */
export function validateChart(value: unknown): AuthoredChart;
/** Plain solid slide background; `null` removes an explicit background. */
export type SlideBackground = { type: 'solid'; color: string };
export type SlideProperties = { name?: string; background?: SlideBackground | null; notes?: string | null };
export type AuthoredObject = {
  id: string; type: 'text' | 'shape' | 'table' | 'image' | 'chart'; geometry: AuthoredGeometry; extensions: { stagecraftAuthored: true };
} & (
  | { type: 'text'; text: AuthoredText }
  | { type: 'shape'; shape: 'rect' | 'ellipse'; fill: string; text?: AuthoredText }
  | { type: 'table'; table: AuthoredTable }
  | { type: 'image'; image: AuthoredImage }
  | { type: 'chart'; chart: AuthoredChart }
) & { bodyLayout?: AuthoredTextBodyLayout };
export type AuthoredSlide = { id: string; objects: AuthoredObject[]; extensions: { stagecraftAuthored: true }; name?: string; background?: SlideBackground; notes?: string };
export type AuthoredAssetDescriptor = { id: string; contentType: 'image/png' | 'image/jpeg' };
/** Throws DocumentError for unknown fields, invalid values or local duplicate IDs. */
export function validateAuthoredObject(object: unknown): true;
/** Validates a portable authored slide and all its authored objects. */
export function validateAuthoredSlide(slide: unknown): true;
export interface PresentationCommandPayloads {
  'presentation.addSlide': { slideId: string; index?: number };
  'presentation.removeSlide': { slideId: string };
  'presentation.moveSlide': { slideId: string; index: number };
  'presentation.addObject': { slideId: string; object: AuthoredObject };
  'presentation.removeObject': { slideId: string; objectId: string };
  'presentation.moveObject': { slideId: string; objectId: string; index: number };
  'presentation.setGeometry': { slideId: string; objectId: string; geometry: AuthoredGeometry };
  'presentation.setPaint': { slideId: string; objectId: string; fill: string };
  'presentation.setText': { slideId: string; objectId: string; text: AuthoredText };
  'presentation.setTableCell': { slideId: string; objectId: string; cellId: string; text: AuthoredText };
  'presentation.setSlideProperties': { slideId: string; properties: SlideProperties };
  'presentation.addImage': { slideId: string; object: AuthoredObject; asset: AuthoredAssetDescriptor };
  'presentation.setChart': { slideId: string; objectId: string; chart: AuthoredChart };
}
export interface DocumentCommandPayloads {
  'document.setRunText': { runId: string; text: string };
  'document.setRunFormat': { runId: string; format: RunFormat };
  'document.setParagraphFormat': { paragraphId: string; format: ParagraphFormatPatch };
  'document.setTextBodyLayout': { objectId: string; layout: TextBodyLayoutPatch };
  'document.setRunRangeFormat': { objectId: string; range: RunRange; format: RunFormat };
}
/** Validate one non-null paragraph-format value against the contract's units. */
export function isParagraphFormatValue(key: keyof ParagraphFormat, value: unknown): boolean;
export const presentationPlugin: EditorPlugin<CanonicalDocument>;
