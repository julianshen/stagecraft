# Architecture Review — Stagecraft

**Date:** 2026-06-06  
**Scope:** Full codebase  
**Status:** needs_changes

---

## 🔴 Critical (Bugs & Data Integrity)

### 1. `ExportModal` never receives the user's edited deck — exports always use `SAMPLE_DECK`

`App.jsx:140` renders `<ExportModal onClose={...}/>` **without** a `deck` prop. `ExportModal.jsx:27` falls back to `SAMPLE_DECK` when the prop is missing. The user's edits are silently discarded on every export — the generated PPTX contains only the seed data.

**Fix:** Pass the live deck from Editor state through to ExportModal, or lift deck state to App.

### 2. MCP `reorder_slides` reorders the pool but not sections — data corruption

`api.js:76-78` reorders `store.deck.slides` with `order.map(...)` but **does not update `sections[].slides`**. Since render order is defined by sections (not the pool), reordered IDs won't appear in the new order in the UI. The pool and section references are now inconsistent.

### 3. `system` prompt silently dropped by `callLLM`

`llmClient.js:33` passes `{ system: systemMsg, ... }` to `callLLM`, but `callLLM` (lines 23–27) only destructures `provider, model, apiKey, maxTokens, temperature` and **never includes `system`** in the POST body. The LLM proxy (`api.js:31-48`) also has no `system` field handler. All `generateSlide` calls send a system prompt that is never delivered to the model.

### 4. Editor state is destroyed on view switch

`App.jsx:99-108` conditionally renders `<Editor>` only when `view === 'editor'`. Switching to Sorter or Settings unmounts the Editor. Switching back remounts it, reinitializing from `SAMPLE_DECK` (Editor.jsx:14). All edits between mounts are lost.

### 5. Client PUT overwrites all MCP mutations

`Editor.jsx:24-29` fires `PUT /api/deck` on every state change, silently overwriting the server store with the client's entire deck. Any slide added/edited by an MCP agent since the last client mutation is destroyed.

---

## 🟡 Important (Architecture & Coupling)

### 6. Three independent flatten-deck implementations

`deckOrder.js:7-12`, `pptxExport.js:168-173`, and `Editor.jsx:8,84` each implement their own section-order traversal with subtly different null-safety (`deck.sections || []` vs `Array.isArray()` check). They should all use `flattenDeck`.

### 7. Three independent theme definitions

Theme colors are defined in three separate places with no shared source of truth:
- `data/deck.js:2-7` — `ACCENTS` (oklch hue/chroma)
- `pptxExport.js:4-9` — `THEME_COLORS` (hex RGB)
- CSS `:root` in `main.css:5-43` — custom properties

Adding a theme requires editing all three.

### 8. localStorage key `'stagecraft.ai'` is an implicit contract

`SettingsView.jsx` writes and `llmClient.js` reads the same localStorage key with no shared constant, schema, or validation. A key name mismatch or shape change would silently break AI calls.

### 9. Dual LLM routing with no shared schema

The client (`llmClient.js`) and server (`api.js:31-48`) each independently implement provider routing. There is no shared request/response schema; a change to one must be mirrored in the other.

### 10. SlideEditor is a 680-line god component

`SlideEditor.jsx` bundles 7+ state variables, 12 sub-components, and direct `callLLM` usage in a single file. The click-outside pattern is copy-pasted 6+ times. Extracting into separate components and a shared `useClickOutside` hook would improve testability and reduce duplication.

### 11. No debounce on `PUT /api/deck`

Every mutation triggers an immediate full-deck PUT (`Editor.jsx:24-29`). Rapid edits (typing, dragging) can flood the server. The `.catch(() => {})` swallows all errors silently.

### 12. MCP API has no input validation

`runTool()` (`api.js:50`) does zero validation against the declared JSON schemas in `MCP_MANIFEST`. Any string is accepted for `theme`, `id` can be overwritten in `add_slide` via the `args` spread, and `updates` in `update_slide` can set arbitrary keys including `id`.

### 13. LLM proxy returns HTTP 200 for upstream errors

`proxyLLM()` (`api.js:37-38`) flattens upstream API errors (auth failures, rate limits, invalid models) into `{ text }` responses with status 200. The client's `!res.ok` check (`llmClient.js:35`) never fires. The only error path is a network-level exception.

### 14. SSRF via `baseUrl` parameter

`api.js:40` allows arbitrary `baseUrl` values: `const apiBase = baseUrl || 'https://api.openai.com/v1'`. A caller can set `baseUrl` to an internal host (e.g., `http://169.254.169.254/`), and the server will make a POST request to it.

### 15. Slide inline styles bypass theme tokens

`SlideRenderer.jsx` uses hardcoded colors (`#333`, `#555`, `#888`, `#222`, `white`) in inline styles. When the user changes the deck theme, these inline colors do not update because they bypass the CSS custom property system.

### 16. `deleteSlide` has stale closure over `deck`

`Editor.jsx:70-74` reads `deck` (from closure) after calling `setDeck(prev => ...)` for cursor repositioning. The `deck` variable holds the previous render's state. If mutations batch, the cursor logic will operate on stale data.

---

## 💭 Discussion (Style & Maintainability)

### 17. Monolithic switch statement for slide layouts

`SlideRenderer.jsx:206-460` uses a single `switch(slide.layout)` for all 12 layouts. Adding a new layout requires editing this file. Consider a registry/map pattern for extensibility.

### 18. 2100-line global CSS with no scoping

`main.css` is a single file with global selectors. Some use prefixes (`.tsp-`, `.cmp-`), many don't (`.row`, `.label`). Slide styles are split between CSS and JSX inline styles.

### 19. Chart components render hardcoded data

`LineChart`, `BarChart`, etc. in `SlideRenderer.jsx` use data arrays like `[112, 120, 131, ...]` directly in the component, not from slide props. They are static illustrations, not data-driven.

### 20. 1920×1080 magic numbers duplicated in 3 locations

`main.css:693,767` and `Primitives.jsx:66` each hardcode the slide dimensions. These should be a shared constant.

### 21. `onDuplicateSlide` is a silent no-op

`Editor.jsx:111` defines `onDuplicateSlide: () => {}`. The UI shows "Duplicate slide" in the context menu but clicking it does nothing and gives no feedback.

### 22. `onComment` callback is never provided

`SlideEditor.jsx` checks `callbacks.onComment` but `Editor.jsx:95-112` never passes it. The comment button simply won't render.

### 23. `changeTheme` deep-clones the entire deck unnecessarily

`Editor.jsx:48` uses `JSON.parse(JSON.stringify(prev))` only to set a top-level `theme` string. A shallow spread `{ ...prev, theme }` would suffice.

### 24. `getDeck()` REST endpoint returns `{}` for null deck, conflating "empty" with "not loaded"

`api.js:102`: `store.deck || {}` makes an empty deck indistinguishable from "no deck loaded" — MCP agents can't detect this state.

---

## Coverage Gaps

The test coverage gate (`vitest.config.js`) covers only 4 modules. Key untested modules:

| Module | Lines | Risk |
|---|---|---|
| `pptxExport.js` | ~220 | Production-critical export path, 12 layout builders |
| `Editor.jsx` | ~120 | All deck mutation logic |
| `SlideEditor.jsx` | ~680 | Largest component, direct LLM calls |
| `SettingsView.jsx` | ~350 | Writes localStorage AI config |
| `api.js` (MCP paths) | partial | `reorder_slides` bug not caught by tests |

---

## Summary

| Severity | Count |
|---|---|
| 🔴 Critical | 5 |
| 🟡 Important | 11 |
| 💭 Discussion | 8 |