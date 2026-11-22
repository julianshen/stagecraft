# Canonical Konva spike

An isolated React experiment on the canonical document model: primitive rendering, selection and translation. It does not replace the production SVG surface, change plugins, or certify PowerPoint/ODP visual fidelity. Only top-level rectangles and ellipses with explicit solid fills are painted as primitives. Other objects are selectable placeholders; objects without usable geometry appear in the DOM list only.

## Run

From the repository root after `npm ci`:

```sh
npx vitest run --config spikes/canonical-konva/vitest.config.js
KONVA_DPR=2 npx vitest run --config spikes/canonical-konva/vitest.config.js
node spikes/canonical-konva/bundle.mjs
```

The config has its own root. These tests are deliberately outside the shared Vitest workspace, root coverage and CI. Chromium must be installed; the existing `CHROMIUM_PATH` override is supported. Filter `canonical-konva.browser.test.jsx` for interaction tests or `bench.browser.test.jsx` for measurements. No development server or application route is added.

## Component boundary

`CanonicalKonvaStage` consumes immutable snapshots. The host owns the editor, source, subscription and authorization, and must use current controlled props.

| Prop | Contract |
| --- | --- |
| `snapshot` | Core `EditorSnapshot<CanonicalDocument>`; document stays authoritative. |
| `slideId` | Active slide ID, or null. |
| `selection` | Controlled `{slideId, objectId}`; IDs may be null. |
| `ownerKey` | Stable identity object; replace on editor/source/session replacement. |
| `policyKey` | Stable identity object; replace when authorization context changes. |
| `viewport` | Positive finite CSS `{width,height}`. |
| `zoom` | Positive multiplier, default 1; tested 0.5, 1, 2. |
| `readOnly` | Editing requires explicit `false`; omission is read-only. |
| `canMove(object)` | Synchronous host policy; default deny. Check command registration and source capability as well as host authorization. Throws cancel and report. |
| `onSelectionChange(selection)` | UI-only selection request, including removal of missing targets. |
| `onMove(request)` | Synchronous local callback; request is `{slideId,objectId,geometry:{x,y},expectedRevision}`. Throw core rejection to report failure. Async/server transport is outside this spike. |
| `onError(error)` | Optional error reporting; a throwing reporter cannot prevent rollback. |

Host dispatch uses `presentation.setGeometry`. That command requires complete geometry: spread **all fields** from the object snapshot at the captured revision, then apply x/y, and dispatch with `{expectedRevision, origin:'konva-spike'}`. The test Host demonstrates subscription and dispatch. Never substitute the current revision for the captured revision. An interleaving update before React receives a new snapshot is rejected by the core revision check. Unknown geometry fields are not dropped; the current core validator may reject them with `INVALID_PAYLOAD`.

The adapter emits no commands during preview and one final request for a changed rounded position. No-op/cancel emits none. Width, height and rotation remain host-preserved. Core authorization remains authoritative. Rotated ODP shapes are ineligible; PPTX translation preserves rotation. No resize, rotation gesture, groups, flips or transform normalization are implemented.

Coordinates are points (12700 EMU/point) with a centered fit/zoom transform. Raster DPR does not alter document coordinates. Positive axis-aligned outer CSS scaling is handled; outer CSS rotation, skew, reflection and perspective are outside this experiment. Moving/resizing the content box during a gesture cancels it. Avoid such transforms when embedding this spike.

Pointer preview modifies Konva nodes only, then restores from the canonical snapshot on cancel/failure. Escape, blur, matching pointer cancellation/lost capture, selection/owner/policy/revision/viewport changes, capability loss, deletion and unmount cancel. Primary pointer only; unrelated pointer cancellation is ignored. The labeled DOM list supplies selection and arrow-key 1pt movement; editing targets are excluded. This is basic keyboard access, not an assistive-technology certification.

No SourceSession/raw retained package enters the adapter. No host resource is disposed. This local primitive experiment is not a protected-server renderer or security boundary. Future rich-text/IME overlays must reuse `packages/react/src/textSelection.js` from PR4. Existing SVG/DOM plugin renderers cannot be mounted under react-konva; production integration needs an explicit alternative surface contract and fallback.

## Evidence (2026-11-23)

