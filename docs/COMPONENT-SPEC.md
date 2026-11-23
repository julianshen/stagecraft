# Stagecraft reusable React component specification

Status: implemented presentation-component contract, including portable chart authoring and advanced text formatting. The packages are private workspace packages, not a stable public release. This specification describes supported controls and integration responsibilities; it does not establish full PowerPoint/ODP parity or native visual certification. This workspace includes reusable regions, structural editing, per-run and cross-run text formatting, paragraph formatting, text-body layout, and UI plugins; see [Text editing contract](TEXT-EDITING.md) and [Canonical documents](CANONICAL-DOCUMENTS.md) for command and format boundaries.

## Entry points and ownership

`@stagecraft/react/presentation` and `@stagecraft/react` export `PresentationEditor`, `PresentationEditorProvider`, `usePresentationEditor`, `DeckList`, `SlideList`, `PresentationToolbar`, `PresentationCanvas`, `AttributePanel`, `NotesPanel`, `PresentationPluginProvider`, `usePresentationPlugins`, and `createPresentationPluginRegistry`. `EditorProvider`, `useEditor`, and `useEditorSnapshot` are available through `@stagecraft/react/editor` and the root.

The host constructs an editor with a canonical document, document validation, `documentPlugin`, and `presentationPlugin`. It owns editor/source disposal, file loading, persistence, routing, authentication, authorization, and network transport. Components dispatch revisioned commands against immutable snapshots; they do not maintain a second document store. Native import/export belongs to `@stagecraft/source`. No presentation component implicitly downloads, uploads, fetches, or stores a document in localStorage.

`PresentationEditorProvider` requires the nearest `EditorProvider`. It owns selection, active-slide fallback, zoom, error state, and export lifecycle. Selection and zoom are local UI state and do not enter undo history. The first available slide starts active, with no selected object. Deleted selections reconcile to a valid fallback. Editor/source replacement clears stale selection and export state. Separate providers maintain independent state. The host must pair an editor with the source session that produced its canonical document.

```tsx
<EditorProvider editor={editor}>
  <PresentationEditor
    source={source}
    onExport={saveExport}
    showToolbar
    showSlideList
    showAttributePanel
    showNotesPanel
  />
</EditorProvider>
```

Each region can be independently mounted in a custom layout:

```tsx
<EditorProvider editor={editor}>
  <PresentationPluginProvider plugins={hostUIPlugins}>
    <PresentationEditorProvider source={source} onExport={saveExport}>
      <PresentationToolbar />
      <div className="host-workspace">
        <SlideList />
        <PresentationCanvas />
        <AttributePanel />
      </div>
      <NotesPanel />
    </PresentationEditorProvider>
  </PresentationPluginProvider>
</EditorProvider>
```

The composed editor creates its own presentation provider. Use standalone regions when providing one explicitly; nested providers shadow rather than merge presentation UI state. The UI plugin provider is a distinct registry and may surround either layout.

## Public props and callbacks

The declarations in [PresentationEditor.d.ts](../packages/react/src/PresentationEditor.d.ts) define the complete TypeScript surface. All visual regions accept `className?: string` and `style?: CSSProperties`.

| Provider prop | Type/default | Behavior |
|---|---|---|
| `children` | `ReactNode` | Standalone region composition |
| `source` | optional `SourceSession` | Trusted native-package export and image capability; host-owned |
| `readOnly` | `boolean`, false | Disables built-in document mutations; cannot relax source/core policy |
| `plugins` | readonly `PresentationUIPlugin[]` | UI contributions, overriding inherited plugins with the same ID |
| `onExport` | `(result: SourceExport, context: ExportContext) => void \| Promise<void>` | Host saves the captured export; completion is awaited |
| `onError` | `(error: unknown) => void` | Receives command, export, and UI-plugin failures |
| `onSelectionChange` | `(selection: {slideId: string|null; objectId: string|null}) => void` | Initial and subsequent reconciled selection; not a mutation event |

`PresentationEditor` accepts these provider props except `children`, plus the following:

