# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Branching & PR workflow (required)

**Never commit to `master` directly.** All work happens on a feature branch and lands via a reviewed PR.

1. **Branch** — before touching code, create a feature branch off `master` (e.g. `feat/...`, `fix/...`).
2. **Implement** — do the work on that branch following the Testing & TDD policy below.
3. **Simplify** — run `/simplify` on the diff and apply the cleanups.
4. **Review** — run `/code-review` on the diff and address its findings.
5. **PR** — open a PR for review (do not merge yet).
6. **Address bot review** — wait for automated/bot review comments on the PR, then fix every issue raised in those comments.
7. **Merge** — only after simplify → review → bot-comment fixes are all resolved and the suite is green.

## Commands

```bash
npm install        # install deps
npm run dev        # Vite dev server + the /api/* backend (same process) — default port 5173
npm run build      # production build to dist/ (a >500kB chunk warning from pptxgenjs is expected, non-blocking)
npm run preview    # serve the production build

npm test           # run the test suite once (Vitest)
npm run test:watch # TDD watch mode
npm run coverage   # run with coverage; fails under the 90% threshold
```

Run a single test file or case:
```bash
npx vitest run src/lib/pptxExport.test.js          # one file
npx vitest run -t "adds a slide to the last section" # by test name (substring)
```

`npm run build` (tsc-free Vite build) is a secondary structural check — if it transforms all modules cleanly the change is sound — but **tests are the primary gate** (see Testing & TDD policy).

> Test harness: **Vitest + `@vitest/coverage-v8`**, with `jsdom` + `@testing-library/react` (config in `vitest.config.js`, globals + jest-dom matchers in `src/test/setup.js`). The 90% coverage gate is enforced against `coverage.include` — currently the unit-tested core (`src/server/api.js`, `src/lib/deckOrder.js`, `src/lib/llmClient.js`, `src/data/deck.js`). **When you add tests for more of the app, widen that `include` list** so the new code comes under the gate.

## Testing & TDD policy (required)

All behavioral changes follow strict **TDD: red → green → refactor**.
1. **Red** — write a failing test that specifies the desired behavior, and watch it fail for the right reason.
2. **Green** — write the minimum code to make it pass.
3. **Refactor** — clean up production and test code while the suite stays green.

Coverage gate: **> 90%** (lines and branches), enforced via `npm run coverage`. Do not lower the threshold to pass; add the missing tests. New modules ship with their tests in the same change.

Conventions:
- Co-locate tests as `*.test.js(x)` beside the source (e.g. `lib/pptxExport.test.js`), or under `src/**/__tests__/`.
- Pure logic (`lib/`, `data/`, reducers/mutations in `Editor.jsx`, `flattenDeck`) is unit-tested directly. React surfaces use `@testing-library/react` (render + user-event), asserting behavior, not implementation.
- For the `/api/*` middleware, test the handler logic against the in-memory `deckState` (extract/import the handler rather than booting Vite).
- Mock network at the `fetch` boundary — never hit real provider APIs (`/api/llm`) or `pptxgenjs` file output in tests.

The Playwright tour script `node shots/shoot.mjs` captures screenshots of every view against a running dev server; it requires a Chromium binary available to Playwright and the dev server already running.

## Big-picture architecture

This is a Vite + React 18 SPA **with no separate backend** — read these together to understand the system.

### The "server" is a Vite plugin
`vite.config.js` contains `mcpMiddlewarePlugin`, a `configureServer` middleware that handles all `/api/*` routes and holds the deck in a single in-memory `deckState` object. There is no Express/Node server. This middleware provides:
- REST: `GET/PUT /api/deck`, `GET/POST /api/slides`, `PUT/DELETE /api/slides/:id`
- MCP: `GET /api/mcp` (manifest), `POST /api/mcp/tools/call` (tools: `get_deck`, `add_slide`, `update_slide`, `delete_slide`, `reorder_slides`, `set_theme`)
- LLM proxy: `POST /api/llm` forwards to Anthropic (`/v1/messages`) or an OpenAI-compatible (`/chat/completions`) endpoint so API keys stay out of page JS.

Because this lives in the dev middleware, the API **only exists under `npm run dev`** (not in a static `build`/`preview`).

### Deck data model (`src/data/deck.js`)
A deck is a **flat `slides` pool plus `sections[].slides` arrays that define order**. `flattenDeck()` (in `SlideEditor.jsx`) resolves the render order; a slide not referenced by a section is never shown. Slides are a **discriminated union keyed by `layout`** (12 layouts: cover, agenda, divider, kpi, chart, split, table, text, list, roadmap, risks, thanks). The schema for each layout is implicit in two places that must stay in sync — see "Adding a slide layout".

