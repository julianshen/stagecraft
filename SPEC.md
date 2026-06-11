# Stagecraft — Feature Design Specification

> A dense, keyboard-first presentation editor. Linear/Figma energy, original design.
> This document is the authoritative spec for every feature: intended design, data model,
> behavior, and current implementation status.

**Companion docs:** `design.md` (visual design tokens & system) · `README`/`package.json` (build).

---

## Status legend

Every feature below is tagged with its implementation status as of this spec:

| Tag | Meaning |
|---|---|
| 🟢 **Wired** | Implemented and functional end-to-end. |
| 🟡 **Partial** | Partly functional; some sub-behaviors are stubbed. |
| 🔴 **Mocked** | UI/visual only — no behavior behind it. |
| ⚪ **Planned** | Specified here, not yet built. |

---

## 1. Product overview

### 1.1 Goals
- A **professional, information-dense** deck editor that favors keyboard speed and tight visual rhythm over chrome.
- **Agent-controllable**: every deck operation is exposed over an HTTP/MCP API so external tools and LLM agents can drive the app.
- **Bring-your-own-model AI Co-pilot** for slide generation, rewriting, and speaker notes.
- **Real export** to PowerPoint (`.pptx`).
- **Token-driven theming**: light/dark, five accents, three densities, three editor layouts — all live.

### 1.2 Non-goals (current scope)
- Real-time multi-user collaboration backend (cursors/comments are presentation-only).
- A database / cloud sync backend (decks persist to a local JSON snapshot in the dev server, not a remote store).
- Full freeform vector editing (drawing engine).

### 1.3 Primary personas
- **Operator** — builds exec/business decks fast; lives on the keyboard.
- **Agent** — an LLM or script driving the deck via MCP.

---

## 2. Architecture

### 2.1 Stack
- **Build:** Vite 5 + `@vitejs/plugin-react`.
- **UI:** React 18 (function components + hooks), no router lib (manual view state), no CSS framework (hand-authored token CSS).
- **Export:** `pptxgenjs`.
- **Server:** a **Vite middleware plugin** (`mcpMiddlewarePlugin`) serving `/api/*` in dev. No separate process.

### 2.2 Runtime topology
```
Browser (React SPA)
  │  state: deck (in React), tweaks+ai (localStorage)
  │
  ├── PUT /api/deck            ← one-way sync of editor deck → server
  ├── POST /api/llm            ← Co-pilot / settings test (proxied to provider)
  └── (agents) → /api/mcp, /api/mcp/tools/call, /api/slides, /api/deck

Vite dev middleware (in-memory deckState)
  └── forwards LLM calls to Anthropic / OpenAI-compatible endpoints
```

### 2.3 Module map
```
index.html                      — fonts (Inter, JetBrains Mono, Fraunces), #root
vite.config.js                  — React plugin + MCP middleware (the "server")
src/
  main.jsx                      — ReactDOM root
  App.jsx                       — shell: topbar, nav, view routing, theming, modals, shortcuts
  styles/main.css               — full design system (~2.1k lines)
  data/deck.js                  — ACCENTS, SAMPLE_DECK, SPEAKER_NOTES, TEMPLATES
  components/
    ui/Icon.jsx                 — SVG icon set (~90 paths)
    ui/Primitives.jsx           — Avatar, Button, IconButton, FieldRow, InputGroup, Seg,
                                  ScaledSlide, Menu
    slides/SlideRenderer.jsx    — Slide (12 layouts), SlideChrome, charts, roadmap graphic
    editor/Editor.jsx           — stateful deck wrapper; mutations; server sync
    editor/SlideEditor.jsx      — toolbar, thumbs, canvas, inspector, menus, AI drawer
    views/HomeView.jsx          — file browser / dashboard
    views/SorterView.jsx        — grid + outline slide sorter
    views/PresenterView.jsx     — presenter mode
    views/SettingsView.jsx      — General, Appearance, AI, Export, Shortcuts
    modals/ExportModal.jsx      — export format chooser → PPTX
    modals/TemplatePicker.jsx   — template gallery
    TweaksPanel.jsx             — postMessage-activated quick theming
  lib/
    llmClient.js                — callLLM, generateSlide, rewriteText, suggestImprovements
    pptxExport.js               — deck → .pptx
```

---

## 3. Data model

### 3.1 Deck
```ts
type Deck = {
  id: string;
  title: string;
  subtitle?: string;
  author?: string;
  theme: ThemeId;                 // 'indigo' | 'emerald' | 'amber' | 'coral' | 'magenta' | 'slate'
  sections: Section[];
  slides: Slide[];                // flat pool; order is defined by sections[].slides
};

type Section = { id: string; name: string; slides: string[] /* slide ids, in order */ };
```
The **render order** is the concatenation of `sections[].slides`, resolved against the `slides` pool (`flattenDeck`). A slide not referenced by any section is not shown.