| Prop | Default | Behavior |
|---|---|---|
| `showToolbar` | true | Mounts the toolbar region |
| `showSlideList` | true | Mounts the slide rail |
| `showAttributePanel` | true | Mounts the inspector |
| `showNotesPanel` | true | Mounts speaker notes |
| `showDeckList` | false | Mounts the controlled presentation collection |
| `decks` | `[]` | Readonly `DeckListItem[]` |
| `activeDeckId` | undefined | Active deck ID or null |
| `onDeckSelect` | undefined | `(id: string) => void`; host loads the selected deck |
| `renderToolbar` | undefined | `() => ReactNode`; replaces the toolbar when `showToolbar` is true |

Visibility props actually unmount their region. Hiding an inspector or notes region discards its uncommitted local drafts without editing the document. The canvas remains mounted in `PresentationEditor`; omit it with standalone composition when necessary. For a hook-based custom toolbar, return a component from `renderToolbar`, rather than calling presentation hooks inside that callback.

## Standalone regions

### DeckList

`DeckList` is controlled and independent of editor context. Props are `items: readonly DeckListItem[]`, `activeId?: string|null`, `onSelect?: (id: string) => void`, `emptyMessage?: string` (default `No presentations`), and region props. Items contain `id`, `title`, optional `description`, and optional `disabled`.

Items are buttons; active state uses `aria-current`, disabled items cannot select, and title/description are rendered as text. This component does not load, rename, delete, authorize, or persist a deck. The host provides those actions separately.

### SlideList

Requires a presentation provider. Shows canonical slide order, names, selected state, and simplified thumbnails. Selecting a slide clears object selection without a document edit. Add/remove/move-up/move-down actions dispatch presentation commands and honor capability checks. Empty documents offer Add slide and allow unchanged source export. Source-backed editors prevent deleting the final slide; source-less canonical editors may become empty. With this region hidden, hosts can navigate using `selectSlide(id)`.

### PresentationToolbar

Requires a presentation provider. The built-in ribbon has Home, Insert, and View tabs:

| Tab | Built-in actions |
|---|---|
| Home | Undo, Redo, Delete object, Bring forward, Send backward |
| Insert | Text box, Rectangle, Ellipse, Table, Chart, Image when a source image registry exists, Blank slide |
| View | Zoom draft, 100% reset |

Chart inserts a default authored bar chart; its inspector can switch between bar, line, and pie. Table insertion creates a 2×2 authored table. `addTable(rows, cols)` additionally supports bounded host-selected sizes. Image selection accepts PNG/JPEG, reads bytes locally, and delegates validation/asset registration to the source. Async file delivery is cancelled when its editor/source/slide/read-only lifetime changes; obsolete completions do not insert into a replacement document. Image preview URLs are revoked on asset/source change and unmount.

Export appears when both `source` and `onExport` exist. Buttons reflect selection, registered command families, source capabilities, read-only state, and current export status. Zoom ranges from 25% to 200%; 100% uses a 960 CSS-pixel slide width. Ribbon tab selection and zoom never change document history. Formatting belongs to the inspector or host contributions.

### PresentationCanvas

Requires a presentation provider. Shows a simplified selectable preview of top-level text, eligible primitives, table cells, registered images, and portable bar/line/pie charts. Unsupported objects show a placeholder rather than a fabricated native rendering. Background preview uses a supported solid slide color. Thumbnails use the same rendering rules.

Object click or Enter/Space selects; clicking the empty SVG clears selection. Eligible objects can be dragged or resized. Rotated objects have no pointer resize handle; their dimensions remain editable in the inspector. Pointer movement remains a local preview, and pointer-up dispatches one geometry command using the gesture-start revision. Pointer cancellation, lost capture, window blur, editor/source/slide replacement, read-only transition, or unmount discards the gesture. Resize enforces a 1pt minimum. Stale-revision and policy errors are reported, without silently overwriting a newer document.

Double-click an editable text run to open an inline textarea. The draft preserves that run's identity and start revision; blur or Cmd/Ctrl+Enter commits, Escape cancels. IME composition does not trigger these commit/cancel shortcuts. Selection, editor/source replacement, or read-only transition discards an obsolete inline draft. This edits a single existing run, not a cross-run selection, native text layout engine, or arbitrary whole-shape replacement.

Canvas keyboard shortcuts are scoped to its focused region:

| Input | Action |
|---|---|
| Delete/Backspace | Remove eligible selected object |
| Arrow key | Nudge eligible geometry by 1pt |
| Shift+Arrow | Nudge by 10pt |
| Escape | Cancel gesture/clear selection; inline editor handles its own cancellation |
| Cmd/Ctrl+Z | Undo |
| Shift+Cmd/Ctrl+Z | Redo |

