# Extending the reusable editor

Core command plugins and React UI plugins are separate. A core plugin defines validated, revisioned document operations. A UI plugin contributes controls or previews that call those operations; it does not automatically authorize edits or add native file support.

## React contributions

Use `PresentationUIPlugin` from `@stagecraft/react/presentation` or the root entry point. Pass a stable `plugins` array to `PresentationEditor` / `PresentationEditorProvider`, or compose a `PresentationPluginProvider` around standalone regions. `createPresentationPluginRegistry()` offers imperative registration; its cleanup function removes only that registration. `usePresentationPlugins()` exposes the active plugins and a registration function. Registries are local to their provider; nested providers combine contributions with the nearest matching plugin ID taking precedence.

```tsx
const extensions = [{
  id: 'host-authoring',
  toolbarActions: [{
    id: 'new-slide', label: 'Add blank slide', tab: 'Insert', order: 10,
    disabled: ui => !ui.can('slide-structure'),
    onAction: ui => ui.addSlide(),
  }],
  inspectorSections: [{
    id: 'revision', title: 'Document revision', order: 100,
    render: ui => <span>{ui.snapshot.revision}</span>,
  }],
}];

<EditorProvider editor={editor}>
  <PresentationEditor source={source} plugins={extensions} onExport={save} />
</EditorProvider>
```

Toolbar actions accept `id`, `label`, optional `tab` (Home/Insert/View), `order`, `visible`, `disabled`, `onAction`, and optional custom `render`. Inspector sections accept `id`, `title`, `order`, optional `when`, and `render`. Predicate callbacks receive the current presentation context. Actions may return promises; failures go to the editor error channel.

Object renderers accept `id`, optional `priority`, `match(object, context)`, and `render({object, slide, geometry, scale, selected, editor})`. Highest matching priority wins. Rendering occurs inside an SVG object group; geometry is in the preview's display coordinates, while stored geometry remains EMU. Use an SVG `foreignObject` for HTML contributions. The plugin must supply honest appearance and accessibility; custom preview output does not establish native export compatibility.

Render callbacks run below an error boundary. A failing contribution is isolated and reported; trusted plugin code still has ordinary JavaScript privileges. This API is not a sandbox for third-party hostile code. Dynamic rendering, network calls, and native file hooks require the host's own trust and permission decisions.

## Notes and new authoring controls

`NotesPanel` is separately reusable under `PresentationEditorProvider`; `showNotesPanel` controls mounting in the full workspace. Notes commit on blur or Mod+Enter. Read-only state and editor/source replacement discard uncommitted drafts. The inspector also edits the active slide name and solid background.

Authored text exposes paragraph/run insertion and removal, per-run text and formatting controls, paragraph formatting (`ParagraphFormatFields`), text-body layout (`TextBodyLayoutFields`), and cross-run range formatting (`CrossRunRangeFormatFields`). Imported native runs retain their supported per-run and PPTX paragraph/body-layout editing semantics (imported ODP paragraph formatting remains read-only); see [Text editing contract](TEXT-EDITING.md) for boundaries. Tables and images use dedicated canonical commands and format capabilities. Image bytes belong to the retained source session, not the canonical JSON document; previews use temporary object URLs that must be revoked when no longer used. A server-protected client must receive only authorized image derivatives through a host transport, never a whole-package source session. Protected-session, remote-session, and AI APIs are not supplied by this workspace; the host owns those integrations and their authorization.

See [Component specification](COMPONENT-SPEC.md) for composition, callbacks, lifecycle, and current limits. The shipped declaration files define the exact context and contribution types. Native compatibility needs separate verification beyond internal command and export/reopen tests.

## Canvas surface interaction

Registered plugins with nonempty `objectRenderers` force the whole active slide to fall back to the standard SVG view (`plugin-renderer`) when `surface="konva"` is requested, preserving all existing SVG/DOM object renderer contributions. Toolbar-only and inspector-section plugins do not trigger fallback.
