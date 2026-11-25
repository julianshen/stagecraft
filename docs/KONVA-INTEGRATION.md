# Konva Canvas Integration (KONVA-2 — Experimental Opt-In)

This document describes the **experimental opt-in** Konva canvas surface (`surface="konva"`, default remains `'svg'`) shipped across K2a, K2b, and K2c.

## 1. Package Boundaries & Lazy Loading

- **`@stagecraft/renderer/canonical`** (`packages/renderer/src/canonical/`): Framework-free canonical scene builder (`buildCanonicalScene`), font readiness (`waitForCanonicalFonts`), and OfficeView painter (`createCanonicalPaintEnvironment`, `paintCanonicalNode`). No Konva or React dependency.
- **`@stagecraft/react/presentation`** (`PresentationEditor`, `PresentationCanvas`): Default surface remains `'svg'`. Opt in via `surface="konva"` and observe surface state via `onSurfaceChange?: (outcome: PresentationSurfaceOutcome) => void`.
- **`@stagecraft/react/konva`** (`KonvaPresentationCanvas`): Convenience wrapper around `PresentationCanvas` with `surface="konva"` (`KonvaPresentationCanvasProps = Omit<PresentationCanvasProps, 'surface'>`).
- **Lazy split**: `KonvaStage` and `KonvaSurfaceShell` (`react-konva/es/ReactKonvaCore` + `konva/lib/Core` + `Rect` only) live behind a dynamic `import('./konva/KonvaSurfaceShell.jsx')`. SSR and default-SVG consumers never evaluate Konva or bundle `konva`/`react-konva` into entry chunks.

## 2. Surface Decision & Whole-Slide Fallback

When `surface="konva"` is requested, `computeSurfaceDecision` evaluates eligibility in order and falls back to the SVG view for the entire active slide if any check fails:

- `not-canonical`, `unsupported-format` (ODP), `no-slide`
- `plugin-renderer` (any plugin with non-empty `objectRenderers`)
- `unsupported-embedding` (ancestor CSS rotation, skew, perspective, reflection, or non-positive scale; observed dynamically via `MutationObserver`, `ResizeObserver`, `resize`, and `transitionend`/`transitioncancel`/`animationend`/`animationcancel`, cancelling active drags on fallback)
- `inherited-appearance` (layout/master artwork, inherited background, authored layout mismatch, or theme object defaults; offers `Use a white background` when writable and caused by an inherited background)
- `unresolved-appearance` (native/unauthored slide or object appearance)
- `unsupported-content` (images, tables, charts, groups, bullets, unsupported styles)
- `invalid-geometry`
- `load-failed`, `render-failed`
- `loading`, `fonts-unavailable`, `fonts-timeout`, `canvas-unavailable`

Users can toggle `Switch to standard view` / `Return to canvas view` per editor instance without persisting global preferences.

## 3. Supported Editing & Interactions

- **Selection & drag translation**: Single-pointer / single-touch drag on eligible authored shapes/text boxes commits one `document.setGeometry` command with `expectedRevision` and `origin: 'react'`. Multi-touch gestures are ignored.
- **Cancellation**: `Escape`, `blur`, `pointercancel`, `lostpointercapture`, context/revision changes, and embedding fallback cancel the active gesture, restore to the latest scene geometry, and dispatch 0 commands. Denied/stale dragend commits roll back and report `"Move could not be applied."`.
- **Keyboard & text editing**: Arrow keys nudge by `1pt` (`12700` EMU), `Shift+Arrow` nudges by `10pt`; `Ctrl`/`Meta`/`Alt` combos are not intercepted except undo/redo. `Enter` or double-click on a text box focuses the inspector text run control.

## 4. Bundle Inventory (`spikes/canonical-konva-integration/bundle.mjs`)

Measured on `feat/konva-integration-gates` (rebased on `fa30456`, Vite 8.3.8 + Oxc minification):

| Check | Measured | ADR 0001 Budget | Status |
|---|---|---|---|
| App build lazy Konva chunk (`dist/assets/KonvaSurfaceShell-*.js`) | `212.68 kB` min / **65.91 kB gzip** | `<= 100 kB gzip` | PASS |
| Consumer build lazy Konva chunk (`tests/consumer`) | `212.65 kB` min / **63.73 kB gzip** | `<= 100 kB gzip` | PASS |
| Standalone `KonvaSurfaceShell.jsx` (React & `@stagecraft/*` external) | `290.36 kB` min / **73.64 kB gzip** | `<= 100 kB gzip` | PASS |
| Painter main-chunk growth (`@stagecraft/renderer/canonical` in `tests/consumer`) | **+43.23 kB gzip** (`395.55` vs `352.33 kB`) | `<= 85 kB gzip` | PASS |
| Isolated-clone default-SVG consumer (`no parent node_modules`) | `130.20 kB` entry, **0** `konva`/`react-konva` modules | `0` in built graph | PASS |
| Isolated-clone opt-in `@stagecraft/react/konva` consumer | `163.82 kB` entry (**0** `konva` npm), `63.73 kB` lazy chunk | Lazy split `<= 100 kB` | PASS |