Inputs, textareas, selects, and editable content do not invoke canvas editing shortcuts. Screen coordinates are converted to canonical EMU; 1pt is 12700 EMU. Zoom changes display scale only. Group-transformed or otherwise ineligible imported geometry is not editable through these controls.

### AttributePanel

Requires a presentation provider. The panel is inspectable in read-only mode. With no object selected, it shows a selection prompt and supported slide properties.

| Selection/property | Supported controls |
|---|---|
| Geometry | X/Y/width/height in points; finite safe integer EMU validation on commit, positive sizes |
| Rect/ellipse fill | Solid six-digit hex color for authored objects or explicitly eligible imported objects |
| Existing text runs | Text, bold, italic, font size, font family, and color when permitted by source/run policy |
| Authored text/shape text | Add/remove paragraphs and runs; at least one paragraph/run retained by controls |
| Table | Cell/run text and supported run formatting; authored cell replacement through `setTableCell` |
| Chart | Authored kind/category/series/value controls; parsed imported charts show read-only data |
| Image | Asset ID and optional alt text display; insertion sets alt text from file name |
| Active slide | Name, solid background, and clear-background action |

Run text changes dispatch immediately from inspector fields. Geometry/name/font-size controls may retain local drafts until blur/Enter; supported drafts reset on relevant snapshot, read-only, or owner changes. Name and notes drafts are tied to editor/source identity so matching slide IDs in a replacement document do not inherit a prior draft.

PPTX `Inherit` removes a direct run-format override; ODP `Original` removes a session override. Authored text structures use canonical paragraph/run IDs and retain their unrelated supported properties. Built-in inspector controls and `usePresentationEditor()` hook wrappers (`setParagraphFormat`, `setTextBodyLayout`, `setRunRangeFormat`) expose paragraph formatting, text-body layout (for text objects and shapes that carry `object.text`, not textless shapes), and cross-run range formatting alongside per-run controls. Range selection maps normalized textarea UTF-16 boundaries (including `\r\n` and surrogate pairs) back to Unicode code-point offsets within canonical runs, and `null` resets clear direct properties; range colour holds a local draft committed via `Apply colour`. In ODP, removing or disabling a bullet at `level > 0` clears `level` atomically in the same command. Numeric drafts are invalidated by relevant revision/owner/read-only changes. Main font-family controls write the Latin typeface (`fontFamily`), while the collapsible Font details section edits East Asian (`eastAsian`) and complex-script (`complexScript`) fonts; autofit settings are saved for export without measured canvas shrink/resize simulation. See [Text editing contract](TEXT-EDITING.md) and [Canonical documents](CANONICAL-DOCUMENTS.md) for core commands and native format restrictions. Table controls do not add/remove rows/columns, merge cells, or author arbitrary table styles. Image crop/replacement/effects and alt-text editing are not built-in controls.

### Portable chart inspector and preview

The Chart insert button calls `addChart('bar')`. Authored charts expose kind selection, category add/remove/rename, series add/remove/rename, and numeric values. Fields commit on blur/Enter; structural buttons and kind selection commit immediately. Limits are 1–100 categories, 1–20 series, and names up to 1000 characters. Every series has one finite number per category. Pie charts use exactly one nonnegative series; switching to pie retains the first series and clamps negative/nonfinite draft values to zero. Undo is available through normal history.

`setChart` requires an authored chart and the registered command. Imported parsed charts remain read-only in the inspector; unsupported native charts remain opaque. Drafts reset on editor/source/object/chart/capability change. Read-only controls do not authorize mutation.

The SVG preview provides bar/line/pie geometry, bounded visible labels and legends, and a title/description. Pie data with no positive values shows an empty-data message. The preview uses a fixed palette and simplified layout; it does not reproduce native axes, typography, theme effects, or arbitrary chart styles. It is an internal renderer, not an independently exported `PresentationChart` component.

### NotesPanel

Requires a presentation provider. Shows speaker notes for the active slide, or a no-slide message. A local textarea draft commits through `setSlideProperties({notes})` on blur or Cmd/Ctrl+Enter. The shortcut commits once. Plain Enter inserts a newline. Read-only notes remain selectable. Drafts reset on slide/editor/source replacement, changed snapshot notes, or capability changes; unmount discards a draft. Native notes authoring is bounded by the source writer's supported notes structure.

