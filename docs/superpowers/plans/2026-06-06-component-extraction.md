# Component Extraction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose monolithic React components into focused, single-responsibility sub-components.

**Architecture:** Pure refactoring — no behavioral changes. Extract inline sub-components into dedicated files under logical folders. Update imports. Preserve all prop interfaces.

**Tech Stack:** React 18, Vite, Vitest

---

## File Map

### New files to create
| File | Responsibility |
|------|---------------|
| `src/lib/slideFactories.js` | Slide template factory functions (addComponent, addTable, addChart, addText) |
| `src/lib/deckUtils.js` | `getFlatSlideIds(deck)` helper |
| `src/components/TopBar.jsx` | App top bar chrome (logo, nav, title, settings) |
| `src/components/sorter/SorterToolbar.jsx` | Sorter mode switcher + actions |
| `src/components/sorter/SorterGrid.jsx` | Grid layout + card rendering |
| `src/components/sorter/SorterOutline.jsx` | Outline layout + preview logic |
| `src/components/presenter/PresenterControls.jsx` | Timer, progress dots, nav buttons |
| `src/components/presenter/PresenterSidePanel.jsx` | Next slide preview + speaker notes |
| `src/components/presenter/LaserPointer.jsx` | Conditional laser dot overlay |
| `src/components/editor/ThumbsPane.jsx` | Left sidebar with sections + thumbnails |
| `src/components/editor/CanvasSlide.jsx` | Resizable slide frame with selection rects |
| `src/components/editor/Ruler.jsx` | Horizontal/vertical ruler ticks |
| `src/components/editor/StatusBar.jsx` | Zoom + selection info bar |
| `src/components/editor/CollabLayer.jsx` | Remote cursor overlay |
| `src/components/editor/menus/ShapeMenu.jsx` | Shape insertion dropdown |
| `src/components/editor/menus/TextMenu.jsx` | Text formatting dropdown |
| `src/components/editor/menus/TableSizePicker.jsx` | Table size grid picker |
| `src/components/editor/menus/ChartTypePicker.jsx` | Chart type dropdown |
| `src/components/editor/menus/LayoutMenu.jsx` | Slide layout switcher |
| `src/components/editor/menus/ThemeMenu.jsx` | Theme picker dropdown |
| `src/components/editor/menus/ComponentMenu.jsx` | Component insertion menu |
| `src/components/editor/inspector/InspectorPane.jsx` | Docked inspector sidebar |
| `src/components/editor/inspector/FloatingInspector.jsx` | Floating inspector panel |
| `src/components/editor/inspector/DesignPanel.jsx` | Design tab content |
| `src/components/editor/inspector/PropsPanel.jsx` | Properties tab content |
| `src/components/editor/inspector/AnimPanel.jsx` | Animation tab content |
| `src/components/editor/drawers/TimelineDrawer.jsx` | Animation timeline drawer |
| `src/components/editor/drawers/DefaultAIDrawer.jsx` | AI Co-pilot chat drawer |

### Files to modify
| File | Changes |
|------|---------|
| `src/components/editor/Editor.jsx` | Import from slideFactories/deckUtils, useMemo callbacks, remove inline templates |
| `src/components/editor/SlideEditor.jsx` | Import extracted components, remove inline definitions |
| `src/App.jsx` | Import TopBar, remove inline top bar JSX |
| `src/components/views/SorterView.jsx` | Import SorterToolbar/SorterGrid/SorterOutline, remove inline definitions |
| `src/components/views/PresenterView.jsx` | Import PresenterControls/PresenterSidePanel/LaserPointer, remove inline definitions |
| `src/components/modals/ExportModal.jsx` | Extract inline format list + options panel (optional inline extraction) |

---

## Chunk 1: Extract lib utilities + Editor.jsx cleanup

**Files:**
- Create: `src/lib/slideFactories.js`
- Create: `src/lib/deckUtils.js`
- Modify: `src/components/editor/Editor.jsx`

### Task 1.1: Extract slide factories