### 3.2 Slide (discriminated by `layout`)
Common optional fields: `id` (required), `eyebrow?` (small label above the title).

| `layout` | Shape |
|---|---|
| `cover` | `{ title, subtitle?, eyebrow?, kicker?, bg?: 'ink'\|'accent' }` |
| `agenda` | `{ title, eyebrow?, items: { n, t, d }[] }` |
| `divider` | `{ chapter, title, bg?: 'ink'\|'accent' }` |
| `kpi` | `{ title, note?, eyebrow?, kpis: { label, val, delta, target, good: boolean\|null }[] }` |
| `chart` | `{ title, sub?, eyebrow?, chartType: 'line'\|'bar'\|'area'\|'donut' }` |
| `split` | `{ title, body, eyebrow?, stats: { lbl, val }[] }` |
| `table` | `{ title, eyebrow?, columns: string[], rows: string[][] }` |
| `text` | `{ title, body, eyebrow? }` |
| `list` | `{ title, eyebrow?, items: string[] }` |
| `roadmap` | `{ title, eyebrow?, months?: string[], lanes?: { name, items: { t, d, lbl, state: 'done'\|'inflight'\|'atrisk'\|'planned' }[] }[], todayIndex?: number }` — normalized by `roadmapModel` (`lib/roadmapSpec.js`); falls back to the built-in demo when omitted |
| `risks` | `{ title, eyebrow?, items: { sev: 'high'\|'med'\|'low', t, d }[] }` |
| `thanks` | `{ title, subtitle? }` |

### 3.3 Supporting data
- **`ACCENTS`** — `{ id: { name, hue, chroma } }` for the 5 palettes.
- The Home dashboard now lists the **real deck library** (`GET /api/decks` → metadata records), not a static array — see §7.1/§17. (The former `DECKS` mock was removed.)
- **`SPEAKER_NOTES`** — `{ [slideId]: string }`, surfaced in Presenter.
- **`TEMPLATES`** — `{ id, name, cat, vibe }` for the gallery.

### 3.4 Canvas elements & selection (editor-local)
```ts
type Element = {
  id: string;
  type: 'text' | 'rect' | 'rounded' | 'ellipse' | 'circle'
      | 'triangle' | 'diamond' | 'pentagon' | 'hexagon' | 'star' | 'line' | 'arrow';
  x, y, w, h: number;   // 1920×1080 coordinate space
  content?: string;     // text elements
};
```
Elements live on `slide.elements?: Element[]` and render in `ElementsLayer` over the layout template. The editor tracks a single **selected element id** (`Editor.selElId`); geometry helpers are in `lib/elements.js`. See §9. (Rotate/opacity/multi-select are ⚪ follow-ups.)

---

## 4. Application shell — `App.jsx` 🟢

### 4.1 Layout
Fixed-height flex column: **topbar** (40px) + active **view**.

Topbar: logo · tab nav (Files / Editor / Sorter) · contextual center (deck name + "Saved" 🔴 static, or Home search 🔴, or "Settings") · Settings toggle.

### 4.2 View routing
`view ∈ {home, editor, sorter, settings}`, persisted to `localStorage['stagecraft.view']` (default `editor`). Presenter is a separate full-screen overlay (`presenting` boolean).

### 4.3 Theming application 🟢
On `tw` change, sets `data-theme`, `data-density` on `<html>` and writes `--accent`, `--accent-2`, `--accent-wash` custom properties from the chosen `ACCENTS` entry.

### 4.4 Keyboard 🟡
- `⌘/Ctrl+Enter` → enter Presenter.
- `Esc` → close modal / exit Presenter.
- (Other shortcuts shown in Settings are ⚪ not bound.)

---

## 5. Theming system 🟢

Four independent axes, all persisted to `localStorage['stagecraft.tw']`:

| Axis | Values | Mechanism |
|---|---|---|
| **Theme** | light, dark | `data-theme` attribute → token swap |
| **Accent** | indigo, amber, emerald, magenta, coral | `--accent*` custom props |
| **Density** | compact, default, cozy | `data-density` → chrome metrics |
| **Editor layout** | default (3-col), left-only (2-col), floating | `body` class on editor |

Deck **theme** (slide accent) is separate from app accent; see §3.1 / §10.

Full token tables live in `design.md`. Two entry points: **Settings → Appearance** (§7.4) and the **Tweaks panel** (§16).

---

