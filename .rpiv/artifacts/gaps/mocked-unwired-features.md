# Stagecraft — Mocked & Unwired Feature Inventory

**Generated:** 2026-06-06  
**Scope:** Full codebase  
**Total findings:** 63 (47 fully stubbed 🔴, 12 partially wired 🟡, 4 data-level)

---

## How to Read This Doc

Each entry has:
- **ID** — stable reference number
- **Location** — file:line
- **Tag** — 🔴 mocked/stubbed (no behavior) · 🟡 partial (works but incomplete) · ⚪ data-level
- **Surface** — what the UI shows the user
- **Behavior** — what the code actually does
- **Spec** — what SPEC.md intends (with § reference where available)

Use this as a roadmap for what to wire up next. Items are grouped by UI surface, not by severity.

---

## 1. Callbacks & Toolbar

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 1 | `Editor.jsx:161` | "Duplicate slide ⌘D" context menu item | `() => {}` — no-op callback | §7.2.1 — clone slide with new ID |
| 2 | `Editor.jsx:154` | Comment toolbar button | `onComment` prop never passed → button never renders | §16 — comments panel |
| 3 | `SlideEditor.jsx:124-126` | Align-left / align-center / align-right buttons | `<IconButton>` with no `onClick` | §9 — align selected elements |
| 4 | `SlideEditor.jsx:127` | Distribute button | `<IconButton name="logic">` no `onClick` | §7.2.2 — distribute elements evenly |
| 5 | `SlideEditor.jsx:131` | Auto-arrange button (✨) | `<IconButton name="magic">` no `onClick` | §7.2.2 🔴 |
| 6 | `SlideEditor.jsx:133` | Version history button | `<IconButton name="history">` no `onClick` | §7.2.2 🔴 |
| 7 | `SlideEditor.jsx:100-105` | Pen / Image tools | Set `tool` state but no canvas drawing behavior | §9 ⚪ — draw freehand / import image |
| 8 | `SlideEditor.jsx:99` | Shape tools (10 shapes) | Set `tool` state but no drawing behavior on canvas | §9 ⚪ |

## 2. Context Menu (SlideEditor.jsx:194-204)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 9 | `SlideEditor.jsx:196` | "Paste slide ⌘V" | No `onClick` | §7.2.1 — paste from clipboard |
| 10 | `SlideEditor.jsx:197` | "Generate with AI ⌘K" | No `onClick` | §7.2.1 — open co-pilot with suggestion |
| 11 | `SlideEditor.jsx:199` | "Change layout" | No `onClick` | §7.2.1 — open layout picker |
| 12 | `SlideEditor.jsx:200` | "Apply theme" | No `onClick` | §7.2.1 — open theme picker |
| 13 | `SlideEditor.jsx:202` | "Duplicate slide ⌘D" | Wired but callback is `() => {}` | §7.2.1 — (duplicate of ID 1) |
| 14 | `SlideEditor.jsx:203` | "Delete slide ⌫" | ✅ **Works** | — |

## 3. Inspector Panels (SlideEditor.jsx)

### Design Panel (lines 771-800)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 15 | `SlideEditor.jsx:771` | Layout grid (8 buttons: frame, columns, rows, etc.) | Static buttons, no `onClick` | §9 — layout selection |
| 16 | `SlideEditor.jsx:777-785` | Theme swatches (8 color circles) | Static `<div>` elements, no click handlers | §4.2 — theme switching |
| 17 | `SlideEditor.jsx:793-800` | Component rail (8 chip elements) | No click handlers | §9 — insert components |

### Properties Panel (lines 812-850)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 18 | `SlideEditor.jsx:830` | Font Family: "Inter" | `readOnly` input | §9 — font selection |
| 19 | `SlideEditor.jsx:831` | Font Style: "Semibold" | `readOnly` input | §9 — font weight/style |
| 20 | `SlideEditor.jsx:831` | Font Size: "96 px" | Hardcoded, not wired to element | §9 — font size |
| 21 | `SlideEditor.jsx:832` | Text Align (left/center/right) | `onChange={() => {}}` no-op | §9 — text alignment |
| 22 | `SlideEditor.jsx:833` | Bold / Italic / Underline | 3 `<button>`s, first hardcodes `className="active"`, no toggling | §9 — text formatting |
| 23 | `SlideEditor.jsx:833` | Angle: "0 deg" | Hardcoded `"0"`, `readOnly` | §9 — rotation |
| 24 | `SlideEditor.jsx:834` | Opacity: "100%" | Hardcoded `"100"`, `readOnly` | §9 — opacity |
| 25 | `SlideEditor.jsx:846-850` | Fill color swatch + hex | Static display, no color picker | §9 — fill color |

### Animate Panel (lines 854-865)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 26 | `SlideEditor.jsx:857` | Transition type: "Morph" | `readOnly` input | §9 — animation |
| 27 | `SlideEditor.jsx:858` | Duration: "480 ms" | Hardcoded, not persisted | §9 — animation timing |
| 28 | `SlideEditor.jsx:860-863` | Builds: "Fade in", "Rise 8px", "Stagger" | Static list, no click handlers | §9 — animation builds |