## Context state and actions

`usePresentationEditor()` throws outside its provider. It exposes:

- `editor`, immutable `snapshot`, `source`, and `canonical`.
- `selection`, `activeSlide`, `selectedObject`, and `canvasRef`.
- `zoom`, effective `readOnly`, merged `plugins`.
- `error`, `exporting`, `exportedRevision`, `exportAvailable`, `canExport`.
- `hasCommand(id)` and `can(capability)`.

Actions use stable IDs and the current snapshot revision unless explicitly overridden:

| Action | Contract |
|---|---|
| `selectSlide(id)`, `selectObject(id\|null)`, `setZoom(percent)` | UI state only |
| `addSlide()`, `removeSlide()`, `moveSlide(index)` | Slide structure; index is final zero-based position |
| `addObject('text'\|'rect'\|'ellipse')` | Authored primitive insertion |
| `addTable(rows = 2, cols = 2): boolean` | Authored table, row count clamped to 1–50 and column count to 1–20 for valid numeric inputs |
| `addChart(kind = 'bar'): boolean` | Insert a portable bar/line/pie chart |
| `setChart(chart, objectId?, slideId?): boolean` | Replace authored chart data through `presentation.setChart` |
| `addImage(bytes, contentType, alt?, slideId?): boolean` | PNG/JPEG bytes registered with source and inserted as an authored object |
| `removeObject()`, `moveObject(index)` | Selected top-level object; index zero is back-most |
| `setGeometry(geometry, revision?, objectId?, slideId?): boolean` | Complete x/y/width/height geometry, optional rotation; object eligibility enforced |
| `setPaint(fill)` | Selected eligible rect/ellipse solid fill |
| `setRunText(runId, text, revision?): boolean` | Single existing run; explicit revision supports draft protection |
| `setRunFormat(runId, {bold?, italic?, fontSize?, fontFamily?, eastAsian?, complexScript?, color?}, revision?)` | Values may be null to restore supported inherited/original formatting |
| `setParagraphFormat(paragraphId, format, revision?): boolean` | Eligible paragraph alignment, spacing, indents, level, and bullet/numbering; null resets direct values |
| `setTextBodyLayout(objectId, layout, revision?): boolean` | Eligible text-body autofit, wrap, vertical anchor, and insets (`insets: null` clears all insets) |
| `setRunRangeFormat(objectId, range, format, revision?): boolean` | Cross-run formatting using Unicode code-point run offsets in authored object text |
| `setSlideProperties({name?, background?, notes?}, slideId?): boolean` | Background is `{type:'solid', color}` or null; notes may be null |
| `setText(paragraphs, objectId?, slideId?): boolean` | Authored text/shape paragraph structure replacement |
| `setTableCell(cellId, paragraphs, objectId?, slideId?, revision?): boolean` | Authored cell text replacement |
| `undo()`, `redo()` | Core history, honoring revision and read-only checks |
| `exportSnapshot(): Promise<void>` | Captured immutable revision export |
| `reportError(error)` | Update the shared error display and invoke host reporting |

A boolean result indicates whether the UI action dispatched successfully, not whether native export is guaranteed or the document changed. Core/source validation remains authoritative. Some convenience actions return void and report failures through context. Custom actions may use `editor.dispatch` with `expectedRevision`; they must enforce their own UI gating and preserve core authorization.

Default text/shape objects begin at 72pt/72pt with size 240pt×100pt. Text starts as `Text` at 24pt; shape fill is `#4472C4`. A default table is 360pt×120pt with cells containing `Cell`. Images start at 240pt×180pt. Charts start at 360pt×220pt with Q1/Q2/Q3 and one sample series. IDs are generated at insertion and are identities, not authorization tokens.

## UI plugins

UI plugins extend controls and rendering independently from core command plugins. They do not automatically register commands or native source writers. A plugin has a nonempty string `id` and optional readonly `toolbarActions`, `inspectorSections`, and `objectRenderers` arrays.