## 6. Slide rendering — `SlideRenderer.jsx`

### 6.1 ScaledSlide 🟢
Slides are authored in a **1920×1080** coordinate system and scaled to fit any container via a `ResizeObserver` + CSS `transform: scale()`. Used identically in the canvas, thumbnails, sorter, and presenter, guaranteeing visual parity at every size. Never use viewport units inside slide content.

### 6.2 `<Slide>` 🟢
Pure function of `{ slide, deck, sectionName, num, total }`, switching on `slide.layout`. **SlideChrome** draws the shared footer/eyebrow/page-number furniture. The `eyebrow` field overrides the per-layout default label.

### 6.3 The 12 layouts 🟢
Each is a fixed visual composition driven by the slide schema (§3.2):
- **cover** — full-bleed dark/accent, deck title large, geometric accent circles. Driven by `deck.title`, `slide.title/subtitle/eyebrow/kicker`.
- **agenda** — 2-col numbered list.
- **divider** — giant chapter numeral + title; section break.
- **kpi** — 3×N metric cards with value, delta chip (green/red/neutral via `good`), and target.
- **chart** — titled chart card; renders by `chartType` (§7).
- **split** — text column + right-hand stat stack (green/red by sign).
- **table** — header row + data grid; 6-column decks get a tuned column-width template and a "health" pill in the last cell.
- **text** — title + body paragraph (eyebrow = section name by default).
- **list** — title + bulleted points.
- **roadmap** — swimlane Gantt graphic. 🟢 data-driven via `roadmapModel` (`lib/roadmapSpec.js`), shared by the canvas and the PPTX export; a slide may supply `months`/`lanes`/`todayIndex`, and falls back to the built-in demo when omitted. ⚪ No in-app authoring path yet — the schema is set via MCP/agent or hand-authored JSON; the inspector can't edit lanes (same staged rollout the chart layout had).
- **risks** — severity-coded rows (high/med/low). 🟢 Severity colours are single-sourced in `lib/riskSpec.js` (`SEVERITY_OKLCH` for the canvas, `SEVERITY_HEX` — exact sRGB — for the export), so the on-screen accents and the exported bullets match; unknown severities fall back to grey on both.
- **thanks** — closing slide.

### 6.4 Charts (SVG) 🟢 render / 🟡 data
`ChartByType` → `LineChart` (with plan overlay), `BarChart`, `AreaChart`, `DonutChart`. All accent-aware, hand-drawn SVG. 🟡 Series data is currently fixed inside each chart component (not yet read from slide fields).

---

## 7. Views

### 7.1 Home / Files — `HomeView.jsx` 🟢
Backed by the real **deck library** (`GET /api/decks`, see §11.6/§17), not a mock list.
- **Deck grid** 🟢 — lists the persisted decks; a card opens the deck (activates it server-side and adopts its content); the active deck shows a **LIVE** badge; cover tint/initials and the "edited" time derive from each deck's metadata (`lib/decksApi.js` view-model helpers). Empty state when the library has no decks.
- **Per-card actions** 🟢 — a ⋯ menu offers **Rename** (inline edit; sets the deck title as the single source of its name) and **Delete**.
- **"New" cards** 🟢 — Blank creates + opens a fresh deck (`POST /api/decks`); "From template" opens the picker.
- **Deck list view** 🟡 toggle — rows open the deck; per-row rename/delete not yet wired (grid only).
- 🔴 Search input, Filter/Edited sort buttons, greeting name, and the Recent/Starred/Trash sidebar filters are still static.

### 7.2 Editor — `Editor.jsx` + `SlideEditor.jsx`
The core surface. Composed of toolbar, left thumbs, canvas, right inspector.

#### 7.2.1 Editor wrapper (`Editor.jsx`) 🟢
Owns a deep-cloned working `deck` and the current slide id. Exposes mutation callbacks and **syncs `deck → PUT /api/deck`** on every change.

Mutations: `addComponent(id)`, `addText(style)`, `addTable(rows,cols)`, `addChart(type)`, `changeLayout(layout)`, `changeTheme(theme)`, `deleteSlide(id)`, `onNewSlide`, `duplicateSlide(id)`. 🟢 **Duplicate slide** deep-clones the current slide with fresh slide + element ids, inserts the copy right after it in its section (`duplicateSlide` in `lib/deckOrder.js`), and selects it.

