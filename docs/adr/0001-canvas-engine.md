# ADR 0001 — Canvas engine: Konva stage + vendored officeview painters

- **Status:** accepted (K0, Phase K of [`POWERPOINT-SPEC.md`](../POWERPOINT-SPEC.md) §4)
- **Context:** [`CANVAS-EDITOR.md`](../CANVAS-EDITOR.md) — why slide rendering and editing move to `<canvas>`, and options A/B/C (§5).
- **Spike:** `spikes/k0/` (run on demand, never in CI).

## Decision

1. **Option B is confirmed.** The editor's interaction layer is a Konva stage (`konva` 10 + `react-konva` 18). Pixels come from officeview's drawing engine. A framework-free `paintSlide()` serves every surface that isn't the editor.
2. **officeview is vendored, not a dependency.** This answers open question 1 of `CANVAS-EDITOR.md`.
   - officeview isn't on npm, and its public exports don't include the drawing modules.
   - A pinned, unmodified copy of the import closure of the modules Phase K needs lives in `src/vendor/officeview/`.
   - It carries officeview's MIT licence and the Apache-2.0 POI notice for `presets.json`.
   - `node scripts/sync-officeview.mjs` re-syncs it (`--ref` moves the pin). Fixes go upstream first.
   - The files stay TypeScript, and Vite/Vitest strip the types with esbuild. Stagecraft gains no `tsc` step.
   - The pin is `9c9518e` (2026-10-10): 18 source files, about 5.7k lines.
3. **There are two Vitest projects** (`vitest.workspace.js`):
   - `unit`: the existing jsdom suite.
   - `chromium`: headless Chromium through Vitest browser mode + Playwright (`vitest.browser.js`). It runs the `*.paint.test.js` painter pixel probes and the `*.browser.test.jsx` Konva stage tests. The design doc's separate `paint` and `browser` projects are one project here, so a run launches one browser and pre-bundles dependencies once.
   - Locally, the lockfile's Playwright (1.56.1) matches the preinstalled browser. CI installs and caches its own.
   - `npm run coverage` (CI) runs both projects once. `npm run test:canvas` runs only `chromium`.
4. **The perf budget below binds K1–K6.** Each milestone that touches a measured path re-runs the spike and records the numbers in its PR.

## What the spike showed

The deck is synthetic but shaped like an imported one: 40 slides × 16 nodes. Each slide has 6 preset shapes (half gradient-filled, all outlined), 8 text boxes (2–3 paragraphs, 14–40 pt, mixed runs, about 250 characters) and 2 pictures. Measurements come from headless Chromium 1194 on a 4-core 2.8 GHz Xeon with software rasterisation, so the GPU paths of a real browser will be at least as fast. Medians of three runs; DPR 1 and DPR 2 agree within noise.

| Measure | Result | Reading |
|---|---|---|
| Full repaint, editor size (1600 CSS px wide, DPR 2), **cold** (text laid out) | 55–66 ms median, p95 ≈ 90 ms | Over a frame: text layout is ~90 % of it |
| Full repaint, **layouts cached** | 1.4–1.9 ms median | Painting itself is cheap at any DPR |
| Text layout, one slide (8 boxes) | ~50–60 ms (≈ 7 ms/box, **195 measurer calls/box**) | The cost is repeated `measureText` |
| ↳ with a measurer memoised on (font, text) | **0.92 ms/box** (7.6× faster) | The synthetic deck's small vocabulary flatters the hit rate; real text still repeats words heavily |
| 40 thumbnails (320×180 CSS at DPR 2) — cold / warm | **2.6 s** / 0.2 s | Cold thumbnails need the measure cache and chunking |
| Thumbnail bitmaps at 640×360 | 37 MB | Size bitmaps to the displayed size × DPR |
| Konva stage, first draw of a slide (16 `Konva.Shape`s calling the painters) | 11–31 ms | One-time |
| Drag frame — whole content layer redrawn | 1.3–1.9 ms median, p95 ≤ 3.9 ms | Fine even without a drag layer |
| Drag frame — dragged node on its own layer | ≤ 0.3 ms | The pattern to use for large slides |
| Hit test (`getIntersection`) | < 0.1 ms median | Box hit regions; path `hitFunc`s will cost more but stay small |
| Stage backing store, 1600×900 viewport (scene at DPR², hit canvas at ratio 1) | 23 MB (DPR 1) · 58 MB (DPR 2, 2 layers) · 86 MB (DPR 2, 3 layers) | Matches the ≤ 3-layer cap in `CANVAS-EDITOR.md` §10 |