### Slide rendering is resolution-fixed and scaled
Every slide is authored in a **1920×1080 coordinate space** (absolute px, no viewport units). `<ScaledSlide>` (`ui/Primitives.jsx`) measures its container with a ResizeObserver and applies a `transform: scale()`. The same `<Slide>` component (`slides/SlideRenderer.jsx`, one big `switch (slide.layout)`) is reused in the canvas, left-rail thumbnails, sorter cards, and presenter — guaranteeing pixel parity at every size.

### State ownership
- **`App.jsx`** owns view routing (`home`/`editor`/`sorter`/`settings` + presenter overlay) and the four theming axes (`tw`), persisted to `localStorage['stagecraft.tw']` and `['stagecraft.view']`.
- **`Editor.jsx`** owns the working deck (a deep clone of `SAMPLE_DECK`) and **all mutations** (`addComponent`, `addText`, `addTable`, `addChart`, `changeLayout`, `changeTheme`, `deleteSlide`). It passes these to `SlideEditor.jsx` as `callbacks`.
- **`SlideEditor.jsx`** is the large, mostly-presentational editor (toolbar, thumbs, canvas, inspector, popover menus, Co-pilot drawer). It receives a `renderSlide` function and `callbacks`; it does not own deck data.

### Theming: two independent accent systems
- **App theme** (editor UI) — `tw` axes applied in `App.jsx` via `data-theme`/`data-density` attributes on `<html>` plus `--accent*` custom properties. `styles/main.css` (~2k lines) is the entire design system; tokens are documented in `design.md`.
- **Deck theme** (`deck.theme`) — tints slide *content* and PPTX output; changed via the toolbar Theme menu, unrelated to the app accent.

### AI Co-pilot
`lib/llmClient.js` reads `localStorage['stagecraft.ai']` and routes everything through `POST /api/llm`. Exports `callLLM`, `generateSlide`, `rewriteText`, `suggestImprovements`. Settings UI is in `SettingsView.jsx`.

### PPTX export
`lib/pptxExport.js` builds a `pptxgenjs` deck entirely client-side, with one builder per layout and a hex theme palette keyed by `deck.theme`. Charts are exported as placeholder text (SVG charts aren't rasterized).

## Conventions & gotchas

- **ES modules with named exports only.** (The original prototype in `../repo/project` used `window.*` globals and `/* global */` comments — this project deliberately does not. Don't reintroduce that pattern.)
- **The editor↔server sync is a two-way round-trip** via `src/hooks/useDeckSync.js` (used in `App.jsx`). The store carries a monotonic `rev`; the hook pushes local edits (`PUT /api/deck`, debounced ~300 ms so per-keystroke editing coalesces; the initial seed is immediate) and polls `GET /api/deck/state` (~1.5 s), adopting the server deck whenever `rev` advances past the one it last wrote. So MCP/agent edits **do** render live now. Caveat: `deckState` is still **in-memory**, so a browser reload reseeds from `SAMPLE_DECK` (durable persistence is the next roadmap item). Conflict policy is last-write-wins (no CRDT/OT merge).
- **The canvas is a real editing surface now** — inline text editing + a floating format toolbar, direct element manipulation (select / move / resize / rotate / marquee / copy-paste / align / distribute / z-order), shape drawing, and a wired right-click menu all work. The surfaces still mocked/planned are narrower: the **Design** token rows (the layout grid is wired now), the **Animate** panel, the **Timeline** drawer, the **Pen** tool, and a few **Misc** toolbar buttons (version history). Before assuming something is broken, check `SPEC.md`, which tags every feature 🟢 wired / 🟡 partial / 🔴 mocked / ⚪ planned.

## Adding a slide layout

A new `layout` must be wired in up to four places:
1. `slides/SlideRenderer.jsx` — a new `case` in the `Slide` switch (and define its slide schema in `data/deck.js`).
2. `editor/SlideEditor.jsx` — `LAYOUT_OPTIONS` / `LAYOUT_LABELS` so it appears in the Layout menu.
3. `editor/Editor.jsx` — a creator branch in `addComponent` if it should be insertable from the toolbar.
4. `lib/pptxExport.js` — a per-layout builder, or it won't export.

## Reference docs

- `SPEC.md` — full feature spec with per-feature implementation status.
- `PRODUCT-SPEC.md` — product vision, personas, information architecture, user journeys, and screen-by-screen UX behavior.
- `design.md` — design tokens (typography, color, spacing, shadows, layouts, MCP API).