#### 7.2.2 Toolbar (`SlideEditor.jsx`)
| Group | Control | Status |
|---|---|---|
| Tools | Select / Pen / Image, 10 Shapes | 🔴 set active tool only — no canvas drawing |
| Insert | Component menu, Text menu, Table size-picker, Chart-type picker | 🟢 add real slides |
| Slide | Layout menu, Theme menu | 🟢 mutate current slide / deck |
| Arrange | align (L/C/R + T/M/B), distribute | 🟢 horizontal + vertical align act on a 2+ selection; 🟢 distribute evens the gaps of a 3+ selection (axis auto-picked from the bbox) |
| Misc | auto-arrange (✨), timeline toggle, version history | 🟡 timeline toggles drawer; others 🔴 |
| Right | Co-pilot, Export, Present | 🟢 |

Menus (`ShapeMenu`, `ComponentMenu`, `TextMenu`, `TableSizePicker`, `ChartTypePicker`, `LayoutMenu`, `ThemeMenu`) are dismiss-on-outside-click popovers. The table picker supports drag/click sizing up to 8×8.

#### 7.2.3 Left thumbnails pane (`ThumbsPane`) 🟡
Section-grouped live thumbnails (real `<Slide>` via `ScaledSlide`), active-state, click-to-select, per-slide comment badge, **＋ New slide** wired. 🟢 **drag-to-reorder** — thumbs are draggable; dropping a thumb inserts the dragged slide just before it (within or across sections), updating `sections[].slides` via the pure `moveSlide` helper (`lib/deckOrder.js`). 🔴 outline toggle, "more", section-collapse chevrons, "New section" have no handlers.

#### 7.2.4 Canvas (`CanvasSlide`, `Ruler`, `StatusBar`) 🟡
- 🟢 Renders the current slide at zoom; H/V rulers; status bar with zoom controls (20–200%, fit), live dimensions readout.
- 🟢 Direct manipulation of `slide.elements` (§9): click to select, **shift-click to multi-select** (additive toggle), **marquee** (drag empty canvas to rubber-band-select overlapping elements; click empty space to deselect), drag to move (a drag on any member moves the whole selection), 8-handle resize and a **rotate handle** when exactly one element is selected. A drag commits one atomic deck update on pointer-up (no per-frame PUT). Delete/Backspace removes the whole selection; **align (left/center/right + top/middle/bottom)** acts on a 2+ selection and **distribute** evens the gaps of a 3+ selection — the Arrange buttons are disabled until enough elements are selected. ⚪ Shift-add-to-marquee is not yet wired.
- 🟢 Right-click context menu (paste / generate / change layout / apply theme / duplicate / delete) — 🟡 only duplicate & delete are wired.

#### 7.2.5 Right inspector (`InspectorPane` / `FloatingInspector`) 🟡
Tabs: **Design / Properties / Animate**.
- **Design panel** 🔴 — layout grid, theme swatches, token rows, component rail are all display-only.
- **Properties panel** 🟡 — `X/Y/W/H` edit the selection box live; angle, opacity, font family/style/size, align, fill are 🔴 static.
- **Animate panel** 🔴 — transition/builds are fake.

#### 7.2.6 Timeline drawer 🔴
Visual keyframe timeline with playhead/tracks; decorative only.

