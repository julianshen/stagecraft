import type { CSSProperties, ReactElement, ReactNode, RefObject } from 'react';
import type { Editor, EditorSnapshot } from '@stagecraft/core/editor';
import type {
  AuthoredGeometry,
  AuthoredParagraph,
  BulletFormat,
  CanonicalDocument,
  DocumentObject,
  DocumentSlide,
  ParagraphFormatPatch,
  RunFormat,
  RunRange,
  RunRangePoint,
  SlideProperties,
  TextBodyLayoutPatch,
} from '@stagecraft/core/document';
import type { SourceExport, SourceSession } from '@stagecraft/source';

export type PresentationSelection = { slideId: string | null; objectId: string | null };
export type ShrinkFitOutcome =
  | { status: 'measured'; count: number }
  | { status: 'skipped'; count: 0; reason: 'not-pptx' | 'locked' | 'no-capability' | 'permission-revoked' | 'fonts-timeout' | 'fonts-unavailable' | 'no-shrink' | 'already-fits' | 'empty-text' | 'unsupported-metrics' | 'canvas-unavailable' }
  | { status: 'failed'; count: 0; reason: 'error'; message: string };
export type ExportContext = { revision: number; shrinkFit: ShrinkFitOutcome };
export type DeckListItem = { id: string; title: string; description?: string; disabled?: boolean };
export interface RegionProps { className?: string; style?: CSSProperties }

export type PresentationToolbarTab = 'Home' | 'Insert' | 'View';

export interface PresentationToolbarAction {
  id: string;
  label: string;
  tab?: PresentationToolbarTab;
  order?: number;
  visible?: (ctx: PresentationEditorContext) => boolean;
  disabled?: (ctx: PresentationEditorContext) => boolean;
  onAction: (ctx: PresentationEditorContext) => void | Promise<void>;
  render?: (ctx: PresentationEditorContext) => ReactNode;
}

export interface PresentationInspectorSection {
  id: string;
  title: string;
  order?: number;
  when?: (ctx: PresentationEditorContext) => boolean;
  render: (ctx: PresentationEditorContext) => ReactNode;
}

export interface PresentationObjectRendererContext {
  object: DocumentObject;
  slide: DocumentSlide;
  scale: number;
  selected: boolean;
  geometry: { x: number; y: number; width: number; height: number; rotation?: number };
  editor: PresentationEditorContext;
}

export interface PresentationObjectRenderer {
  id: string;
  priority?: number;
  match: (object: DocumentObject, ctx: PresentationEditorContext) => boolean;
  render: (ctx: PresentationObjectRendererContext) => ReactNode;
}

export interface PresentationUIPlugin {
  id: string;
  toolbarActions?: readonly PresentationToolbarAction[];
  inspectorSections?: readonly PresentationInspectorSection[];
  objectRenderers?: readonly PresentationObjectRenderer[];
}

export interface PresentationPluginRegistry {
  getPlugins(): readonly PresentationUIPlugin[];
  registerPlugin(plugin: PresentationUIPlugin): () => void;
  subscribe(listener: () => void): () => void;
}

export interface PresentationEditorProviderProps {
  children?: ReactNode;
  /** Trusted whole-package capability; never provide to protected/redacted clients. Host owns disposal. */
  source?: SourceSession;
  readOnly?: boolean;
  plugins?: readonly PresentationUIPlugin[];
  onExport?: (result: SourceExport, context: ExportContext) => void | Promise<void>;
  onError?: (error: unknown) => void;
  onSelectionChange?: (selection: PresentationSelection) => void;
}

export interface PresentationEditorProps extends RegionProps, Omit<PresentationEditorProviderProps, 'children'> {
  showToolbar?: boolean;
  showSlideList?: boolean;
  showAttributePanel?: boolean;
  showNotesPanel?: boolean;
  showDeckList?: boolean;
  decks?: readonly DeckListItem[];
  activeDeckId?: string | null;
  onDeckSelect?: (id: string) => void;
  renderToolbar?: () => ReactNode;
}

