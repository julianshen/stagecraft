# Canvas slide editor — design

> Status: **design + plan** (nothing here is built unless marked ✅). It re-platforms slide rendering and the editing surface from DOM/CSS/SVG onto `<canvas>`, following the approach of [officeview](https://github.com/julianshen/officeview), and evaluates [Konva](https://konvajs.org/) as the interaction layer.
>
> Companions:
> - [`POWERPOINT-SPEC.md`](POWERPOINT-SPEC.md) — feature spec; its §4 delivery plan is revised to include this work as **Phase K**;
> - [`POWERPOINT-PARITY.md`](POWERPOINT-PARITY.md) — parity matrix.

Contents:
1. Why move to canvas
2. What we have today
3. What officeview gives us
4. What Konva gives us (and doesn't)
5. Options and recommendation
6. Target architecture
7. Text on canvas
8. Testing strategy
9. Migration plan (Phase K)
10. Risks and open questions

---

## 1. Why move to canvas

The goal of the PowerPoint plan is that *what Stagecraft shows is what PowerPoint shows*. The DOM renderer makes that hard:

- **Two layout engines.** The canvas uses CSS (flexbox, `white-space: pre-wrap`, `clip-path`, `border-radius`); the export uses pptxgenjs geometry and PowerPoint's text engine. Every feature is implemented twice and they drift (line wrapping, preset shapes, gradients, arrowheads).
- **Shape fidelity.** CSS `clip-path` polygons cover 11 shapes. PowerPoint has 187 presets with adjustment handles; CSS cannot express most of them, arrows/line ends, or `custGeom`.
- **Text fidelity.** PowerPoint text features — insets, autofit, tab stops, per-run styles, bullets with hanging indents, line spacing in points vs percent — are approximated by CSS and differ in wrapping.
- **Export of images.** PDF export rasterizes the DOM with `modern-screenshot`, a third render path with its own bugs (fonts, filters).
- **Zoom.** The DOM is scaled with `transform: scale()`, so zoom > 92% looks the same (U8) and text blurs at odd scales.

A single canvas painter, fed by the deck model, drawn at the device's real resolution, used by the editor, thumbnails, sorter, presenter and PDF export — and modelled on OOXML semantics — fixes the third and fifth problems and makes the second and fourth tractable. For the first, the PPTX exporter consumes the **same compiled scene** (positions, geometry, text runs) instead of re-deriving layout geometry (§6, decision 8). What stays inherently separate is the final *text wrap*: PowerPoint re-wraps text with its own engine on open. That residual drift is a tracked risk (§10) with parity tests, not something the canvas can remove.

## 2. What we have today

| Area | Today | Files |
|---|---|---|
| Render | DOM + CSS for 13 template layouts; inline SVG for charts and roadmap; `ElementsLayer` (div/`img`/SVG) for free elements | `slides/SlideRenderer.jsx` (846 lines), `styles/main.css` |
| Scale | 1920×1080 DOM scaled by CSS transform | `ui/Primitives.jsx` `ScaledSlide` |
| Editing | DOM overlay of `.el-hit` divs + window pointer listeners: move/resize/rotate, group frame, marquee, smart guides, pen, shape draw | `editor/CanvasSlide.jsx` (697 lines) |
| Geometry math | Pure: move, rotated resize, group resize/rotate, marquee, align/distribute, snap | `lib/elements.js` (670), `lib/align.js` |
| Text editing | `contentEditable` on **template fields only**; free text elements are edited in the inspector | `ui/EditableText.jsx`, `FormatToolbar.jsx` |
| Reuse of `<Slide>` | thumbnails, sorter, presenter, PDF export (DOM → PNG) | `ThumbsPane`, `SorterGrid`, `PresenterView`, `lib/pdfExport.js` |
| Model | Flat `slides` pool; slide = `layout` (discriminated union) + optional `elements[]` (`text`, `image`, `line`, `path`, 11 shape types); groups are a `groupId` tag; no table/chart elements | `data/deck.js`, `lib/deckUtils.js`, `lib/elements.js`, `lib/shapes.js` |
| Tests touching the DOM render/edit surface | ~300 tests (CanvasSlide ~65, SlideRenderer ~85, SlideEditor ~56, Thumbs/Sorter/Presenter ~62, FormatToolbar/EditableText ~21, pdfExport ~12) | |

What carries over unchanged: the deck model and its validators, `lib/elements.js` geometry, `lib/align.js`, the command registry, menus, inspector, sync, PPTX import. PPTX export keeps its pptxgenjs plumbing (sections, backgrounds, native charts), but its per-layout builders are re-pointed at the compiled scene in K3 (§6, decision 8).

## 3. What officeview gives us

officeview renders `.docx/.pptx/.xlsx` pixel-faithfully on Canvas2D — the same problem as our render path, solved for the read side. Pipeline: **bytes → package → typed model → layout → `paint(ctx)`**, pure Canvas2D, no library.

Directly reusable for Stagecraft (all pure TypeScript that takes a plain `CanvasRenderingContext2D`):

| Module | What it does | Use in Stagecraft |
|---|---|---|
| `drawing/geometry.ts` + `presets.json` | 187 PowerPoint preset shapes (from Apache POI) with guide formulas and adjustments → paths; `custGeom` via the same engine | Replaces `lib/shapes.js` CSS clips; unlocks F-OBJ-4 (presets, adjust handles, `custGeom`) |
| `drawing/paint.ts`, `style.ts` | Path fill/stroke, Office-accurate linear gradients, radial gradients, dashes, caps/joins, arrowheads; theme colour transforms (lumMod/lumOff/tint/shade) | Element fill/line/gradient painting; F-DES-1 theme colours |
| `drawing/text-layout.ts` | Pure rich-text layout with an **injected measurer**: runs, per-script font fallback, wrap, emergency grapheme wrap, tabs, justify, line spacing validated against native PowerPoint, insets, anchors, bullets | Text engine for elements and template fields (F-TXT-1..3) |
| `drawing/text-paint.ts` | Paints laid-out text: fills, outlines, shadows, WordArt pattern/gradient fills, warps | Text painting |
| `core/fonts/*` | FontFace registration (incl. embedded fonts), CJK fallback chains, load-before-measure | Font gate before paint; embedded fonts on import |
| `core/search.ts`, `selection.ts` | Text index from recorded `fillText` positions; point → caret hit test | Find (F-TXT-4), caret hit test for canvas text editing |
| `core/zoom.ts`, `<OfficeDoc>` DPR handling | Backing store = CSS size × DPR (capped), `setTransform` so 1 unit = 1 slide px, re-render visible pages at zoom | Zoom/Fit (U8), crisp text at any zoom |
| `worker/` | Render a slide to `ImageBitmap` on `OffscreenCanvas` | Thumbnails and sorter off the main thread |
| `pptx/parse.ts` | Full PPTX → typed model with theme/master/layout inheritance | Optional later: a higher-fidelity import front-end feeding `pptxImport` |

Gaps we must build ourselves: officeview is **view-only** — no shape hit testing, no selection or transforms, no caret/edit model, no IME, no autofit, no bidi/UAX #14, layout recomputed on every paint, shape effects (shadow/glow) not painted, charts limited to a clustered bar.

**How to consume it.** The valuable modules are not in officeview's public `exports`. Preferred: add a `officeview/drawing` subpath export (geometry, paint, style, text layout/paint, fonts) in officeview itself and depend on the published package, so fixes flow both ways. Fallback: vendor `src/drawing/*` + the `core/` helpers it needs under `src/vendor/officeview/` with its MIT licence and the Apache-2.0 POI / Unicode notices. Stagecraft stays JavaScript; it consumes the built ESM + `.d.ts`.

## 4. What Konva gives us (and doesn't)

[Konva](https://konvajs.org/) (MIT, v10, no dependencies) is a Canvas2D scene graph: Stage → Layers (one `<canvas>` each) → Groups → Shapes, with per-shape hit graphs, pointer/touch events with bubbling, drag, a **Transformer** (resize/rotate handles for one or many nodes, keep-ratio, rotation snaps, bound-box constraints), caching, filters, and `toCanvas/toDataURL/toBlob` at any pixel ratio. React bindings: **react-konva 18.x** for our React 18 (react-konva 19 throws on React 18).

| Need | Konva | Notes |
|---|---|---|
| Hit testing incl. rotated/arbitrary geometry | ✅ hit graph; custom `hitFunc` | We give each element a `hitFunc` that draws its preset path (+ stroke tolerance) |
| Drag, multi-select transform, rotate | ✅ `draggable`, `Transformer` | Snap via `dragBoundFunc` / `boundBoxFunc` calling our `align.js` |
| Custom painting | ✅ `Konva.Shape` `sceneFunc(ctx)` | `ctx._context` is the native 2D context → call officeview painters directly |
| Zoom/pan | ✅ stage scale/position | Fit = viewport/1920 |
| Layers (static vs interactive) | ✅ | Background layer `listening(false)`; overlay layer for handles/guides |
| Export a slide to image | ✅ `toCanvas({pixelRatio})` | PDF export and thumbnails could use it, but see §6: the plain painter is enough |
| **Text editing** | ❌ | Konva's own docs: "Konva has not support for such case"; its recipe is a `<textarea>` overlay |
| **Rich text** | ❌ | `Konva.Text` is single-style; mixed runs need our own layout |
| Testing in jsdom | ❌ | Konva recommends a real browser (Vitest browser mode) for Stage tests |

Costs: bundle size for Konva plus react-konva and `react-reconciler` (on the order of 50–70 kB gzipped; K0 measures it against today's build); a second React reconciler in the tree; memory (each layer is a full canvas — 1920×1080 at DPR 2 ≈ 33 MB/layer, so the stage must be sized to the viewport, not the slide, and capped at 3 layers).

## 5. Options and recommendation

| | A. Pure Canvas2D (officeview-style) + own interaction | B. **Konva stage + officeview painters** | C. Canvas painter + keep the DOM interaction overlay |
|---|---|---|---|
| Render | officeview painters on one canvas | officeview painters inside `Konva.Shape` `sceneFunc` | officeview painters on one canvas |
| Hit test / drag / transform | Build: path hit test, handles, multi-select transformer | Konva hit graph + Transformer (customised) | Existing `.el-hit` divs + `lib/elements.js` (already tested) |
| Redraw cost | Full repaint per change (fine at 1 slide) | Per-layer redraw; drag on top layer | Full repaint of the canvas per change |
| Bundle | +0 | + Konva/react-konva (measured in K0) | +0 |
| New code | Most (≈ handles, hit test, events, cursors) | Least for interaction; adapter + Transformer customisation | Least overall; but rotated hit areas stay rectangles and DOM/canvas must stay aligned |
| Fit for later features (adjust handles, crop, pen, connectors) | Build each | Konva anchors/nodes make these straightforward | Each needs more DOM overlay |
| Testability | jsdom + node-canvas for pixels | Browser-mode tests for the stage | Existing DOM tests mostly survive |

**Recommendation: B — a Konva stage for interaction, officeview's drawing engine for pixels, and one framework-free `paintSlide()` for every non-editing surface.**

- Konva saves the interaction layer we would otherwise write (hit graph for arbitrary geometry, Transformer with multi-select rotation, drag constraints, cursors, touch) and makes upcoming features cheap (shape adjust handles, crop handles, connector endpoints, pen).
- officeview supplies what Konva lacks and what PowerPoint fidelity needs: preset geometry, Office gradients, line ends, and a rich-text layout engine validated against PowerPoint.
- Keeping painting in pure functions (`paintElement(ctx, el, env)`) means Konva is only the editor's *interaction shell*: thumbnails, sorter, presenter, Home cards and PDF export call the same painters on a plain canvas (or `OffscreenCanvas` in a worker) without Konva. If Konva ever has to go, only the editor stage changes.
- Option C is the fallback for the first cut-over if Phase K must be shortened: ship the canvas painter (K1–K4) and keep `CanvasSlide`'s DOM overlay until K5.

## 6. Target architecture

```
deck model (unchanged JSON, + new fields)               src/data, lib/deckUtils.js
        │
        ▼
scene builder  ── buildScene(slide, deck, env) → SceneNode[]          src/canvas/scene.js
   • elements → nodes (px, rot, flip, geometry, fill, line, text, image)
   • template layouts → placeholder nodes (layout compilers)          src/canvas/layouts/*.js
   • charts / tables / roadmap → content nodes                         src/canvas/content/*.js
        │
        ▼
painters (pure, ctx in, no React/Konva)                                src/canvas/paint/*.js
   paintSlide(ctx, scene, env)  paintNode(ctx, node, env)
   ← officeview drawing: geometry, paint, style, text layout/paint, fonts
        │
        ├── Editor:  react-konva <Stage>                               src/components/editor/canvas/*
        │     L0 background (listening=false): slide bg + layout chrome
        │     L1 content: one Konva.Shape per node (sceneFunc → paintNode, hitFunc → geometry path)
        │     L2 overlay: Transformer, smart guides, marquee, pen preview, collab cursors, text caret
        │
        ├── Everything else: <SlideCanvas slide>  (plain <canvas>, DPR-aware)   src/components/ui/SlideCanvas.jsx
        │     thumbnails/sorter (bitmap cache, optional worker), presenter, Home cards,
        │     PDF export (canvas → jsPDF image; replaces modern-screenshot)
        │
        └── PPTX export: scene nodes → pptxgenjs shapes/text/charts      src/lib/pptxExport.js
```

Key decisions:

1. **Coordinates.** Keep the 1920-px-wide model space, but **never hard-code the height**: the slide size comes from the deck (`slideDims(deck)` → `{w: 1920, h}`, the accessor F-SLD-3 already specifies, where `h` is 1080 today and becomes `deck.size.h` with F-SLD-3: 1440 for 4:3 or custom). The scene, `<SlideCanvas>`, the Konva stage, Fit/zoom, thumbnails, PDF page size and PPTX layout all read it from the env from K1 on, so D3 needs no canvas refactor. Painters work in slide px; the env carries `dpr × zoom`. EMU conversion stays in import/export only.
2. **Scene is derived, never stored.** `buildScene` is pure and memoised by a **render key**, not the slide alone. The key covers every input that changes pixels: the slide object, deck-level render inputs (theme, heading scale, slide size, fonts), the slide's position (number, section, first/last — used by chrome and numbering), and the font epoch. Deck-wide edits such as `changeHeadingScale` or a reorder therefore invalidate the affected scenes even though the slide object didn't change. The K4 thumbnail bitmap cache and every export use the same render key. The model remains the single source of truth; Konva node attributes are never read back except at gesture end (`dragend`/`transformend`), which commits through the existing `lib/elements.js` functions → `Editor.jsx` mutations → the gate → sync.
3. **Template layouts become placeholder nodes.** All 13 layouts are covered. The 12 template layouts (`cover`, `agenda`, `divider`, `kpi`, `chart`, `split`, `table`, `text`, `list`, `roadmap`, `risks`, `thanks`) each get a *layout compiler*. The 13th, `blank`, has no template content by definition (PowerPoint's Blank: background + `elements` only), so it needs no compiler; K1's element scene builder renders it completely. Each compiler emits positioned text/shape/content nodes (title, eyebrow, KPI tiles, roadmap bars…), using the same positions the CSS uses today. This is the first half of F-DES-2 "layouts as data": the compilers later become master/layout definitions (D4). Template fields stay `slide.title`/`slide.fmt` in the model.
4. **Charts and tables paint natively.** `lib/chartSpec.js` already computes chart geometry; a chart painter draws the same series/axes/labels on canvas (line, bar, area, donut). Tables get a cell-grid painter (ported from officeview's `paintTable`), which is also the table *element* painter for B3.
5. **Assets gate the paint.** `ensureAssets(scene, env)` returns one promise for everything the scene needs before it can be drawn correctly:
   - **fonts** — resolves the families used by the scene and awaits `document.fonts.load` before measuring; a late font load bumps the font epoch, invalidates layout caches and repaints;
   - **images** — decodes every image source into an `ImageBitmap`/`HTMLImageElement` cache on the env (`img.decode()`; data URLs decode asynchronously too), keyed by source so thumbnails and the editor share decoded images.

   Interactive surfaces paint immediately and repaint when the promise settles (a missing image draws its placeholder meanwhile). **Anything that serialises pixels — thumbnail bitmaps, PDF export, `toDataURL`/`toBlob` — must `await ensureAssets()` first**, so a cold export can never capture blank images or fallback fonts.
6. **Layout caching.** Text layout results are cached per (node text, style, box w/h, font epoch) so a drag only repaints, never re-lays out.
7. **Accessibility.** A visually hidden DOM mirror (slide title + text of each node, in reading order, with `aria-live` for edits) replaces what the DOM renderer gave screen readers for free; the presenter announces the slide text.
8. **Export from the scene.** `pptxExport.js` stops re-implementing template geometry: each per-layout builder becomes a mapping from the compiled scene's nodes (frame, geometry preset, fill/line, text runs and box props, chart/table content) to pptxgenjs calls. Layout positions, shape geometry and run styles then have exactly one source — the layout compilers and scene builder — shared by canvas, PDF and PPTX. Parity tests assert that for every layout in `SAMPLE_DECK` the exported shapes' frames and text runs equal the scene's (within EMU rounding).

## 7. Text on canvas

Neither Konva nor officeview edits text. Two stages:

**K5 (first cut): DOM editor overlay, canvas everywhere else.** While a text node is being edited, the canvas hides that node's text and a positioned, transformed `contentEditable` (the existing `EditableText` / FormatToolbar machinery) sits exactly over it, styled from the same resolved style. On commit the overlay is removed and the canvas repaints. This is Konva's recommended pattern; its known weakness is that wrapping in the overlay can differ from the canvas, which is acceptable for a first cut because the overlay only exists while editing.

**K5 commit contract — plain strings only.** `EditableText` commits `textContent` as a string, so it cannot preserve runs or paragraph properties. In K5 the overlay therefore edits **only plain-string text**: template fields (`slide.title`, … with per-field `slide.fmt`, exactly as today) and text elements whose `paragraphs` is a single paragraph with a single run (the commit rewrites that run's `text` and keeps its style). A text element with **mixed runs or more than one styled paragraph** — e.g. from a `.pptx` import after K2 — is **not** opened in the overlay and its inspector Content field is read-only with a "rich text — edit on canvas (K6)" note, so no K5 path can flatten it. K6 lifts the restriction. Tests: a mixed-style, multi-paragraph node survives load → K5 edit attempts (overlay refused, inspector read-only) → save → reload → PPTX export with every run and paragraph property intact.

**K6: canvas-native text editing.** Text is edited *on the canvas* with the officeview layout as the source of caret geometry, so what you edit is exactly what is drawn and exported:

- **Model:** `paragraphs[{props, runs[{text, style}]}]` — the F-TXT-3 rich-text schema, which lands complete (validator, migration, export/import) in K2 — and the pure `lib/richText.js` operations already specified (`insertText`, `deleteRange`, `applyRunStyle`, `splitParagraph`, …).
- **Layout → caret map:** extend the layout output with per-grapheme x-advances per line (officeview already records UTF-16 ranges and grapheme boundaries for search/selection), giving `caretAt(x, y)`, `rectsFor(range)` and up/down/home/end navigation.
- **Input:** a hidden, focused `<textarea>` positioned at the caret receives keystrokes, paste and **IME composition** (`compositionstart/update/end` render the preedit underlined on canvas). Keys go through the command registry (⌘B/I/U, bullets, indent).
- **Rendering:** caret and selection rectangles are drawn on the overlay layer; the FormatToolbar and inspector read the selection's run style.
- **Not in v1:** bidi (RTL) editing and UAX #14 line breaking — CJK keeps grapheme wrapping as in officeview; both are tracked as risks.

This replaces B2's "contenteditable + `richText.js`" plan: the model library is the same, the DOM adapter becomes the canvas caret adapter.

## 8. Testing strategy

jsdom has no canvas, and Konva recommends not testing a Stage in jsdom. The suite is split, following both officeview and Konva:

| Project | Environment | What it covers |
|---|---|---|
| `unit` (existing) | jsdom / node | Scene builder, layout compilers, text layout with an **injected fixed-width measurer** (officeview pattern), caret maps, `richText.js`, hit-test math, `lib/elements.js`, export/import |
| `paint` | node + `canvas` (node-canvas) **or** Chromium | Painter probes: sample pixels at known points (fill colour, stroke presence, text bounding box) and a small set of golden PNGs with a tolerance diff (officeview `pixel-diff` approach) |
| `browser` | Vitest browser mode + Playwright Chromium (preinstalled at `/opt/pw-browsers`) | Konva stage behaviour: select, drag + snap, Transformer resize/rotate, marquee, context menu hit, text editing/IME events |

- The coverage gate (> 90% lines/branches) applies to the merged report; new `src/canvas/**` modules join `coverage.include`.
- The ~300 DOM-coupled tests are migrated with the surface they test, milestone by milestone (K4 for read-only surfaces, K5 for `CanvasSlide`, K6 for `EditableText`/FormatToolbar), so the suite stays green throughout. Behavioural assertions (what the user can do) are kept; DOM-structure assertions are replaced by scene assertions.
- `shots/shoot.mjs` stays as the visual tour.

## 9. Migration plan (Phase K)

Each milestone is its own PR, behind a `canvasRenderer` / `canvasEditor` setting until K7, so the DOM path keeps working and both can be compared side by side.

| M | Scope | Size | Depends |
|---|---|---|---|
| K0 | **Spike + decision record.** officeview `drawing` subpath export (or vendoring); add `konva` + `react-konva@18`; Vitest `paint` and `browser` projects; perf budget on a 40-slide deck (first paint, drag fps, memory). Confirms or rejects option B. | S–M | — |
| K1 | **Drawing core.** `src/canvas/`: scene builder for *elements* (all current types; groups via `groupId`; text ink read from the post-A3 `color` field), geometry from presets (our 11 shapes mapped to `prstGeom` names), fills/gradients/lines/dashes/arrows, images in every A3 fit mode (Fill/`cover`, Fit/`contain`, `stretch`, each with a parity test), opacity, rotation/flip, shadow; `paintSlide`; `<SlideCanvas>` with DPR; `ensureAssets` (fonts + image decode). `blank` slides render on canvas. | M | K0, A3 |
| K2 | **Text engine + rich-text model.** officeview layout + measurer, font epochs, layout cache; insets, anchors, autofit (shrink on overflow, new), bullets. **Model (F-TXT-3):** the `paragraphs`/runs schema with its `deckUtils.js` validator, `normalizeDeck` migration (plain `content` → one run), MCP/Co-pilot schema, and PPTX export/import of runs and paragraph props — so rich text is a complete, round-tripping field before anything edits it. | L | K1 |
| K3 | **Layouts and content as scenes.** Layout compilers for the 12 template layouts (`cover`, `agenda`, `divider`, `kpi`, `chart`, `split`, `table`, `text`, `list`, `roadmap`, `risks`, `thanks`; `blank` is already complete from K1, decision 3); chart painter from `chartSpec.js`; roadmap/risks painters; table grid painter; **`pptxExport.js` layout builders re-pointed at the compiled scene** (decision 8) with scene↔export parity tests. Pixel probes and scene↔export parity for all 13 layouts, `blank` included. | L | K2 |
| K4 | **Read-only surfaces on canvas.** Thumbnails/sorter with a bitmap cache keyed by the render key (decision 2; optional worker), presenter (transitions via canvas compositing), Home slide-1 cards (U13), PDF export via canvas → jsPDF. | M | K3 |
| K5 | **Konva editor stage.** react-konva Stage + 3 layers; select/drag/smart guides/Transformer (single, multi, group)/marquee/shape draw/pen/context-menu hit/zoom + Fit + pan (U8)/rulers/collab cursors; text via the DOM overlay (§7 first cut). Parity checklist = today's `CanvasSlide` tests. | L | K4 |
| K6 | **Canvas-native text editing.** Caret map, hidden-textarea input + IME, selection rendering; the pure `lib/richText.js` edit operations (`insertText`, `deleteRange`, `applyRunStyle`, `splitParagraph`, …) with exhaustive tests; FormatToolbar on canvas selections (B/I/U, size, colour); template fields and text elements both. Covers F-TXT-1 and the editing half of F-TXT-3. | L | K5 |
| K7 | **Cut-over.** Remove the DOM renderer (`SlideRenderer` render path, `ScaledSlide`, `ElementsLayer`, `.el-hit` overlay, `modern-screenshot`), delete the flags, update SPEC/CLAUDE.md ("Adding a slide layout" becomes: model schema + layout compiler + export builder). | S | K6 |

Rough total: 7–10 weeks of focused work. K1–K4 already improve fidelity (presets, gradients, crisp zoom, real thumbnails, better PDF) before the editor itself switches.

## 10. Risks and open questions

**Risks**
- **Text editing on canvas (K6)** is the largest piece (caret, IME, selection, undo coalescing). Mitigations: officeview's recorded text ranges as the caret basis; pure `richText.js`; K5's DOM overlay is a working fallback that can ship indefinitely if K6 slips.
- **PowerPoint re-wraps text.** Even with export driven by the scene (decision 8), PowerPoint lays out text with its own engine on open, so line breaks can still differ from the canvas. Mitigation: officeview's PowerPoint-validated metrics; export sets explicit box insets, autofit and line spacing; round-trip parity tests per layout; a short list of reference decks checked in PowerPoint (`validation/office-reference` approach).
- **Fidelity is now owned by us, not the browser.** Wrapping, kerning and font fallback come from our layout; mismatches with PowerPoint show up everywhere at once. Mitigation: officeview's native-PowerPoint-validated line metrics; golden tests; the `validation/office-reference` approach for a handful of decks.
- **Memory and performance.** Stage sized to the viewport, ≤ 3 layers, background layer cached, `perfectDrawEnabled(false)`, thumbnails as cached bitmaps (never live stages), `Konva.pixelRatio` capped on low-memory devices.
- **Accessibility and browser features.** Canvas text is invisible to screen readers, browser find and spell-check. Mitigations: the hidden DOM mirror (§6.7), app-level find (F-TXT-4), spell-check deferred to F4 using the mirror.
- **Test migration.** ~300 tests move to scene/browser assertions; the gate must not drop. Mitigation: migrate per milestone, keep both paths behind flags until K7.
- **Two codebases.** officeview evolves independently. Mitigation: the subpath export with a pinned version; contributions go upstream.

**Open questions (product owner)**
1. Consume officeview as a dependency with a new `drawing` subpath export (recommended), or vendor a copy?
2. Is option C (canvas painter, DOM interaction overlay) acceptable as an interim release if K5 runs long?
3. Should the import path later switch to officeview's `parsePptx` (masters, themes, 187 presets, rich runs) with a converter to the Stagecraft model, replacing most of `pptxImport.js`?
4. Is K6 (canvas-native text) required before Phase B content features, or may B3/B4 proceed on the K5 overlay?