| Contribution | Required fields | Optional fields and behavior |
|---|---|---|
| Toolbar action | `id`, `label`, `onAction(ctx)` | `tab` defaults Home; `order` defaults 0; `visible(ctx)`, `disabled(ctx)`, `render(ctx)` |
| Inspector section | `id`, `title`, `render(ctx)` | `order` defaults 0; `when(ctx)` |
| Object renderer | `id`, `match(object, ctx)`, `render(renderCtx)` | `priority` defaults 0; greatest matching priority wins, first registration wins ties |

Toolbar/inspector contributions sort by ascending `order`. Custom toolbar rendering replaces the standard action button; the plugin then owns its disabled state, event handling, and accessibility. Standard `onAction` may be async and its rejection is reported. Predicate and render callbacks are synchronous and should be pure. Predicates are evaluated during rendering and may be called again for thumbnails or React rerenders.

Object render context contains `object`, `slide`, `scale`, `selected`, pixel-space `geometry: {x,y,width,height,rotation?}`, and `editor` (the presentation UI context, not just the kernel). The contribution renders inside an SVG group; return SVG content or an appropriate `foreignObject`. A matched renderer replaces the default object appearance, while built-in selection/geometry handling remains outside it. Canvas and thumbnails both use renderer contributions; their selection/interaction contexts differ.

`PresentationPluginProvider({plugins, children})` supplies a registry. `usePresentationPlugins()` returns `{plugins, registerPlugin}`; outside a registry it returns an empty list and no-op registration. `registerPlugin(plugin)` returns an unregister function; call it from effect cleanup for imperative plugins. Same-ID registration replaces the current entry, and an obsolete unregister token cannot remove a newer replacement. Removing a replacement does not restore an earlier same-registry entry. Nested registries merge parent contributions with child overrides; direct `PresentationEditorProvider.plugins` take precedence over inherited plugins.

`createPresentationPluginRegistry(initialPlugins?)` exposes `getPlugins()`, `registerPlugin()`, and `subscribe(listener)`. Snapshot arrays are frozen; plugin objects are not deep-frozen. Treat plugin descriptions as immutable and register a replacement when changing contributions. Declarative plugin arrays are registered by an effect and cleaned up on replacement/unmount. Keep array/object identity stable when no change is intended.

A failed visible/match/when predicate omits its contribution; a failed disabled predicate falls back to the standard enabled state, so it must never be an authorization check. Predicate errors are reported after render. Render failures are contained by per-slot error boundaries and hide the failed contribution; replacing the renderer identity or changing its reset context allows recovery. Errors in `onError` are isolated. Error boundaries do not sandbox plugins or catch arbitrary asynchronous work launched by a custom renderer. Host-provided plugins are trusted code with access to the supplied context, including any source capability.

## Command and source capability mapping

`can()` requires a canonical document, an unlocked UI/source, the relevant registered commands, and (when source exists) the advertised source capability. Core plugin registration/removal refreshes availability. Object/run-level eligibility narrows these coarse capabilities further.

| Capability | Core command(s) used |
|---|---|
| `existing-run-text` | `document.setRunText` |
| `existing-run-format` | `document.setRunFormat` |
| `paragraph-format` | `document.setParagraphFormat` |
| `text-body-layout` | `document.setTextBodyLayout` (requires `object.text`) |
| `run-range-format` | `document.setRunRangeFormat` (authored `object.text` only) |
| `slide-structure` | `presentation.addSlide`, `removeSlide`, `moveSlide` |
| `slide-properties` | `presentation.setSlideProperties` |
| `object-structure` | `presentation.addObject`, `removeObject`, `moveObject` |
| `object-text` | `presentation.setText` |
| `object-table` | `presentation.addObject`; cell editor separately requires `presentation.setTableCell` |
| `object-chart` | `presentation.addObject`; data editing separately requires `presentation.setChart` |
| `object-image` | `presentation.addImage`, plus source asset registration |
| `object-geometry` | `presentation.setGeometry` |
| `object-style` | `presentation.setPaint` |

Imported geometry requires explicit `extensions.editableGeometry`; imported fill requires `extensions.editableFill`. Authored object eligibility is validated by core/source, not inferred from appearance. The source writer checks deltas against its private baseline and rejects unsupported or forged mutations even after a command succeeds. Existing native structures outside the supported subset remain retained or opaque. ODP nonzero rotation export is rejected; there is no default rotation control. PPTX slide insertion needs an existing native layout, supplied by the new-document source fixture.

