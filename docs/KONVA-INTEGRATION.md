# Konva Canvas Integration (KONVA-2/KONVA-3 — Experimental Opt-In)

This document describes the **experimental opt-in** Konva canvas surface (`surface="konva"`, default remains `'svg'`) shipped across K2a, K2b, K2c, and K3b. Native PPTX admission remains limited to the measured subset below; SVG remains the default and whole-slide fallback.

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

Native PPTX shrink text is painted from stored `fontScale`/`lnSpcReduction` values when source paragraph spacing is omitted or 100%, matching the previously shipped admission behavior. Font sizes snap to the nearest whole point with a 1 pt floor. The measured PowerPoint 16.115 window used Calibri at 28 pt and 48 pt, source spacing 90%, 120%, and 150%, and reductions of 0, 10%, and 20%. Within those samples, the admitted effective-spacing values were 80% and 110–150%; the tested 70%, 90%, and 100% effective values fell back to SVG. For non-default source spacing, only effective 80% or 110–150% is admitted. Compatibility means omitted/100% source spacing with any stored reduction remains admitted if the effective value is finite and positive, including reductions that produce effective 70% or 90%; these combinations were not independently cleared by the parity evidence and remain a known mismatch. The 48 pt, effective-100% sample is +1.5 CSS px and remains an open calibration issue. Default/100% source spacing with a 100% reduction (effective 0%) was admitted on master but now refuses because zero spacing cannot be rendered. This gate does not change the source file or export measurement.

## 3. Supported Editing & Interactions

- **Selection & drag translation**: Single-pointer / single-touch drag on eligible authored shapes/text boxes commits one `document.setGeometry` command with `expectedRevision` and `origin: 'react'`. Multi-touch gestures are ignored.
- **Cancellation**: `Escape`, `blur`, `pointercancel`, `lostpointercapture`, context/revision changes, and embedding fallback cancel the active gesture, restore to the latest scene geometry, and dispatch 0 commands. Denied/stale dragend commits roll back and report `"Move could not be applied."`.
- **Keyboard & text editing**: Arrow keys nudge by `1pt` (`12700` EMU), `Shift+Arrow` nudges by `10pt`; `Ctrl`/`Meta`/`Alt` combos are not intercepted except undo/redo. `Enter` or double-click on a text box focuses the inspector text run control.

## 4. Bundle Inventory (`b7bcf2f`)

Measured on `2026-11-26` at commit `b7bcf2f444db7e0794255fba40a96a849fe3f6ea` (`feat/konva-integration-gates`) via `node spikes/canonical-konva-integration/bundle.mjs` (Vite 8.3.8 + Oxc minification):

| Check | Measured | ADR 0001 Budget | Status |
|---|---|---|---|
| Consumer build lazy Konva chunk (`tests/consumer`, `KonvaSurfaceShell-*.js`) | `212,646` B min / `65,259` B (**63.73 KiB**) gzip | `<= 100 KiB` gzip | PASS |
| Standalone `KonvaSurfaceShell.jsx` (React & `@stagecraft/*` external) | `290,358` B min / `75,409` B (**73.64 KiB**) gzip | `<= 100 KiB` gzip | PASS |
| Painter main-chunk growth (`@stagecraft/renderer/canonical` in `tests/consumer`) | **+44,264 B (+43.23 KiB)** gzip (`405,046` vs `360,782` B) | `<= 85 KiB` gzip | PASS |
| Isolated-clone default-SVG consumer (`no parent node_modules`) | `418,638` B / `130,209` B gzip, **0** `konva`/`react-konva` modules | `0` in built graph | PASS |
| Isolated-clone default-SVG `PresentationEditor` runtime (`surface` unset) | `3` requests, **0** Konva requests, `globalThis.Konva === undefined` | `0` Konva requests | PASS |
| Isolated-clone opt-in `@stagecraft/react/konva` consumer | Entry `163,889` B gzip (**0** `konva` npm); lazy `65,260` B (**63.73 KiB**) gzip | Lazy split `<= 100 KiB` | PASS |
| Isolated-clone opt-in `@stagecraft/react/konva` runtime smoke | `konvaChunkRequests: 1`, `canvasMounted: true`, `pageErrors: 0` | Loads & mounts cleanly | PASS |