## 4. Thumbs Pane & Section Controls

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 29 | `SlideEditor.jsx:243` | Outline view toggle | `IconButton` no `onClick` | §7.2.3 🔴 |
| 30 | `SlideEditor.jsx:244` | More (···) button | `IconButton` no `onClick` | §7.2.3 🔴 |
| 31 | `SlideEditor.jsx:280-282` | "New section" button | `<button>` no `onClick` | §7.2.3 — add section |
| 32 | `SlideEditor.jsx:269` | Section chevron ▾ | Static icon, no collapse/expand | §7.2.3 — section collapse |

## 5. Selection Model

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 33 | `SlideEditor.jsx:70` | Single selection box | One hardcoded `{x:80, y:380, w:820, h:210}` titled "Title · H1". No click-to-select on canvas. No multi-select. | §9 🟡 — element selection model |
| 34 | `SlideEditor.jsx:77` | `collaborators={[]}` | `CollabLayer` receives empty array, renders nothing | §16 🔴→⚪ — real-time cursors |

## 6. Status Bar (SlideEditor.jsx:367-385)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 35 | `SlideEditor.jsx:371` | "Saved · autosave on" | Hard-coded string | §4.1 — real save indicator |
| 36 | `SlideEditor.jsx:373` | "Grid: 8px" | Hard-coded string | §9 — grid toggle |
| 37 | `SlideEditor.jsx:374` | "Guides: on" | Hard-coded string | §9 — guides toggle |
| 38 | `SlideEditor.jsx:375` | "en-US" | Hard-coded string | §9 — locale |

## 7. Export Modal (ExportModal.jsx)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 39 | `ExportModal.jsx:28-33` | Keynote, PDF, PNG, MP4, Link formats | All 5 non-PPTX formats just call `onClose()` — no actual export | §14 🔴 |
| 40 | `ExportModal.jsx:55-68` | Range, Quality, Notes, Comments fields | All `readOnly` inputs with hardcoded values, never passed to PPTX exporter | §14 |
| 41 | `ExportModal.jsx:73` | "~6.4 MB · est 4s" size estimate | Hard-coded string regardless of deck size | §14 |

## 8. PPTX Export Stubs

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 42 | `pptxExport.js:260` | Chart slide export | Falls through to `addGenericSlide` (title only, no chart render) | §6.4 🟡 |
| 43 | `pptxExport.js:192` | Roadmap slide export | Shows "Roadmap details coming soon" placeholder text | 🟡 |

## 9. API Endpoints

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 44 | `api.js:103-105` | `POST /api/export/pptx` | Returns `{ ok: true, message: 'Export triggered — use client-side exportToPPTX()' }` — does nothing server-side | 🔴 |
| 45 | Editor↔Server sync | One-way `PUT /api/deck` on every change | Editor never reads server state back. MCP/agent edits are invisible to the client. | §11.6 ⚪ |

## 10. Settings View (SettingsView.jsx)

### General Settings (lines 328-356)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 46 | `SettingsView.jsx:349` | Default slide size: 16:9 / 4:3 | `onChange={() => {}}` no-op | 🔴 |
| 47 | `SettingsView.jsx:341` | Autosave toggle | `ToggleRow` local state, not persisted | 🔴 |
| 48 | `SettingsView.jsx:342` | Snap to grid toggle | `ToggleRow` local state, not persisted | 🔴 |
| 49 | `SettingsView.jsx:343` | Show rulers toggle | `ToggleRow` local state, not persisted | 🔴 |
| 50 | `SettingsView.jsx:344` | Spell check toggle | `ToggleRow` local state, not persisted | 🔴 |
| 51 | `SettingsView.jsx:353-356` | Language selector | `defaultValue="en-US"`, never read or persisted | 🔴 |

### Export Settings (lines 370-397)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 52 | `SettingsView.jsx:377-384` | Default format dropdown | `defaultValue`, not used by ExportModal | 🔴 |
| 53 | `SettingsView.jsx:393` | Quality: Low/Med/High | `onChange={() => {}}` no-op | 🔴 |
| 54 | `SettingsView.jsx~390` | Speaker notes toggle | `ToggleRow` local state, no effect | 🔴 |
| 55 | `SettingsView.jsx~391` | Live data snapshot toggle | `ToggleRow` local state, no effect | 🔴 |

### AI Settings (lines 102-270)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 56 | `SettingsView.jsx:113,255` | Top-P slider | `useState` changes UI value, not included in `save()` | 🟡 |
| 57 | `SettingsView.jsx:116-120` | Task routing (model per task) | `useState` only, never persisted to localStorage | 🟡 |
| 58 | `SettingsView.jsx:265` | Streaming toggle On/Off | `onChange={() => {}}` no-op | 🔴 |