## Export and host security responsibilities

Export captures the clicked snapshot/revision and permits one in-flight export per provider. Repeated requests while locked are ignored. A result/error from an obsolete editor/source or unmounted provider does not reach host export callbacks. Concurrent editing does not change the captured export. `onExport` completion is awaited and errors are reported. Its `ExportContext` contains `revision` and `shrinkFit` (measured/skipped/failed status, count, and reason/message when applicable); see [SHRINK-MEASUREMENT.md](SHRINK-MEASUREMENT.md#export-outcome-metadata). The host decides download/upload destinations and independently authorizes export.

`source` is a trusted whole-package capability. Never give it to a protected/redacted client: hidden data and untouched original package parts may remain present. Deleting visible objects does not sanitize a source package. Protected export must be rebuilt from an authorized server projection. These React components require a local editor interface. This workspace does not supply protected-session, remote-session, or AI APIs. A host needing a protected client must provide its own authorization, transport, and presentation surface for authorized projections without sending the canonical source.

UI `readOnly`, hidden buttons, plugin predicates, and source capability flags are not security boundaries. Core/server authorization is authoritative. UI plugins are not sandboxed. Error callbacks accept unknown errors: kernel/document errors commonly have a code, while source/host errors may be plain Error objects. Hosts should not expose sensitive server exceptions through local error messages.

## Styling and accessibility

Presentation styles use `stagecraft-presentation-*` classes and region class/style props. The package imports its scoped presentation stylesheet. Layout supports hidden panels and narrow screens without requiring application routing or body resets.

Named regions identify slides, presentations, canvas, toolbar, inspector, and notes. Deck/slide selection uses `aria-current`; objects expose pressed selection and keyboard focus. Ribbon tabs implement tablist/tab/tabpanel IDs and Arrow/Home/End navigation. Numeric/keyboard controls offer alternatives to pointer manipulation. Buttons and text fields have labels; text content is rendered without raw HTML injection. Canvas errors use an alert and completed export revisions use a status region. Deleting an object or leaving inline editing returns focus to the canvas.

Custom layouts without `PresentationCanvas` must render/announce `error`, `exporting`, and `exportedRevision` themselves. Custom plugin renderers/actions must provide their own appropriate semantics and keyboard behavior. Built-in accessibility affordances do not constitute a completed accessibility audit.

No DOM API is invoked at module initialization for presentation operations; interactive effects and browser file APIs require a client environment. Plugin contributions registered by effects are not present in initial server markup. SSR/hydration support beyond this behavior has not been certified. Host unmount does not dispose the editor/source; components clean up their own subscriptions, pointer capture, object URLs, and stale deliveries.

## Related surfaces and current limits

`CanonicalEditorSurface` is a smaller existing-run text/format surface under `EditorProvider`; it accepts source/readOnly/export/error/region props. `EditorSurface` and `StagecraftEditor` adapt the legacy Stagecraft deck UI and expose their own slots and callbacks. They do not imply canonical source capabilities or full fidelity; consult their shipped declarations separately. The package root now has declarations for its reusable and legacy exported surfaces, but a stable published API and compatibility policy remain future work.

Native chart validation, part generation, safe readers, and React controls are integrated for bar/line/pie. The UI enables native-source chart authoring only when `object-chart` is advertised and required commands are registered. The chart subset uses 1–100 categories and 1–20 finite series; pie has exactly one nonnegative series. Authored chart rotation is rejected before commit. It does not cover combo/scatter/stacked charts, arbitrary native chart formatting, or external workbooks. Successful internal export/reopen checks establish package consistency; they do not establish native Office or LibreOffice visual fidelity.

Other remaining work includes advanced typography and native range editing, broader shapes and effects, connectors/groups, table structure/styles/merges, image crop/effects, themes/masters/layouts, transitions/animations/media, comments/coauthoring, comprehensive accessibility, and broader native format compatibility. Rich structures retained in a source are not automatically editable or accurately rendered.

Verification should cover standalone composition and on/off regions, multiple editor isolation, plugin registration/removal/error recovery, draft identity/read-only transitions, stale inline/gesture revisions, image/export async cleanup, source delta rejection, and native export/reopen. Chromium/unit/type/consumer/package checks and native Office/LibreOffice observations are separate evidence; passing internal reopen tests does not certify native fidelity.
