# Stagecraft library workspaces

Development requires Node.js 22.12+ (22 LTS is used in CI), 24, or 26+. Run `npm install`, then `npx playwright install chromium` before the test suite.

Stagecraft provides private source packages and a Vite playground. The existing React editor uses the legacy deck schema. A separate headless foundation supplies canonical documents, plugin transactions, host-controlled I/O and native PPTX/ODP source sessions. Reusable canonical React workspace components sit on this foundation. Protected-server and agent APIs are outside this milestone.

| Workspace | Ownership |
| --- | --- |
| `@stagecraft/core` | Legacy helpers plus canonical documents, transactions and command plugins |
| `@stagecraft/renderer` | Canvas scene/painter, assets and pinned OfficeView drawing code |
| `@stagecraft/react` | React editor, reusable surfaces, styles and editor hooks |
| `@stagecraft/pptx` | Legacy PPTX conversion, byte adapter and OOXML helpers |
| `@stagecraft/io` | Bounded bytes and host-controlled load/save adapter contracts |
| `@stagecraft/odp` | Experimental legacy-deck ODP subset conversion |
| `@stagecraft/source` | Retained native PPTX/ODP sessions and supported canonical edits |
| `@stagecraft/playground` | Application screens, persistence, HTTP/MCP middleware and optional AI integration |

Packages cannot import playground code. The editor receives optional AI UI through `renderAIDrawer`; network credentials and application services remain with the host.

```jsx
import { StagecraftEditor } from '@stagecraft/react';
import { SAMPLE_DECK } from '@stagecraft/core';
import '@stagecraft/react/styles.css';

<StagecraftEditor defaultDeck={SAMPLE_DECK} style={{ height: 720 }} />
```

Use `deck` plus `onDeckChange` for controlled state. `defaultDeck` creates an internal undoable deck. The wrapper scopes theme/accent/density tokens and keyboard handling to its focused editor by default. Optional presentation/export callbacks and AI drawer rendering are host-owned. Existing localStorage-backed settings are still shared; this is not complete multi-editor state isolation. The source packages are private and require a JSX/TypeScript-capable bundler; they are not published distribution bundles or a stable SDK.

For headless native editing, keep the canonical document paired with its source session:

```js
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { openPresentation } from '@stagecraft/source';

const source = await openPresentation(file, { format: 'pptx' });
const editor = createEditor({
  document: source.document,
  validateDocument,
  plugins: [documentPlugin, presentationPlugin],
});
// Dispatch supported commands with IDs from this document and an expected revision.
const { bytes, diagnostics } = await source.export(editor.getSnapshot().document);
// The host saves bytes and presents diagnostics, then disposes owned resources.
editor.dispose();
source.dispose();
```

`StagecraftEditor` still expects a legacy deck; do not pass it a canonical document. Conversion through `pptxAdapter` or `odpAdapter` uses `@stagecraft/io` and does not retain original package parts. See [Canonical documents and native sources](docs/CANONICAL-DOCUMENTS.md) for command contracts, migration, I/O and source-session lifecycles.

Compose a canonical editing workspace with the same editor/source pair:

```jsx
import { EditorProvider } from '@stagecraft/react/editor';
import { PresentationEditor } from '@stagecraft/react/presentation';

<EditorProvider editor={editor}>
  <PresentationEditor source={source}
    showToolbar showSlideList showAttributePanel showNotesPanel={false}
    showDeckList decks={decks} activeDeckId={activeDeckId} onDeckSelect={openDeck}
    onExport={(result, context) => saveBytes(result.bytes, context)} />
</EditorProvider>
```

`DeckList` works independently. `PresentationToolbar`, `SlideList`, `PresentationCanvas`, `AttributePanel`, and `NotesPanel` can be composed under `PresentationEditorProvider`. Developers control region mounting with the `show*` props and extend toolbar, inspector, and object previews through UI plugins. The host owns editor/source disposal and loading/saving. See the [component specification](docs/COMPONENT-SPEC.md) for props, hooks, callbacks, lifecycle and limits, and [extension guide](docs/EXTENSIONS.md) for plugins. Advanced paragraph, text-body layout and cross-run selection controls are deferred; their headless commands remain available.

Run `npm run dev` and open `/?mode=source` for the local PPTX/ODP reference workspace. This demo hosts the reusable components without uploading source files.

Unchanged source export returns exact input bytes; supported edits preserve untouched entry bytes, not the entire edited ZIP. Source sessions grant access to the whole original package and are unsuitable for redacted clients. Native rendering and font inheritance are incomplete; font-family authoring covers Latin/Western fonts, not full East Asian or complex-script typography. Full PowerPoint/Impress compatibility is not claimed.

Browser defaults use native XML DOM APIs; Node hosts inject the required XML runtime. A Node parser must be namespace-aware and must reject malformed XML by throwing or producing a `parsererror` node; namespace awareness alone is insufficient. The shared gate rejects declarations, doctypes, and parser-error documents, but is not an independent well-formedness validator. All parsed XML strings pass the shared `@stagecraft/io` safe-XML gate: DTD/entity declarations (including NUL-obfuscated forms), doctypes, and parser-error documents are rejected with fixed content-free errors. ZIP size/entry checks and abort signals do not enforce a strict hostile-input memory cap: untrusted server uploads require host process/worker resource limits. Hosts own loading, saving, access control and resource disposal. These source packages remain private and are not a stable published SDK.

Run `npm install` at the repository root. `npm run dev`, `npm run build` and `npm run preview` target the playground. The development HTTP/MCP routes are not present in the static production preview.

Validation:

- `npm run coverage`: existing unit and Chromium suites, retaining the 90% gates.
- `npm run test:types`: strict headless and React consumer declaration checks.
- `npm run build`: package dependency/boundary checks and playground build.
- `npm run test:consumer`: separate Vite entry importing public packages without playground configuration.
- `npm run check:boundaries`: dependency direction, declared imports and workspace export resolution.

Install test browsers with `npx playwright install chromium`. `CHROMIUM_PATH` may select an existing compatible executable. OfficeView vendor sources remain unmodified; use `npm run sync:officeview` to refresh the pinned dependency.