### Shortcuts (lines 405-418)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 59 | `SettingsView.jsx:405-418` | Keyboard shortcuts reference table | Lists ⌘N, ⌘D, ⌘K, ⌘B, ⌘I, ⌘G — none are actually bound. Only ⌘+Enter and Escape work (`App.jsx:93-98`). | 🔴 |

## 11. Home View (HomeView.jsx)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 60 | `HomeView.jsx:87` | Filter button | No `onClick` | §7.1 🔴 |
| 61 | `HomeView.jsx:88` | Sort/Edited button | No `onClick` | §7.1 🔴 |
| 62 | `HomeView.jsx:81` | "Good afternoon." greeting | Hard-coded string, not time-aware | 🔴 |
| 63 | `HomeView.jsx:81` | "3 decks awaiting review, 2 due this week" | Hard-coded text | 🔴 |
| 64 | `HomeView.jsx:24-27` | Sidebar: Recent 6, Starred 2, Trash 0 | Hard-coded counts | 🔴 |
| 65 | `HomeView.jsx:6-8` | "ATLAS · Q3 FY26" label on every deck card | Same hard-coded label on all cards | 🔴 |
| 66 | `HomeView.jsx:34` | "Import .pptx · .key" card | Calls `onNewDeck()` → navigates to editor, no file import | 🔴 |
| 67 | `App.jsx:97-99` | Topbar search "Search decks and slides…" | No `onChange`, no `value`, ⌘K not bound | §7.1 🔴 |

## 12. Sorter View (SorterView.jsx)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 68 | `SorterView.jsx:39` | "All sections" filter | No `onClick` | 🔴 |
| 69 | `SorterView.jsx:40` | "By order" sort | No `onClick` | 🔴 |
| 70 | `SorterView.jsx:42` | "New section" button | No `onClick` | 🔴 |
| 71 | `SorterView.jsx:43` | "Rearrange with AI" button | No `onClick` | 🔴 |
| 72 | `SorterView.jsx:57` | Per-section "Add slide" icon button | `IconButton` no `onClick` | 🔴 |
| 73 | `SorterView.jsx:58` | Per-section "More" icon button | `IconButton` no `onClick` | 🔴 |

## 13. Presenter View (PresenterView.jsx)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 74 | `PresenterView.jsx:107-113` | Laser pointer toggle | Toggles a fixed-position circle at `left:48%, top:54%` — does not follow mouse | §7.5 ⚪ |
| 75 | `PresenterView.jsx:115` | Blackout button | No `onClick` handler | §7.5 🔴 |

## 14. Template Picker (TemplatePicker.jsx)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 76 | `TemplatePicker.jsx:124` | "Create deck" button | Calls `onClose()` — navigates to editor but doesn't load template theme/slides | §14 🟡 |
| 77 | `TemplatePicker.jsx:79` | Search templates input | No `onChange`, no `value`, no filtering | 🔴 |

## 15. AI Co-Pilot (SlideEditor.jsx)

| ID | Location | Surface | Behavior | Spec |
|----|----------|---------|----------|------|
| 78 | `SlideEditor.jsx:914-970` | DefaultAIDrawer response | LLM response is displayed as text, but **never applied** to the deck as a mutation | 🟡 |
| 79 | `SlideEditor.jsx:926-931` | Suggestion chips ("Rewrite as 3 columns", etc.) | Hard-coded prompt strings, don't route through `generateSlide`/`rewriteText` | 🟡 |

## 16. Data-Level Stubs

| ID | Location | What | Detail |
|----|----------|------|--------|
| 80 | `deck.js:7-16` | `DECKS` array | Hard-coded 8-item array. No persistence, no API backend. |
| 81 | `deck.js:115-119` | `SPEAKER_NOTES` | Only 4 of 14 slides have notes. Rest fall back to generic text. |
| 82 | `App.jsx:112` | "Saved · 12s" status text | Hard-coded string, never updates. |
| 83 | `Editor.jsx:21-25` | `useEffect` sync to server | One-way PUT on every change. Never reads back. |

---

## Summary by Severity

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Mocked | 47 | UI surface exists but does nothing on interaction |
| 🟡 Partial | 12 | Works but incomplete (missing persistence, missing secondary behavior, hardcoded fallback data) |
| ⚪ Data | 4 | Static/hardcoded data with no backend |

## Highest-Impact Items to Wire Next

These affect the most-used user workflows:

1. **ID 1** — Duplicate slide (`onDuplicateSlide: () => {}`) — one-liner to add a slide clone
2. **ID 9-12** — Context menu items (Paste, Generate with AI, Change layout, Apply theme) — 4 items in a frequently-used menu
3. **ID 15-16** — Design panel layout grid + theme swatches — the core editing affordance
4. **ID 39** — Export formats beyond PPTX — users expect PDF at minimum
5. **ID 59** — Keyboard shortcuts — the app advertises ⌘D, ⌘K, etc. but none work
6. **ID 78-79** — AI Co-pilot response application — the LLM response is displayed but never applied to the deck