### 7.3 Sorter — `SorterView.jsx` 🟢
- 🟢 Grid mode: section-grouped slide cards (live thumbnails); click-to-select, double-click opens the slide in the editor. Outline mode toggle 🟢.
- 🟢 **Drag-to-reorder** — grid cards are draggable; dropping a card inserts the dragged slide just before it (within or across sections) via the pure `moveSlide` helper (`lib/deckOrder.js`), shared with the editor's thumbnail rail through the `useReorderDrag` hook. Each section is also a drop target (`sectionDropProps`), so a card dropped on a section's empty area appends to it — letting a freshly-created empty section be populated by drag (card drops `stopPropagation` so a precise insert wins over the append fallback).
- 🟢 **Section CRUD** — toolbar **New section** appends an empty section (`addSection`); each section header has inline **Rename** (`renameSection` — blank or unchanged names are rejected and return the same deck ref, so a no-op rename never triggers a sync write) and **Delete** (`deleteSection`). Deleting merges the section's slides into a neighbour (previous, or next if it was first) so none are lost and `flattenDeck` order is preserved; a deck always keeps ≥1 section, and the Delete button is **disabled on the last remaining section** so the invariant is visible rather than a dead click. All commit through `App`'s `setDeck` (so the sync hook propagates them), and the whole editing surface is hidden when `SorterView` is rendered without `onDeckChange` (read-only).
- 🟢 **Rearrange with AI** — the toolbar button sends a compact deck outline (id + title + layout + section) to the Co-pilot (`suggestSlideOrder` in `lib/llmClient.js`) and applies the returned id order via the pure `applySlideOrder` (`lib/deckOrder.js`), which re-chunks the new sequence back into the sections by their current sizes (so a slide's section follows from its new position — the prompt tells the model this) and tolerates the model dropping/duplicating/omitting ids (no slide is ever lost). The button shows a **Rearranging…** busy state and is hidden in read-only mode. 🟢 **Classified failures** — the proxy answers errors with real statuses and a machine-readable `reason` (§11.4); `callLLM` throws a typed `LLMError` and the toolbar shows the matching copy via `describeLLMError` (no key configured / key rejected / rate-limited / provider detail / dev server unreachable), cleared on the next attempt. A `null` order now genuinely means "the model answered but the order was unusable" and says so; a genuine "already optimal" result stays silent. While the request is in flight the Sorter stays editable, and a stale order is dropped if the deck's section structure changed under it (a section-aware signature snapshot).
- 🔴 filter/sort — no handlers. ⚪ Spec: Outline-mode reorder/CRUD (grid is the editing surface for now — when Outline becomes editable, lift the rename-draft + drag state from `SorterGrid` up to `SorterView`); MCP/server section-CRUD tools (`api.js` has no `add_section`/`delete_section`, and `reorder_slides` collapses sections — section CRUD is client-only today, so the helper and server section models can drift).

### 7.4 Settings — `SettingsView.jsx`
Left nav: General / Appearance / AI & Co-pilot / Export defaults / Shortcuts.

| Section | Status |
|---|---|
| **AI & Co-pilot** | 🟢 provider cards (6), API key (show/hide, persisted), "Test connection" (routes through `callLLM`, shows the classified failure reason via `describeLLMError`, offered on the keyless Base-URL row too), **Base URL persisted** (`settings.baseUrl`, forwarded by `callLLM` to the proxy's keyless carve-out), model picker, **Temperature** + **Max tokens** persisted, per-task **routing** select. 🟡 **Top-p** is local-only (not persisted). |
| **Appearance** | 🟢 theme / accent / density / editor-layout — all bound to `tw`/`setTw`, live + persisted. |
| **General** | 🔴 autosave and similar toggles are `onChange = () => {}`. |
| **Export defaults** | 🔴 aspect ratio, default quality toggles are no-ops. |
| **Shortcuts** | 🔴 reference list, display-only. |

Persistence: `localStorage['stagecraft.ai']`. Reset-to-defaults 🟢.

### 7.5 Presenter — `PresenterView.jsx` 🟡
- 🟢 Current + next slide (scaled), section label, speaker notes from `SPEAKER_NOTES`, elapsed clock vs. 40:00 target, progress dots, prev/next, keyboard (`← → space Esc`).
- 🟡 Laser = a fixed dot toggle. 🔴 Blackout has no handler. ⚪ Spec: laser should track the pointer; blackout should overlay.

---

## 8. AI & Co-pilot

### 8.1 LLM client — `lib/llmClient.js` 🟢
Reads `localStorage['stagecraft.ai']`. All calls route through **`POST /api/llm`** so keys never live in page JS. Normalizes Anthropic (`content[].text`) and OpenAI (`choices[].message.content`) response shapes.

Exports:
- `callLLM(messages, options)` — core.
- `generateSlide(prompt, context)` — asks for a single JSON slide object; strips code fences; falls back to a text slide on parse failure.
- `rewriteText(text, instruction)` — returns rewritten copy.
- `suggestImprovements(slide)` — returns 2–3 suggestions.

### 8.2 Co-pilot drawer (`DefaultAIDrawer`) 🟢
In-editor panel: suggestion chips + freeform prompt + Send. **The reply now edits the current slide.** A send (chip or freeform) calls `editSlide(slide, instruction)` (`lib/llmClient.js`), which returns a partial-slide **patch** (JSON, id stripped); the drawer applies it through the `onApplyAIPatch` editor callback → `applySlidePatch(deck, curId, patch)` (`lib/deckUtils.js`), and confirms which fields changed (or falls back gracefully when the model returns no usable JSON). "Generate speaker notes" yields a `{ notes }` patch; the Presenter prefers `slide.notes` over the bundled `SPEAKER_NOTES`.

### 8.3 Provider matrix 🟢 (config) / availability per key
Anthropic · OpenAI · Google · OpenRouter · Local (Ollama/LM Studio, no key) · Custom (OpenAI/Anthropic-compatible, `baseUrl`). The middleware currently implements Anthropic and OpenAI-compatible paths (§11.4); Google/OpenRouter/Local resolve through the OpenAI-compatible path or `baseUrl`.

---

## 9. Selection & direct manipulation 🟡 → ⚪

**Now 🟢 (core):** a per-slide **element overlay model** — `slide.elements[]` of `{id, type, x, y, w, h, content?}` in 1920×1080 space, rendered everywhere the slide renders (`ElementsLayer` in `SlideRenderer`, on top of the layout template). Pure geometry lives in `lib/elements.js` (`snap`/`createElement`/`moveElement`/`resizeElement`/`updateSlideElements`, gated + unit-tested): click-to-select, drag-move, 8-handle resize, all snapped to the 8px grid and clamped to the slide. The Text/Shape toolbar tools create elements; the Properties panel binds x/y/w/h to the real selected element; Delete removes it. State + mutations are owned by `Editor` (`selElId`, `addElement`/`updateElement`/`deleteElement`).

**Also 🟢:** the Properties panel binds **angle (`rot`), opacity, and fill** to the selected element, and a **Content** field edits text elements; `ElementView` renders rotation/opacity/fill. (Element schema gains optional `rot`, `opacity`, `fill`.)

**Still ⚪ (follow-ups):**
- Per-element typography (font family/size/weight/align for text).
- Rotate the selection overlay (resize handles + rotate knob) to track a rotated element, which also needs rotate-aware resize math (the overlay is currently axis-aligned).
- Selection set: shift-click multi-select ✅, marquee drag-rectangle ✅, align (horizontal + vertical) ✅, distribute ✅, and a rotate handle ✅ all shipped; ⚪ shift-add-to-marquee remains.
- Snapping to alignment guides (currently grid-only); Pen/Image tools.
- Persisting/AI-authoring elements (the `elements` field isn't in the AI-patch whitelist yet).

---

## 10. Deck theme vs. app accent

- **App accent** (§5) tints the *editor UI*.
- **Deck theme** (`deck.theme`) tints *slide content* and is changed by the toolbar **Theme menu** 🟢 and Settings is unrelated. Themes: indigo, emerald, amber, coral, magenta, slate (PPTX uses matching hex in §12).

---

## 11. MCP HTTP API — `vite.config.js` 🟢

In-memory `deckState` (one deck). CORS `*`. JSON bodies.

### 11.1 Health & manifest
- `GET /api/health` → `{ ok, version }`.
- `GET /api/mcp` → capabilities manifest: name, description, and **tools** (`get_deck`, `add_slide`, `update_slide`, `delete_slide`, `reorder_slides`, `set_theme`) with JSON input schemas.

### 11.2 Deck & slides (REST)
| Method | Path | Behavior |
|---|---|---|
| GET | `/api/deck` | current deck (or `{}`) |
| PUT | `/api/deck` | replace deck (editor sync target) |
| GET | `/api/slides` | `deck.slides` |
| POST | `/api/slides` | append slide (`text`/"New slide" defaults), add id to last section |
| PUT | `/api/slides/:id` | shallow-merge updates |
| DELETE | `/api/slides/:id` | remove from pool + sections |

### 11.3 Tool calls
`POST /api/mcp/tools/call` with `{ name, arguments }`. Dispatches the six tools against `deckState`. `add_slide` mints `slide-<ts>` and appends to the last section; `reorder_slides` reorders the pool by id list; `set_theme` sets `deck.theme`. Errors: `400` when no deck loaded / unknown tool, `404` not found.

### 11.4 LLM proxy
`POST /api/llm` with `{ messages, provider, model, apiKey, baseUrl, apiFormat, temperature, maxTokens }`.
- `anthropic` → `POST https://api.anthropic.com/v1/messages` (`x-api-key`, `anthropic-version: 2023-06-01`).
- otherwise → `POST {baseUrl||https://api.openai.com/v1}/chat/completions` (`Authorization: Bearer`).
Returns `{ text }`. Errors return `{ error, reason? }` with a real status: **401 `unconfigured`** when no key is set and the endpoint needs one (Anthropic, or OpenAI-compatible without a custom `baseUrl`) — caught before any provider call; provider **4xx pass through** classified (`auth` for 401/403, `rate-limit` for 429, else `provider`); everything else upstream (5xx, network throw, 2xx-with-error-body) is **502**. `callLLM` maps these to a typed `LLMError({ reason })`, adds `network` for an unreachable proxy, and `describeLLMError` renders the user copy (taxonomy minted server-side, parity-locked by a test).

### 11.5 Export trigger
`POST /api/export/pptx` → acknowledges; real bytes are produced client-side (§12).

### 11.6 Round-trip sync 🟢 (🟡 persistence)
The store carries a monotonic **`rev`** counter, bumped on every mutation (deck PUT, slide REST writes, and all writing tools). `GET /api/deck/state` → `{ deck, rev, activeId }`; `PUT /api/deck` returns `{ rev, activeId }`. The app-level **`useDeckSync`** hook (`src/hooks/useDeckSync.js`) reconciles on mount (adopt a pre-existing server deck, else seed ours), pushes local edits, and polls `/api/deck/state` (~1.5 s) — adopting the server deck whenever `rev` advances past the one it last wrote, while suppressing the echo PUT. It also **tags each write with `?forId=<activeId>`** so a stale in-flight PUT is dropped (not applied to a deck the user just switched to), and exposes `adopt(deck, rev, id)` for the open path to adopt without echoing. **MCP/agent edits render live, and edits are durable** (§17). Last-write-wins; no operational-transform/CRDT merge.

---

## 12. PPTX export — `lib/pptxExport.js` 🟢

`exportToPPTX(deck)` builds a `pptxgenjs` deck and triggers a download. Per-layout builders map slide schema → PPTX text/shape/table objects, using a **hex theme palette** keyed by `deck.theme` (indigo/amber/emerald/magenta/coral).

| Layout | Mapping |
|---|---|
| cover / divider | dark or accent background, large title, chapter numeral |
| agenda | numbered rows (n / title / desc) |
| kpi | 3-col metric boxes (value, delta, label) |
| table | native PPTX table (header + rows) |
| split | two-column text + stats |
| text / list / thanks | title + body/bullets |
| risks | text representation 🟡 — severity bullet colours come from the shared `SEVERITY_HEX` (`lib/riskSpec.js`, the exact sRGB of the canvas `SEVERITY_OKLCH`), so the export matches the on-screen severity colours; unknown severities fall back to grey on both surfaces. |
| **roadmap** | 🟢 **native PPTX timeline** — month axis, status-coloured lane bars, optional TODAY marker, and a legend, built from the same `roadmapModel` (`lib/roadmapSpec.js`) the canvas uses, so they match. |
| **chart** | 🟢 **native PPTX chart** (`addChart`) — editable in PowerPoint. Both the canvas SVG renderers and the export read the slide's `chart: { categories, series }` through the shared **`chartData`** helper (`lib/chartSpec.js`), so they show the same numbers; `chartSpec` maps the type (bar→vertical columns, line, area, pie/donut→doughnut, default line) for pptxgenjs. Both fall back to matching demo data when a slide carries none. |

🟢 **Multi-series on the canvas** — `LineChart`/`BarChart`/`AreaChart` render every series (N lines / grouped bars / overlaid areas) on one shared axis (scaled to the max across all series), with a swatch legend naming each. A single series keeps the original look (area fill + value badge, no legend) so the demo is unchanged; a donut still composes a single series over its categories.

🟢 **Series-colour parity** — canvas and export draw each series the same colour: one ordered palette in `chartSpec.js` (`CHART_SERIES_OKLCH` for the SVG canvas, `CHART_SERIES_HEX` — the exact sRGB equivalents — for pptxgenjs). The export uses it directly (no theme-tint) so it mirrors the screen.

**Spec (⚪):** expand roadmap to a real table/shape timeline; honor export-modal range/quality/notes options.

---

## 13. Export modal — `ExportModal.jsx` 🟡
Format chooser: **PPTX 🟢**; Keynote / PDF / PNG seq / MP4 / Link 🔴 (close only). Range, quality, and "include speaker notes" controls are 🔴 decorative. Shows estimated size. ⚪ Spec: implement PDF (print/jsPDF), PNG sequence (canvas of each `ScaledSlide`), and pass range/notes into the exporter.

---

## 14. Templates — `TemplatePicker.jsx` 🟢
Category-filtered gallery with visual `TemplatePreview` per `vibe`. 🟢 filter; 🟢 **picking a template creates a real library deck** — `templateDeck(template)` (`lib/templateDeck.js`) builds a themed starter (`vibe`→theme via `vibeTheme`, a cover titled after the template + a starter content slide), which `App.handlePickTemplate` persists via `createDeck(name, deck)` (`POST /api/decks`) and opens in the editor. 🔴 search. ⚪ Per-template bespoke multi-slide skeletons (currently one shared cover+intro starter).

---

## 15. Tweaks panel — `TweaksPanel.jsx` 🟢
Hidden quick-theming panel toggled by `postMessage({type:'__activate_edit_mode'})` (host-embed integration). Mirrors Appearance controls (theme/accent/density/layout) and posts edits back to the parent frame. Exports `TWEAK_DEFAULTS`.

---

## 16. Collaboration 🔴 → ⚪
`CollabLayer` renders labeled cursors and thumbnails carry comment badges, but `collaborators`/`comments` are never populated and the Comments button is hidden (no `onComment`). ⚪ Spec: presence + comment threads over a realtime channel; comment anchors per slide/element.

---

## 17. Persistence model

| Data | Store | Status |
|---|---|---|
| Tweaks (theme/accent/density/layout) | `localStorage['stagecraft.tw']` | 🟢 |
| AI settings | `localStorage['stagecraft.ai']` | 🟢 (🟡 top-p excluded) |
| Active view | `localStorage['stagecraft.view']` | 🟢 |
| Deck content | React state + in-memory server | 🟢 |
| Deck library | JSON snapshot `.stagecraft-decks.json` (load on boot, debounced write on `rev`, flush on exit) | 🟢 durable |

🟢 The deck store is now a **multi-deck library** (decks keyed by id + an `activeId`) persisted to disk; the Home view lists/opens/creates/renames/deletes real decks. Edits survive reload and dev-server restart.

---

## 18. Implementation status matrix (summary)

| Area | Status |
|---|---|
| Shell, routing, theming, density, accent | 🟢 |
| Slide rendering (12 layouts) + ScaledSlide | 🟢 |
| Charts (render) | 🟢 (🟡 fixed series) |
| Add/delete slides, change layout/theme, navigation | 🟢 |
| Toolbar insert menus (component/text/table/chart) | 🟢 |
| MCP API (REST + tools) | 🟢 |
| LLM proxy + Co-pilot edits the current slide | 🟢 |
| Settings: AI + Appearance | 🟢 (🟡 top-p) |
| PPTX export | 🟢 (🟡 roadmap layout) |
| Presenter | 🟡 |
| Canvas selection / direct manipulation | 🟢 core + multi-select/marquee/move/resize/rotate/align (H+V)/distribute |
| Inspector Design/Animate, timeline | 🔴 |
| Home/Sorter secondary controls, drag-reorder | 🔴 → ⚪ |
| Templates → real starter decks | 🟡 → ⚪ |
| Editor ↔ server round-trip | 🟢 |
| Collaboration | 🔴 → ⚪ |
| Durable persistence + multi-deck library | 🟢 |

---

## 19. Prioritized roadmap (highest impact first)

1. ~~**MCP round-trip** — editor `GET`/polls `/api/deck` so agent edits render live.~~ ✅ **Done** — `rev` counter + `/api/deck/state` + `useDeckSync` (§11.6). _Next: durable persistence (§17) so reloads survive._
2. ~~**Co-pilot applies edits** — parse replies and commit through editor callbacks.~~ ✅ **Done** — `editSlide` → patch → `applySlidePatch` via `onApplyAIPatch` (§8.2).
3. ~~**Real selection & direct manipulation** — element model + click/drag/resize/rotate; multi-select/align/distribute.~~ ✅ **Done** — free-form `elements` layer with select/marquee/move/resize/rotate + align (H+V)/distribute (§9). _(Properties panel binds the single selection; per-element typography still ⚪.)_
4. ~~**Durable persistence + multi-deck library**~~ ✅ **Done** — disk-persisted deck library; Home lists/opens/creates/renames/deletes real decks (§7.1, §17). _Follow-up: seed via `POST /api/decks` to remove the last untagged-write window; list-view rename/delete._
5. ~~**Drag-to-reorder + section CRUD + AI reorder**~~ ✅ **Done** — Thumbs rail (§7.2.3) and Sorter grid (§7.3) both reorder via `moveSlide`; Sorter adds section create/rename/delete (`addSection`/`renameSection`/`deleteSection`); **Rearrange with AI** sends the outline to the Co-pilot (`suggestSlideOrder`) and applies the order via `applySlideOrder` (all in `lib/deckOrder.js`/`lib/llmClient.js`). _(§7.3)_
6. ~~**Chart + roadmap in PPTX**~~ ✅ **Done** — native editable `addChart` via `chartSpec`; canvas + export share `chartData` so charts are data-driven and match (§12). Roadmap now exports as a native timeline (month axis, status-coloured lane bars, TODAY marker, legend), built from the shared `roadmapModel` (`lib/roadmapSpec.js`) so canvas and export match. ⚪ Remaining: multi-series chart canvas rendering; wire export-modal range/quality/notes options. _(§12, §13)_
7. ~~**Templates seed real decks**~~ ✅ **Done** — the picker creates a themed library deck via `templateDeck` + `createDeck` (§14). ⚪ Remaining: persist top-p; genericize the `DeckCover` chrome string; per-template multi-slide skeletons. _(§7.4, §7.1)_ (Duplicate-slide ✅ §7.2.1.)
8. **Presenter** laser-tracks-pointer + blackout. _(§7.5)_
9. **Collaboration** presence + comments. _(§16)_