## 5. Production Performance (`spikes/canonical-konva-integration/run-bench.mjs`)

Measured on a production `vite build` (`minify: 'oxc'`) in headless Chromium `141.0.7390.37` on macOS arm64 (`Apple M4 Pro`, 14 cores) at `1600x900` CSS (`20` cold mounts, `10` warmups, `80` warm repaints, `80` drag frames with real `requestAnimationFrame` + `batchDraw`):

| Workload & DPR | Cold Scene Build (med/p95/max) | Cold Mount+Draw (med/p95/max) | Cold Total (med/p95/max) | Warm Sync Draw (med/p95/max) | Drag Handler (med/p95/max) | Hit Test (med/p95/max) | rAF Interval (warm / drag med) | Layers & Backing Store |
|---|---|---|---|---|---|---|---|---|
| 16-obj (8 shapes + 8 multi-run text), DPR 1 | `0.4 / 2.2 / 3.7 ms` | `14.2 / 16.1 / 64.6 ms` | `14.6 / 16.8 / 68.3 ms` | `0.8 / 1.1 / 13.6 ms` | `0.1 / 0.3 / 1.0 ms` | `0.4 / 0.8 / 0.9 ms` | `16.0 / 16.6 ms` | 2 layers, `16.48 MB` |
| 16-obj (8 shapes + 8 multi-run text), DPR 2 | `2.5 / 2.8 / 2.8 ms` | `16.8 / 18.9 / 39.3 ms` | **`18.4 / 20.8 / 40.7 ms`** | `0.3 / 0.4 / 0.5 ms` | `0.1 / 0.2 / 0.4 ms` | `0.1 / 0.2 / 1.1 ms` | `16.4 / 16.7 ms` | 2 layers, `49.44 MB` |
| 256-obj stress, DPR 1 | `1.6 / 3.5 / 6.3 ms` | `14.2 / 18.1 / 19.7 ms` | `16.6 / 20.6 / 22.4 ms` | `1.1 / 1.3 / 1.6 ms` | `0.1 / 0.2 / 0.4 ms` | `0.1 / 0.4 / 0.5 ms` | `15.6 / 16.8 ms` | 2 layers, `16.48 MB` |
| 256-obj stress, DPR 2 | `1.6 / 2.1 / 2.4 ms` | `20.4 / 23.5 / 23.6 ms` | `22.1 / 25.2 / 26.0 ms` | `1.1 / 1.3 / 1.7 ms` | `0.1 / 0.2 / 0.3 ms` | `0.0 / 0.2 / 0.2 ms` | `15.6 / 16.7 ms` | 2 layers, `49.44 MB` |

- **Backing store breakdown (DPR 2, `1600x900` CSS)**: Layer 0 scene `[3200, 1800]` (`23,040,000 B`) + hit `[1600, 900]` (`5,760,000 B`) + Layer 1 adornment `[3200, 1800]` (`23,040,000 B`, hit `[0, 0]`) + bufferHit `[0, 0]` + `0` cached node canvases = **`51,840,000 B` (`49.44 MB`)**, well within `<= 3 layers` and `<= 90 MB`. (`jsHeapUsedMB`: `9.54 MB`, reported separately.)
- **rAF timings**: `15.6–16.8 ms` reflects 60 Hz `requestAnimationFrame` scheduling cadence, not GPU presentation latency.
- **Cold slide budget disclosure (DPR 2)**:
  - **Passed**: Warm repaint (`0.2–0.3 ms med / 0.3–0.4 ms p95 <= 4 ms`), drag handler (`0.1 ms med / 0.2 ms p95 <= 8 ms`), backing store (`2` layers, `49.44 MB <= 90 MB`; hit canvas already `pixelRatio = 1` at `[1600, 900]`), and **cold slide-switch** on a mounted `Stage` (**`0.6 ms med / 1.5 ms p95`** for 16-obj DPR 2; `4.3 ms med / 4.9 ms p95` for 256-obj DPR 2).
  - **Measured deviation**: Initial one-time `Stage` mount + DPR-2 `3200x1800` backing-store allocation + first draw on the 16-object scene at DPR 2 measures **`18.3 ms med / 20.4 ms p95 / 38.9 ms max`** (`2.5 ms` scene build + `15.1 ms` React mount & Stage/canvas alloc + `0.8 ms` explicit draw) vs the `<= 16 ms` ADR 0001 cold target. Because initial DPR-2 mount p95 exceeds `16 ms`, `surface="konva"` remains **experimental opt-in** (default `'svg'`).