- [ ] **Step 1: Create `src/lib/slideFactories.js`**
  Move `addComponent`, `addTable`, `addChart`, `addText` factory logic from `Editor.jsx`.
  Export: `addComponent(type)`, `addTable()`, `addChart()`, `addText()`.
  Each function returns a slide object (not pushing — pure factory).

- [ ] **Step 2: Create `src/lib/deckUtils.js`**
  Export `getFlatSlideIds(deck)` that flattens `deck.sections[].slides` into an ordered ID array.
  Replaces the 3 inline occurrences in `Editor.jsx`.

- [ ] **Step 3: Update `Editor.jsx`**
  - Import factories and `getFlatSlideIds` from new modules
  - Replace inline factory code with imported functions
  - Replace 3 inline flatten loops with `getFlatSlideIds(deck)`
  - Wrap `callbacks` in `useMemo` and `renderSlide` in `useCallback`
  - Remove unused `onOpenHome` prop if truly unused

- [ ] **Step 4: Run tests**
  ```bash
  npm test
  ```
  Expected: 72+ tests passing

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/slideFactories.js src/lib/deckUtils.js src/components/editor/Editor.jsx
  git commit -m "refactor: extract slide factories and deck utils from Editor"
  ```

---

## Chunk 2: Extract App.jsx top bar

**Files:**
- Create: `src/components/TopBar.jsx`
- Modify: `src/App.jsx`

### Task 2.1: Extract TopBar component

- [ ] **Step 1: Create `src/components/TopBar.jsx`**
  Extract the top bar JSX (`App.jsx:76-122`) into a component receiving:
  `view`, `setView`, `deckTitle`, `tw`, `setModal`, `onPresent`

- [ ] **Step 2: Update `App.jsx`**
  Import `TopBar` and replace inline top bar with `<TopBar ... />`

- [ ] **Step 3: Run tests**
  ```bash
  npm test
  ```
  Expected: all passing

- [ ] **Step 4: Commit**
  ```bash
  git add src/components/TopBar.jsx src/App.jsx
  git commit -m "refactor: extract TopBar from App"
  ```

---

## Chunk 3: Extract SorterView sub-components

**Files:**
- Create: `src/components/sorter/SorterToolbar.jsx`
- Create: `src/components/sorter/SorterGrid.jsx`
- Create: `src/components/sorter/SorterOutline.jsx`
- Modify: `src/components/views/SorterView.jsx`

### Task 3.1: Extract Sorter sub-components

- [ ] **Step 1: Create `SorterToolbar.jsx`**
  Extract toolbar JSX (`SorterView.jsx:22-45`). Props: `mode`, `setMode`, `onBack`.

- [ ] **Step 2: Create `SorterGrid.jsx`**
  Extract grid JSX (`SorterView.jsx:47-90`). Props: `flat`, `active`, `setActive`, `onOpenSlide`, `renderSlide`.

- [ ] **Step 3: Create `SorterOutline.jsx`**
  Extract outline JSX (`SorterView.jsx:91-124`). Props: `flat`, `active`, `setActive`, `onOpenSlide`.

- [ ] **Step 4: Update `SorterView.jsx`**
  Import the 3 extracted components. Replace inline JSX with component usage.

- [ ] **Step 5: Run tests**
  ```bash
  npm test
  ```
  Expected: all passing

- [ ] **Step 6: Commit**
  ```bash
  git add src/components/sorter/ src/components/views/SorterView.jsx
  git commit -m "refactor: extract SorterToolbar, SorterGrid, SorterOutline"
  ```

---

## Chunk 4: Extract PresenterView sub-components

**Files:**
- Create: `src/components/presenter/PresenterControls.jsx`
- Create: `src/components/presenter/PresenterSidePanel.jsx`
- Create: `src/components/presenter/LaserPointer.jsx`
- Modify: `src/components/views/PresenterView.jsx`

### Task 4.1: Extract Presenter sub-components

- [ ] **Step 1: Create `PresenterControls.jsx`**
  Extract controls JSX (`PresenterView.jsx:90-118`). Props: `idx`, `total`, `elapsed`, `laser`, `setLaser`, `onPrev`, `onNext`, `onExit`.

- [ ] **Step 2: Create `PresenterSidePanel.jsx`**
  Extract side panel JSX (`PresenterView.jsx:69-88`). Props: `nextSlide`, `notes`.

- [ ] **Step 3: Create `LaserPointer.jsx`**
  Extract laser JSX (`PresenterView.jsx:58-65`). Props: `enabled`.

- [ ] **Step 4: Update `PresenterView.jsx`**
  Import the 3 extracted components. Replace inline JSX.

- [ ] **Step 5: Run tests**
  ```bash
  npm test
  ```
  Expected: all passing

- [ ] **Step 6: Commit**
  ```bash
  git add src/components/presenter/ src/components/views/PresenterView.jsx
  git commit -m "refactor: extract PresenterControls, PresenterSidePanel, LaserPointer"
  ```

---

## Chunk 5: Extract SlideEditor small components

**Files:**
- Create: `src/components/editor/Ruler.jsx`
- Create: `src/components/editor/StatusBar.jsx`
- Create: `src/components/editor/CollabLayer.jsx`
- Modify: `src/components/editor/SlideEditor.jsx`

### Task 5.1: Extract Ruler, StatusBar, CollabLayer

- [ ] **Step 1: Create `Ruler.jsx`**
  Extract `Ruler` component (`SlideEditor.jsx:291-313`). Pure presentational.

- [ ] **Step 2: Create `StatusBar.jsx`**
  Extract `StatusBar` component (`SlideEditor.jsx:315-333`). Props: `zoom`, `selectionLabel`.

- [ ] **Step 3: Create `CollabLayer.jsx`**
  Extract `CollabLayer` component (`SlideEditor.jsx:335-351`). Props: `collaborators`.

- [ ] **Step 4: Update `SlideEditor.jsx`**
  Import the 3 components. Remove inline definitions.

- [ ] **Step 5: Run tests**
  ```bash
  npm test
  ```
  Expected: all passing

- [ ] **Step 6: Commit**
  ```bash
  git add src/components/editor/Ruler.jsx src/components/editor/StatusBar.jsx src/components/editor/CollabLayer.jsx src/components/editor/SlideEditor.jsx
  git commit -m "refactor: extract Ruler, StatusBar, CollabLayer from SlideEditor"
  ```

---

## Chunk 6: Extract SlideEditor canvas + thumbs

**Files:**
- Create: `src/components/editor/CanvasSlide.jsx`
- Create: `src/components/editor/ThumbsPane.jsx`
- Modify: `src/components/editor/SlideEditor.jsx`

### Task 6.1: Extract CanvasSlide and ThumbsPane

- [ ] **Step 1: Create `CanvasSlide.jsx`**
  Extract `CanvasSlide` component (`SlideEditor.jsx:230-288`). Props: `slide`, `scale`, `selection`, `children`.

- [ ] **Step 2: Create `ThumbsPane.jsx`**
  Extract `ThumbsPane` component (`SlideEditor.jsx:178-227`). Props: `deck`, `currentSlideId`, `onChange`, `comments`.

- [ ] **Step 3: Update `SlideEditor.jsx`**
  Import the 2 components. Remove inline definitions.

- [ ] **Step 4: Run tests**
  ```bash
  npm test
  ```
  Expected: all passing

- [ ] **Step 5: Commit**
  ```bash
  git add src/components/editor/CanvasSlide.jsx src/components/editor/ThumbsPane.jsx src/components/editor/SlideEditor.jsx
  git commit -m "refactor: extract CanvasSlide and ThumbsPane from SlideEditor"
  ```

---

## Chunk 7: Extract SlideEditor toolbar menus

**Files:**
- Create: `src/components/editor/menus/ShapeMenu.jsx`
- Create: `src/components/editor/menus/TextMenu.jsx`
- Create: `src/components/editor/menus/TableSizePicker.jsx`
- Create: `src/components/editor/menus/ChartTypePicker.jsx`
- Create: `src/components/editor/menus/LayoutMenu.jsx`
- Create: `src/components/editor/menus/ThemeMenu.jsx`
- Create: `src/components/editor/menus/ComponentMenu.jsx`
- Modify: `src/components/editor/SlideEditor.jsx`

### Task 7.1: Extract 7 toolbar menu components

- [ ] **Step 1: Extract each menu component**
  Each menu (`ShapeMenu`, `TextMenu`, etc.) is self-contained with its own `open`/`ref`/`useEffect` click-outside logic. Extract all 7 to individual files under `menus/`.

- [ ] **Step 2: Update `SlideEditor.jsx`**
  Import all 7 menu components. Remove inline definitions.

- [ ] **Step 3: Run tests**
  ```bash
  npm test
  ```
  Expected: all passing

- [ ] **Step 4: Commit**
  ```bash
  git add src/components/editor/menus/ src/components/editor/SlideEditor.jsx
  git commit -m "refactor: extract 7 toolbar menus from SlideEditor"
  ```

---

## Chunk 8: Extract SlideEditor inspector

**Files:**
- Create: `src/components/editor/inspector/InspectorPane.jsx`
- Create: `src/components/editor/inspector/FloatingInspector.jsx`
- Create: `src/components/editor/inspector/DesignPanel.jsx`
- Create: `src/components/editor/inspector/PropsPanel.jsx`
- Create: `src/components/editor/inspector/AnimPanel.jsx`
- Modify: `src/components/editor/SlideEditor.jsx`

### Task 8.1: Extract inspector components

- [ ] **Step 1: Extract each inspector component**
  Extract `InspectorPane`, `FloatingInspector`, `DesignPanel`, `PropsPanel`, `AnimPanel` to individual files.

- [ ] **Step 2: Update `SlideEditor.jsx`**
  Import inspector components. Remove inline definitions.

- [ ] **Step 3: Run tests**
  ```bash
  npm test
  ```
  Expected: all passing

- [ ] **Step 4: Commit**
  ```bash
  git add src/components/editor/inspector/ src/components/editor/SlideEditor.jsx
  git commit -m "refactor: extract inspector components from SlideEditor"
  ```

---

## Chunk 9: Extract SlideEditor drawers

**Files:**
- Create: `src/components/editor/drawers/TimelineDrawer.jsx`
- Create: `src/components/editor/drawers/DefaultAIDrawer.jsx`
- Modify: `src/components/editor/SlideEditor.jsx`

### Task 9.1: Extract drawer components

- [ ] **Step 1: Extract `TimelineDrawer.jsx`**
  Extract from `SlideEditor.jsx:803-829`.

- [ ] **Step 2: Extract `DefaultAIDrawer.jsx`**
  Extract from `SlideEditor.jsx:831-876`. Props: `onPrompt`, `loading`, `response`.

- [ ] **Step 3: Update `SlideEditor.jsx`**
  Import drawer components. Remove inline definitions.

- [ ] **Step 4: Run tests**
  ```bash
  npm test
  ```
  Expected: all passing

- [ ] **Step 5: Commit**
  ```bash
  git add src/components/editor/drawers/ src/components/editor/SlideEditor.jsx
  git commit -m "refactor: extract TimelineDrawer and DefaultAIDrawer from SlideEditor"
  ```

---

## Chunk 10: ExportModal extraction (optional)

**Files:**
- Modify: `src/components/modals/ExportModal.jsx`

### Task 10.1: Extract inline panels (optional)

- [ ] **Step 1: Extract `ExportFormatList` and `ExportOptionsPanel` as local components**
  If `ExportModal.jsx` is small enough (83 lines), this may not be worth separate files. Extract as internal component definitions at top of file if desired.

---

## Final Verification

- [ ] **Step 1: Run full test suite**
  ```bash
  npm test
  ```
  Expected: 72+ tests passing

- [ ] **Step 2: Run coverage**
  ```bash
  npm run coverage
  ```
  Expected: >90% branches

- [ ] **Step 3: Run build**
  ```bash
  npm run build
  ```
  Expected: clean build, no new warnings

- [ ] **Step 4: Verify line counts**
  ```bash
  wc -l src/components/editor/SlideEditor.jsx src/components/editor/Editor.jsx
  ```
  Expected: SlideEditor.jsx < 300 lines, Editor.jsx < 120 lines

- [ ] **Step 5: Final commit**
  ```bash
  git commit --allow-empty -m "refactor: complete component extraction"
  ```
