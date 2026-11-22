# Stagecraft library workspaces

Stagecraft provides private source packages and a Vite playground. The existing React editor uses the legacy deck schema. A separate headless foundation supplies canonical documents, plugin transactions, host-controlled I/O and native PPTX/ODP source sessions. Canonical React UI, protected-server and agent APIs are outside this milestone.

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

Native authoring commands are a source foundation for later UI. `StagecraftEditor` still expects a legacy deck; do not pass it a canonical document. Conversion through `pptxAdapter` or `odpAdapter` uses `@stagecraft/io` and does not retain original package parts. See [Canonical documents and native sources](docs/CANONICAL-DOCUMENTS.md) for command contracts, migration, I/O and source-session lifecycles.

Unchanged source export returns exact input bytes; supported edits preserve untouched entry bytes, not the entire edited ZIP. Source sessions grant access to the whole original package and are unsuitable for redacted clients. Native rendering and font inheritance are incomplete; font-family authoring covers Latin/Western fonts, not full East Asian or complex-script typography. Full PowerPoint/Impress compatibility is not claimed.

Browser defaults use native XML DOM APIs; Node hosts inject the required XML runtime. ZIP size/entry checks and abort signals do not enforce a strict hostile-input memory cap: untrusted server uploads require host process/worker resource limits. Hosts own loading, saving, access control and resource disposal. These source packages remain private and are not a stable published SDK.

Run `npm install` at the repository root. `npm run dev`, `npm run build` and `npm run preview` target the playground. The development HTTP/MCP routes are not present in the static production preview.

Validation:

- `npm run coverage`: existing unit and Chromium suites, retaining the 90% gates.
- `npm run build`: package dependency/boundary checks and playground build.
- `npm run test:consumer`: separate Vite entry importing public packages without playground configuration.
- `npm run check:boundaries`: dependency direction, declared imports and workspace export resolution.

Install test browsers with `npx playwright install chromium`. `CHROMIUM_PATH` may select an existing compatible executable. OfficeView vendor sources remain unmodified; use `npm run sync:officeview` to refresh the pinned dependency.
