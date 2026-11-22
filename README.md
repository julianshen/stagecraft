# Stagecraft library workspaces

Stagecraft's existing slide editor is split into private source packages and a Vite playground. This extraction preserves the legacy deck schema and existing PPTX behavior; it does not introduce the later canonical editor, ODP, protected-server or agent APIs.

| Workspace | Ownership |
| --- | --- |
| `@stagecraft/core` | Legacy deck data, validation and shared document helpers |
| `@stagecraft/renderer` | Canvas scene/painter, assets and pinned OfficeView drawing code |
| `@stagecraft/react` | React editor, reusable surfaces, styles and editor hooks |
| `@stagecraft/pptx` | Existing PPTX import/export and OOXML helpers |
| `@stagecraft/playground` | Application screens, persistence, HTTP/MCP middleware and optional AI integration |

Packages cannot import playground code. The editor receives optional AI UI through `renderAIDrawer`; network credentials and application services remain with the host.

```jsx
import { StagecraftEditor } from '@stagecraft/react';
import { SAMPLE_DECK } from '@stagecraft/core';
import '@stagecraft/react/styles.css';

<StagecraftEditor defaultDeck={SAMPLE_DECK} style={{ height: 720 }} />
```

Use `deck` plus `onDeckChange` for controlled state. `defaultDeck` creates an internal undoable deck. The wrapper scopes theme/accent/density tokens and keyboard handling to its focused editor by default. Optional presentation/export callbacks and AI drawer rendering are host-owned. Existing localStorage-backed settings are still shared; this is not complete multi-editor state isolation. The source packages are private and require a JSX/TypeScript-capable bundler; they are not published distribution bundles or a stable SDK.

Run `npm install` at the repository root. `npm run dev`, `npm run build` and `npm run preview` target the playground. The development HTTP/MCP routes are not present in the static production preview.

Validation:

- `npm run coverage`: existing unit and Chromium suites, retaining the 90% gates.
- `npm run build`: package dependency/boundary checks and playground build.
- `npm run test:consumer`: separate Vite entry importing public packages without playground configuration.
- `npm run check:boundaries`: dependency direction, declared imports and workspace export resolution.

Install test browsers with `npx playwright install chromium`. `CHROMIUM_PATH` may select an existing compatible executable. OfficeView vendor sources remain unmodified; use `npm run sync:officeview` to refresh the pinned dependency.
