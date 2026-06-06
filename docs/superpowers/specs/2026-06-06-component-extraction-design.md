# Component Extraction Design — 2026-06-06

## Objective
Decompose monolithic React components into focused, single-responsibility sub-components to improve code clarity, testability, and maintainability.

## Scope

### Priority 1: SlideEditor.jsx (~875 lines)
Extract all inline sub-components into dedicated files under `src/components/editor/`.

| Component | Current Lines | Destination |
|-----------|--------------|-------------|
| `ThumbsPane` | 178–227 | `editor/ThumbsPane.jsx` |
| `CanvasSlide` | 230–288 | `editor/CanvasSlide.jsx` |
| `Ruler` | 291–313 | `editor/Ruler.jsx` |
| `StatusBar` | 315–333 | `editor/StatusBar.jsx` |
| `CollabLayer` | 335–351 | `editor/CollabLayer.jsx` |
| `ShapeMenu` | 354–400 | `editor/menus/ShapeMenu.jsx` |
| `TextMenu` | 402–430 | `editor/menus/TextMenu.jsx` |
| `TableSizePicker` | 432–468 | `editor/menus/TableSizePicker.jsx` |
| `ChartTypePicker` | 470–500 | `editor/menus/ChartTypePicker.jsx` |
| `LayoutMenu` | 502–552 | `editor/menus/LayoutMenu.jsx` |
| `ThemeMenu` | 554–598 | `editor/menus/ThemeMenu.jsx` |
| `ComponentMenu` | 600–652 | `editor/menus/ComponentMenu.jsx` |
| `InspectorPane` | 654–696 | `editor/inspector/InspectorPane.jsx` |
| `FloatingInspector` | 698–696 | `editor/inspector/FloatingInspector.jsx` |
| `DesignPanel` | 698–750 | `editor/inspector/DesignPanel.jsx` |
| `PropsPanel` | 752–780 | `editor/inspector/PropsPanel.jsx` |
| `AnimPanel` | 782–801 | `editor/inspector/AnimPanel.jsx` |
| `TimelineDrawer` | 803–829 | `editor/drawers/TimelineDrawer.jsx` |
| `DefaultAIDrawer` | 831–876 | `editor/drawers/DefaultAIDrawer.jsx` |

**Result:** SlideEditor.jsx shrinks to ~250 lines (layout shell + state orchestration).

### Priority 2: Editor.jsx (170 lines)
- Extract slide factory templates to `src/lib/slideFactories.js`
- Extract `getFlatSlideIds(deck)` to `src/lib/deckUtils.js`
- Memoize `callbacks` and `renderSlide` with `useMemo`/`useCallback`

**Result:** Editor.jsx shrinks to ~100 lines (pure orchestration).

### Priority 3: App.jsx (170 lines)
- Extract top bar chrome to `src/components/TopBar.jsx`

### Priority 4: SorterView.jsx (128 lines)
- Extract `SorterToolbar`, `SorterGrid`, `SorterOutline` to `src/components/sorter/`

### Priority 5: PresenterView.jsx (122 lines)
- Extract `PresenterControls`, `PresenterSidePanel`, `LaserPointer` to `src/components/presenter/`

### Priority 6: ExportModal.jsx (83 lines)
- Extract `ExportFormatList`, `ExportOptionsPanel` as inline or separate files

## New Directory Structure

```
src/
├── App.jsx
├── main.jsx
├── lib/
│   ├── slideFactories.js      ← new
│   └── deckUtils.js           ← new
└── components/
    ├── TopBar.jsx             ← new
    ├── editor/
    │   ├── Editor.jsx
    │   ├── SlideEditor.jsx
    │   ├── ThumbsPane.jsx
    │   ├── CanvasSlide.jsx
    │   ├── Ruler.jsx
    │   ├── StatusBar.jsx
    │   ├── CollabLayer.jsx
    │   ├── menus/             ← new folder
    │   ├── inspector/         ← new folder
    │   └── drawers/           ← new folder
    ├── sorter/                ← new folder
    │   └── SorterView.jsx
    ├── presenter/             ← new folder
    │   └── PresenterView.jsx
    ├── modals/
    │   ├── ExportModal.jsx
    │   └── TemplatePicker.jsx
    ├── slides/
    │   └── SlideRenderer.jsx
    └── ui/
        └── ...
```

## Constraints
- No behavioral changes — pure code movement and reorganization
- All existing tests must pass after extraction
- Each extracted component must be importable and renderable independently
- Preserve prop interfaces exactly (no prop renames or signature changes in this pass)

## Success Criteria
- [ ] SlideEditor.jsx < 300 lines
- [ ] Editor.jsx < 120 lines
- [ ] No test regressions (72+ tests passing)
- [ ] Coverage stays above 90% branches
- [ ] Build succeeds without warnings