## 5. Production Performance (`b7bcf2f`)

Measured on `2026-11-26` at commit `b7bcf2f444db7e0794255fba40a96a849fe3f6ea` via `node spikes/canonical-konva-integration/run-bench.mjs` on a production `vite build` (`minify: 'oxc'`) in `HeadlessChrome/141.0.7390.37` on macOS `darwin arm64` (`Apple M4 Pro`, 14 cores, `Node v26.13.1`) at `1600x900` CSS (`20` cold samples, `10` warmups, `80` warm repaints, `80` drag frames with real `requestAnimationFrame` + `batchDraw`):

- **Metric definitions**:
  - **Cold (`coldTotalMs`)**: Repeated fresh `KonvaStage` mounts (`createRoot` + React mount + `Konva.Stage`/`Layer` allocation + text layout + first draw) **after** the bundle and Konva are already loaded; **excludes** dynamic `import()`/network, module parse, font readiness, and first-ever Konva initialization (not end-to-end first-click latency).
  - **`coldSlideSwitchMs`**: Slide switch on an already-mounted `Stage`; **includes** `buildCanonicalScene` + React update + `stage.draw()`.
  - **`dragHandlerMs`**: Synthetic `mousemove` handler dispatch only; actual layer repaint cost is `warmSyncDrawMs`, and frame cadence is `dragRafIntervalMs` (`requestAnimationFrame` scheduling interval, not GPU presentation latency).

| Workload & DPR | `coldSceneBuildMs` (med/p95/max) | `coldMountAndDrawMs` (med/p95/max) | `coldTotalMs` (med/p95/max) | `coldSlideSwitchMs` (med/p95/max) | `warmSyncDrawMs` (med/p95/max) | `dragHandlerMs` (med/p95/max) | `hitTestMs` (med/p95/max) | rAF Interval (warm / drag med) | Layers & Backing Store |
|---|---|---|---|---|---|---|---|---|---|
| 16-obj (8 shapes + 8 multi-run text), DPR 1 | `0.3 / 1.4 / 1.5 ms` | `13.2 / 14.4 / 33.1 ms` | `13.5 / 14.9 / 34.5 ms` | `0.7 / 1.4 / 2.3 ms` | `0.8 / 1.1 / 1.7 ms` | `0.2 / 0.4 / 1.0 ms` | `0.3 / 0.8 / 0.8 ms` | `15.9 / 16.6 ms` | 2 layers, `16.48 MB` |
| 16-obj (8 shapes + 8 multi-run text), DPR 2 | `2.5 / 2.8 / 3.0 ms` | `15.6 / 18.5 / 36.4 ms` | **`18.0 / 20.4 / 37.7 ms`** | `0.6 / 1.3 / 2.2 ms` | `0.2 / 0.4 / 0.7 ms` | `0.1 / 0.2 / 0.4 ms` | `0.1 / 0.2 / 0.2 ms` | `16.4 / 16.7 ms` | 2 layers, `49.44 MB` |
| 256-obj stress, DPR 1 | `1.5 / 3.5 / 6.2 ms` | `13.7 / 17.4 / 22.0 ms` | `15.5 / 19.8 / 24.2 ms` | `4.1 / 4.4 / 4.8 ms` | `1.0 / 1.7 / 1.8 ms` | `0.1 / 0.3 / 0.7 ms` | `0.1 / 0.4 / 0.6 ms` | `15.6 / 16.7 ms` | 2 layers, `16.48 MB` |
| 256-obj stress, DPR 2 | `1.5 / 1.7 / 1.7 ms` | `18.1 / 20.9 / 21.1 ms` | `19.7 / 22.6 / 22.7 ms` | `4.0 / 4.7 / 5.5 ms` | `1.1 / 1.4 / 1.5 ms` | `0.1 / 0.2 / 0.3 ms` | `0.1 / 0.2 / 0.2 ms` | `15.7 / 16.5 ms` | 2 layers, `49.44 MB` |

