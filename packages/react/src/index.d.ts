import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { EditorSurfaceProps } from './EditorProvider.js';

export type DeckUpdater<Deck = Record<string, unknown>> = Deck | ((prev: Deck) => Deck);

export interface StagecraftEditorProps<Deck = Record<string, unknown>> {
  deck?: Deck;
  defaultDeck?: Deck;
  onDeckChange?: (updater: DeckUpdater<Deck>) => void;
  theme?: 'light' | 'dark';
  accent?: string;
  density?: 'compact' | 'comfortable' | 'cozy';
  layoutVariant?: 'default' | 'floating' | 'left-only';
  onPresent?: () => void;
  onOpenExport?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  keysEnabled?: boolean;
  keyboardScope?: 'focus' | 'window';
  renderAIDrawer?: EditorSurfaceProps['renderAIDrawer'];
  slots?: EditorSurfaceProps['slots'];
  className?: string;
  style?: CSSProperties;
}

export function StagecraftEditor<Deck = Record<string, unknown>>(props: StagecraftEditorProps<Deck>): ReactElement;

export interface LegacyEditorProps<Deck = Record<string, unknown>> {
  deck: Deck;
  onDeckChange: (updater: DeckUpdater<Deck>) => void;
  accent?: string;
  layoutVariant?: string;
  density?: string;
  onPresent?: () => void;
  onOpenExport?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  keysEnabled?: boolean;
  keyboardScope?: 'focus' | 'window';
  renderAIDrawer?: EditorSurfaceProps['renderAIDrawer'];
  slots?: EditorSurfaceProps['slots'];
}

export function Editor<Deck = Record<string, unknown>>(props: LegacyEditorProps<Deck>): ReactElement;

export interface SlideEditorProps<Deck = Record<string, unknown>> {
  deck: Deck;
  currentSlideId?: string;
  onCurrentSlideChange?: (id: string) => void;
  renderSlide: (slide: unknown, ctx: unknown) => ReactNode;
  renderCanvasSlide?: (slide: unknown, ctx: unknown) => ReactNode;
  comments?: readonly unknown[];
  layoutVariant?: string;
  showCollabCursors?: boolean;
  collaborators?: readonly unknown[];
  tools?: readonly { id: string; icon: string; title?: string }[];
  slots?: EditorSurfaceProps['slots'];
  callbacks?: Record<string, ((...args: unknown[]) => unknown) | undefined>;
  selectedElement?: unknown;
  selectedElementIds?: readonly string[];
  selectedElementCount?: number;
  onSelectElement?: (id: string | null, additive?: boolean) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  keysEnabled?: boolean;
  keyboardScope?: 'focus' | 'window';
  renderAIDrawer?: EditorSurfaceProps['renderAIDrawer'];
  theme?: { accent?: string; density?: string };
}

export function SlideEditor<Deck = Record<string, unknown>>(props: SlideEditorProps<Deck>): ReactElement;

export function Slide(props: {
  slide: unknown;
  deck: unknown;
  sectionName?: string;
  num?: number;
  total?: number;
  editable?: boolean;
  onEditField?: (path: readonly (string | number)[], value: unknown) => void;
  onApplyPatch?: (patch: Record<string, unknown>) => void;
}): ReactElement;

/** Mutable asset caches used by the canvas painter and asset loader. */
export interface SlideCanvasPaintEnvironment {
  images: Map<string, false | (CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number })>;
  imageLimit: number;
  pending: Map<string, Promise<boolean>>;
  fonts: Map<string, 'done' | Promise<boolean>>;
  fontEpoch: number;
  /** Painter-owned cache; hosts should initialize this as an empty WeakMap. */
  prepared: WeakMap<object, unknown>;
}

export function SlideCanvas(props: {
  slide: unknown;
  deck: unknown;
  /** Height follows the deck's aspect ratio; omitted width follows the container. */
  width?: number;
  label?: string;
  env?: SlideCanvasPaintEnvironment;
  className?: string;
  style?: CSSProperties;
}): ReactElement;

export interface DeckHistoryResult<Deck = unknown> {
  deck: Deck;
  commit: (updater: Deck | ((prev: Deck) => Deck)) => void;
  undo: () => void;
  redo: () => void;
  reset: (deck: Deck) => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useDeckHistory<Deck = unknown>(initial: Deck | (() => Deck)): DeckHistoryResult<Deck>;

export {
  EditorProvider,
  EditorSurface,
  useEditor,
  useEditorSnapshot,
  type EditorSurfaceProps,
} from './EditorProvider.js';

export {
  CanonicalEditorSurface,
  type CanonicalEditorSurfaceProps,
} from './CanonicalEditorSurface.js';

export {
  PresentationEditor,
  PresentationEditorProvider,
  usePresentationEditor,
  DeckList,
  SlideList,
  PresentationToolbar,
  PresentationCanvas,
  AttributePanel,
  NotesPanel,
  PresentationPluginProvider,
  usePresentationPlugins,
  createPresentationPluginRegistry,
  type PresentationSelection,
  type ExportContext,
  type DeckListItem,
  type RegionProps,
  type PresentationToolbarTab,
  type PresentationToolbarAction,
  type PresentationInspectorSection,
  type PresentationObjectRendererContext,
  type PresentationObjectRenderer,
  type PresentationUIPlugin,
  type PresentationPluginRegistry,
  type PresentationEditorProviderProps,
  type PresentationEditorProps,
  type DeckListProps,
  type PresentationCapability,
  type RunFormatInput,
  type ParagraphBullet,
  type ParagraphFormatInput,
  type TextBodyLayoutInput,
  type RunRangeEndpoint,
  type RunRangeInput,
  type ChartSeriesData,
  type ChartData,
  type SlidePropertiesPatch,
  type PresentationEditorContext,
} from './PresentationEditor.js';