export interface DeckListProps extends RegionProps {
  items: readonly DeckListItem[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  emptyMessage?: string;
}

export type PresentationCapability =
  | 'existing-run-text'
  | 'existing-run-format'
  | 'paragraph-format'
  | 'text-body-layout'
  | 'run-range-format'
  | 'slide-structure'
  | 'slide-properties'
  | 'object-structure'
  | 'object-text'
  | 'object-table'
  | 'object-image'
  | 'object-chart'
  | 'object-geometry'
  | 'object-style';

export type RunFormatInput = RunFormat;

export type ParagraphBullet = BulletFormat;

export type ParagraphFormatInput = ParagraphFormatPatch;

export type TextBodyLayoutInput = TextBodyLayoutPatch;

export type RunRangeEndpoint = RunRangePoint;

export type RunRangeInput = RunRange;

export interface ChartSeriesData {
  name: string;
  values: readonly number[];
}

export interface ChartData {
  kind: 'bar' | 'line' | 'pie';
  categories: readonly string[];
  series: readonly ChartSeriesData[];
}

export type SlidePropertiesPatch = SlideProperties;

export interface PresentationEditorContext {
  /** Canvas focus target used by standalone region composition. */
  canvasRef: RefObject<HTMLElement>;
  editor: Editor<CanonicalDocument>;
  snapshot: EditorSnapshot<CanonicalDocument>;
  selection: PresentationSelection;
  activeSlide: DocumentSlide | null;
  selectedObject: DocumentObject | null;
  zoom: number;
  readOnly: boolean;
  source?: SourceSession;
  canonical: boolean;
  error: string | null;
  exporting: boolean;
  exportedRevision: number | null;
  exportAvailable: boolean;
  canExport: boolean;
  plugins: readonly PresentationUIPlugin[];
  hasCommand(id: string): boolean;
  can(capability: PresentationCapability): boolean;
  selectSlide(id: string): void;
  selectObject(id: string | null): void;
  setZoom(percent: number): void;
  reportError(error: unknown): void;
  addSlide(): void;
  removeSlide(): void;
  moveSlide(index: number): void;
  addObject(kind: 'text' | 'rect' | 'ellipse'): void;
  addTable(rows?: number, cols?: number): boolean;
  addImage(bytes: Uint8Array, contentType: 'image/png' | 'image/jpeg', alt?: string, slideId?: string): boolean;
  addChart(kind?: 'bar' | 'line' | 'pie'): boolean;
  removeObject(): void;
  moveObject(index: number): void;
  setGeometry(geometry: AuthoredGeometry, revision?: number, objectId?: string, slideId?: string): boolean;
  setPaint(fill: string): void;
  setChart(chart: ChartData, objectId?: string, slideId?: string): boolean;
  setRunText(runId: string, text: string, revision?: number): boolean;
  setRunFormat(runId: string, format: RunFormatInput, revision?: number): void;
  setParagraphFormat(paragraphId: string, format: ParagraphFormatInput, revision?: number): boolean;
  setTextBodyLayout(objectId: string, layout: TextBodyLayoutInput, revision?: number): boolean;
  setRunRangeFormat(objectId: string, range: RunRangeInput, format: RunFormatInput, revision?: number): boolean;
  setSlideProperties(properties: SlidePropertiesPatch, slideId?: string): boolean;
  setText(paragraphs: readonly AuthoredParagraph[], objectId?: string, slideId?: string): boolean;
  setTableCell(cellId: string, paragraphs: readonly AuthoredParagraph[], objectId?: string, slideId?: string, revision?: number): boolean;
  undo(): void;
  redo(): void;
  exportSnapshot(): Promise<void>;
}

/** Provider state is instance-local. EditorProvider must contain a canonical document and both documentPlugin and presentationPlugin. */
export function PresentationEditorProvider(props: PresentationEditorProviderProps): ReactElement;
export function usePresentationEditor(): PresentationEditorContext;
export function PresentationEditor(props: PresentationEditorProps): ReactElement;
/** Controlled presentation collection; independent of EditorProvider. */
export function DeckList(props: DeckListProps): ReactElement;
export function SlideList(props: RegionProps): ReactElement;
export function PresentationToolbar(props: RegionProps): ReactElement;
export function PresentationCanvas(props: RegionProps): ReactElement;
export function AttributePanel(props: RegionProps): ReactElement;
export function NotesPanel(props: RegionProps): ReactElement;

export function PresentationPluginProvider(props: { plugins?: readonly PresentationUIPlugin[]; children?: ReactNode }): ReactElement;
export function usePresentationPlugins(): {
  plugins: readonly PresentationUIPlugin[];
  registerPlugin: (plugin: PresentationUIPlugin) => () => void;
};
export function createPresentationPluginRegistry(initialPlugins?: readonly PresentationUIPlugin[]): PresentationPluginRegistry;