**Bundle** (`node spikes/k0/bundle.mjs`, minified + gzip, React external):

| | min | gzip |
|---|---|---|
| Today's app main chunk (for scale) | 814 kB | 268 kB |
| `react-konva` default entry (pulls all of Konva: every shape and filter) | 470 kB | 120 kB |
| `react-konva/es/ReactKonvaCore` + `konva/lib/Core` + `Rect`, `Transformer` | 382 kB | **96 kB** |
| Vendored painters (geometry, paint, text layout + paint) | 698 kB | 112 kB |
| ↳ of which `fast-xml-parser` | | 32 kB |

The design doc estimated Konva at 50–70 kB gzip. It measures 96 kB even with core imports, because `react-konva` brings its own `react-reconciler`.

## Why B still wins

- **Interaction is not the bottleneck.** A whole-layer redraw per drag frame takes under 4 ms (p95), and hit tests are free. Konva's overhead over a hand-written option A is lost in the noise. What Konva saves — a hit graph for arbitrary geometry, a multi-node Transformer with rotation snapping, drag constraints, cursors and touch — is the code that option A would have to write and test. It also makes the coming handles (shape adjust, crop, connector ends) cheap.
- **The real cost is text layout, and it's the same under every option.** A, B and C all paint text through the same officeview engine, so the measure cache is a K2 deliverable either way.
- **The bundle cost is bounded and avoidable on the paths that don't edit.** Konva is only the editor's shell (decision 1). It loads in the editor's lazy chunk, so Home, presenter and export never pay for it. The painters are needed everywhere and belong in the main chunk. They drop to about 80 kB gzip once the 32 kB XML parser is split out of the preset path upstream.
- **Option C stays the fallback** if K5 runs long: canvas painters (K1–K4) under the existing DOM interaction overlay.

## Perf budget (DPR 2, mid-range laptop; checked by re-running the spike)

| Path | Budget | Today | Owner |
|---|---|---|---|
| Repaint of a laid-out slide | ≤ 4 ms | 1.4–1.9 ms | K1 |
| Drag / transform frame (p95) | ≤ 8 ms | ≤ 3.9 ms | K5 |
| One slide cold (layout + paint) | ≤ 16 ms | 55–66 ms | **K2: measure cache + per-node layout cache (decision 6)** |
| 40 thumbnails cold, main-thread work | ≤ 600 ms total, in ≤ 16 ms chunks, visible slides first | 2.6 s (one block) | K2 (cache) + K4 (chunked/idle or worker) |
| Thumbnail bitmap memory, 40 slides | ≤ 16 MB (display size × DPR) | 37 MB at 640×360 | K4 |
| Editor stage backing store | ≤ 3 layers, viewport-sized (≤ 90 MB at DPR 2) | 58 MB (2 layers) | K5 |
| Bundle: main chunk growth (painters) | ≤ 85 kB gzip | 112 kB | upstream split of `geometry.ts` XML parsing, then K1 |
| Bundle: editor chunk (Konva) | ≤ 100 kB gzip, lazy | 96 kB (core imports) | K5 (import from `ReactKonvaCore` + `konva/lib/Core` only) |

## Consequences

- K1 builds `src/canvas/` on `src/vendor/officeview/drawing/*`. A missing module goes into the manifest's `entries` and is re-synced, never copied by hand.
- K2's scope gains the **measure cache**, keyed by font shorthand + text + tracking and invalidated by the font epoch. Its acceptance test is the "one slide cold" budget.
- K4 renders thumbnails visible-first and in chunks, or in a worker over `OffscreenCanvas`. It sizes bitmaps to the rail.
- K5 imports Konva only through `react-konva/es/ReactKonvaCore` + `konva/lib/Core` (and the shapes it uses), inside the lazily loaded editor chunk.
- **Upstream (officeview):** split `parseGeometry`/`custGeom` XML parsing out of `drawing/geometry.ts`, so `resolvePreset` doesn't pull in `fast-xml-parser`. Then re-sync.
- **Unanswered here** (still with the product owner): `CANVAS-EDITOR.md` open questions 2–4.