- **Backing store breakdown (DPR 2, `1600x900` CSS)**: Layer 0 scene `[3200, 1800]` (`23,040,000` B) + hit `[1600, 900]` (`5,760,000` B) + Layer 1 adornment `[3200, 1800]` (`23,040,000` B, hit `[0, 0]`) + bufferHit `[0, 0]` + `0` cached node canvases = **`51,840,000` B (`49.44 MB`)**, within `<= 3 layers` and `<= 90 MB`. (`jsHeapUsedMB`: `9.54 MB`, reported separately.)
- **Cold slide budget disclosure (DPR 2)**:
  - **Passed**: Warm repaint (`0.2 ms med / 0.4 ms p95 <= 4 ms`), drag handler (`0.1 ms med / 0.2 ms p95 <= 8 ms`), backing store (`2` layers, `49.44 MB <= 90 MB`; hit canvas already `pixelRatio = 1` at `[1600, 900]`), and `coldSlideSwitchMs` on a mounted `Stage` (**`0.6 ms med / 1.3 ms p95`** for 16-obj DPR 2; `4.0 ms med / 4.7 ms p95` for 256-obj DPR 2).
  - **Measured deviation**: Initial fresh `KonvaStage` mount + DPR-2 `3200x1800` backing-store allocation + first draw on the 16-object scene at DPR 2 measures **`18.0 ms med / 20.4 ms p95 / 37.7 ms max`** (`2.5 ms` scene build + `15.0 ms` React mount & Stage/canvas alloc + `0.8 ms` explicit draw) vs the `<= 16 ms` ADR 0001 cold target. Because initial DPR-2 mount p95 exceeds `16 ms`, `surface="konva"` remains **experimental opt-in** (default `'svg'`).

## 6. KONVA-3 Native PPTX Admission Status (`4ac21ec`)

The section 8 histogram was rerun on the original 65 unique K2a package hashes. **14/100 PPTX slides were admitted across 14 packages. ODP remains 0/60 admitted.** On the admitted slides, all 64 native objects are proof-complete and validator-valid (**64/64, 100%**). This result is not representative of all native PPTX content: across the full corpus, 79/100 slide proofs are valid, while 167 native text objects and 3 groups have no complete object proof.

| Format / refusal | Slides | Public reason | Internal diagnostic |
|---|---:|---|---|
| PPTX admitted | 14/100 | — | — |
| PPTX refused: missing appearance proof | 76/100 | `unresolved-appearance` | `native-appearance-proof-missing` |
| PPTX refused: text run spans multiple font slots | 10/100 | `unresolved-appearance` | `text-appearance-unresolved` |
| ODP refused | 60/60 | `unsupported-format` | `format` |

**The contract §8 floor was MISSED:** the target is at least 40/100 PPTX slides across at least 10 packages; observed admission is 14/100. Keep the canvas opt-in **experimental**, keep SVG as the default and whole-slide fallback, and do not weaken proof validation or expand admission by treating missing metrics as supported. No §7.3 native PowerPoint corpus was run. Stored-value autofit display is deferred to K3c under a separate contract.

The committed renderer context-parity and pixel-probe work is at `fb12442` and `4ac21ec`. The histogram and object-level refusal audit are documented in the coordinator reports `reports/KONVA-3B-histogram-codex.md` and `reports/K3B-OBJECT-AUDIT-pi.md` (outside this repository). The histogram report includes the exact proof counts, package hashes, refusal diagnostics and reproducible runner invocation.