56 standalone Chromium tests at DPR1 and DPR2 (6 geometry, 48 interaction, 2 benchmark). Real core assertions cover one-commit/undo, authorization, stale revision, rotation preservation, capabilities and cancellation (including lost `pointerup` / `buttons === 0`, null `viewport` mid-drag, modified arrow keys with `Shift+Arrow` allowed, non-primary blank-stage clicks, non-overlay reserved-space error alert cleared on selection change, cross-slide selection preservation with dangling-target cleanup, mid-drag `ResizeObserver` on late-mounted `Stage`, rAF layout-shift cancellation, bubbling `<canvas>` `lostpointercapture` isolation, single-commit host rerenders via `React.Profiler`, and no per-move `canMove`). Pixel probes verify actual rect/ellipse rollback. Synthetic `PointerEvent`s do not carry an active browser pointer (so `setPointerCapture` throws and is ignored there), while a dedicated Playwright CDP test exercises real mouse and touch drags and asserts `hasPointerCapture` during and after the drag; pen input and OS-level/native Office fidelity are not exercised.

Three read-only simplify/review passes and three peer-review fix rounds covered reuse, quality/errors/tests and efficiency. Boundaries, types, consumer and production build pass. Full root coverage was not rerun: no production code/config changed, and it would not measure this spike. Production promotion must add permanent browser/type/consumer/coverage gates.

Measurements: macOS 27.2.1 arm64, HeadlessChrome 141.0.7390.37, viewport1600x900. CPU model lookup was unavailable. Twenty mount/draw samples; ten warmups, eighty warm redraws and eighty frame-spaced pointer previews. Values below are median / p95 (nearest-rank `Math.ceil(0.95 * n) - 1`) / max milliseconds, rounded to 0.1ms (zero means below timer resolution).

| DPR / objects | Cold mount + draw | Warm scene + hit draw | Pointer handler + forced draw | Hit lookup |
| --- | --- | --- | --- | --- |
| 1 / 16 | 2.5 / 4.2 / 21.3 | 0.0 / 0.1 / 0.2 | 0.2 / 0.3 / 0.6 | 0.2 / 0.6 / 1.1 |
| 1 / 256 | 9.3 / 10.0 / 12.4 | 0.5 / 0.7 / 2.7 | 0.6 / 0.7 / 0.7 | 0.8 / 0.9 / 1.0 |
| 2 / 16 | 4.1 / 6.0 / 16.2 | 0.0 / 0.1 / 0.4 | 0.1 / 0.3 / 0.4 | 0.2 / 0.6 / 0.7 |
| 2 / 256 | 11.0 / 12.7 / 16.6 | 0.6 / 0.8 / 1.2 | 0.6 / 0.7 / 0.8 | 0.8 / 1.0 / 1.0 |

These are synchronous CPU submission timings, **not full frame/GPU presentation latency**. Pointer preview also queues a batch draw; the benchmark's forced draw and later scheduled draw are not a single total-frame measurement. Hit readback is separate. Note the cold **max** of **21.3ms** (16 objects DPR1), **16.2ms** (16 objects DPR2), and **16.6ms** (256 objects DPR2) exceed the 16ms target; later passing medians/p95s do not erase those cold-start outlier misses. A production claim needs repeated isolated production-build profiling, actual scheduled-draw/presentation instrumentation, representative Office scenes and thumbnails.

One layer uses 11,520,000 scene+hit backing bytes at DPR1 and 28,800,000 at DPR2; the lazily allocated stage hit buffer remained 0 in this fixture. These estimates exclude DOM/JS/GPU overhead and future buffers, and are not process-memory measurements. No thumbnails were measured.

Adapter bundle: 377,103 minified bytes; **96,080 bytes gzip**, under 100KiB. Externals (`["react"]`), `konvaShapes` (asserted to be exactly `["konva/lib/shapes/Ellipse", "konva/lib/shapes/Rect"]`), and Konva/React-Konva module imports are derived dynamically from Vite's build output chunks in `bundle.mjs`. This includes adapter code and React-Konva dependencies, not application/core/source bundles. Run the script for current results.

Existing K1 on-demand baseline at DPR2: cold17.2/22.5ms, warm0.3/0.4ms, scene construction0.0/0.1ms. K1 paints a richer legacy OfficeView scene; these workloads are not fidelity/performance equivalents. No direct claim of speedup is justified.

## Recommended next slice

First prototype an opt-in production surface contract with SVG fallback and a canonical-to-OfficeView painter, keeping source fidelity and plugin ownership explicit. Add consumer/types/coverage and secure-host boundaries before promotion. Then tackle rich text through the shared selection mapper and native IME overlay. Resize/rotate requires a separate local-axis geometry contract and native export/reopen evidence. Do not expand this primitive spike into a second editor state model.
