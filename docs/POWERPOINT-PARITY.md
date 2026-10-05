# PowerPoint compatibility & feature parity — design review

> Status: review + phase 1, shipped in #112 (matrix re-audited against `master` after merge). Companion to `SPEC.md` (per-feature
> status tags), `PRODUCT-SPEC.md` (vision/UX) and `design.md` (tokens).

## 1. Verdict

Stagecraft's editor core is solid — one renderer for every surface, a validated patch gate
shared by the UI / Co-pilot / MCP, a real element layer with direct manipulation, and a
native (editable) PPTX export for every layout. But until this change it was **not
PowerPoint-compatible in the sense users mean**:

1. **It could not open a PowerPoint file.** Export-only interop means every deck has to start
   in Stagecraft; nobody can bring an existing deck, a corporate template, or a colleague's
   revision back in. (The Home "Import · .pptx · .key" card silently created a *blank* deck.)
2. **The export did not look like the canvas.** Content slides render white-with-ink on the
   canvas but exported dark-navy-with-white-text — the single largest WYSIWYG break, and the
   first thing anyone opening the `.pptx` in PowerPoint would see.
3. **Deck structure was lost on export.** Sections (a first-class Stagecraft concept) were
   flattened; PowerPoint has the same concept natively.

Phase 1 (this change) fixes all three and lays the foundation (a `blank` layout + element
model extensions) that the rest of the parity roadmap builds on.

**Positioning.** `PRODUCT-SPEC.md` §1 says Stagecraft is "not a document-camera clone of
PowerPoint". That still holds for the *interaction model* (dense, keyboard-first,
agent-driven). It does **not** excuse the file boundary: `.pptx` is the lingua franca decks
travel in, so round-tripping it faithfully is table stakes, and the PowerPoint feature set is
the checklist users will hold the editor to. The recommendation is **compatibility first,
then parity on the features decks actually use** — not ribbon-for-ribbon cloning.

## 2. Design review findings

Severity: **P0** blocks PowerPoint interop · **P1** visible fidelity loss / common feature
missing · **P2** less common or polish. ✅ = fixed in this change.

| # | Sev | Finding | Where | Recommendation |
|---|---|---|---|---|
| 1 | P0 | No `.pptx` import; the Import card made a blank deck | `HomeView.jsx`, `App.jsx` | ✅ `lib/pptxImport.js` + Home "Import PowerPoint" |
| 2 | P0 | Export colour scheme ≠ canvas (dark export of light slides) | `pptxExport.js` `THEME_COLORS` | ✅ per-slide `SCHEMES` (light / ink / accent) mirroring `.slide` CSS |
| 3 | P1 | Sections not exported | `pptxExport.js` | ✅ one PowerPoint section per deck section |
| 4 | P1 | No freeform slide: every slide carries template chrome | `SlideRenderer.jsx` | ✅ `blank` layout (PowerPoint "Blank") + `bgColor` |
| 5 | P1 | Text boxes always vertically centred | `ElementView`, export `valign:'middle'` | ✅ `valign` (top/middle/bottom) on canvas, gate, export, Properties |
| 6 | P1 | Office fonts (Calibri…) fell back to the browser's serif | `ElementView` | ✅ `fontStack()` — metric-compatible substitutes + generic family |
| 7 | P1 | **Layouts are code, not data.** PowerPoint's model is theme → master → layout → placeholder; Stagecraft's 12 semantic layouts are a `switch` in the renderer, so an imported deck can't keep its master and re-theming imported content isn't possible | `SlideRenderer.jsx`, `data/deck.js` | Introduce a data-driven **master/layout** model (theme colours + fonts + placeholder boxes); express the built-in layouts as built-in masters; import maps PowerPoint masters onto it |
| 8 | P1 | **Single-style text.** A text element has one font/size/colour; PowerPoint text is paragraphs → runs with per-run style and per-paragraph level/bullets/spacing. Import flattens to the first run's style | `elements.js`, `ElementView` | A rich-text value (`paragraphs[].runs[]`) shared by canvas + export (pptxgenjs accepts run arrays) |
| 9 | P1 | Fixed 16:9 canvas; 4:3 / custom sizes letterbox on import | `SLIDE_W/H` | `deck.size` (16:9, 4:3, custom); the 1920-wide authoring space generalises to a width × height |
| 10 | P1 | Imported charts are placeholders | `pptxImport.js` | Parse `c:chartSpace` (categories + series) into the existing `chart` model — the export already writes native charts |
| 11 | P1 | Imported tables become cell grids, not an editable table | `pptxImport.js` | A `table` element type (the `table` layout's model, positioned freely); apply table styles |
| 12 | P2 | Transitions/animations don't export (pptxgenjs has no API); shape gradients export as a solid blend | `pptxExport.js` | Post-process the generated zip with JSZip (now a dependency) to inject `<p:transition>`, `<p:timing>` and `<a:gradFill>` |
| 13 | P2 | Text insets / autofit not modelled (imported text sits flush to its box edge) | `ElementView`, import | `inset` on text elements (PowerPoint default 0.1″ / 0.05″), honoured on both surfaces |
| 14 | P2 | Hidden slides, slide numbers/footers/date, hyperlinks, comments, media, SmartArt, equations not modelled | — | See matrix §3; import warns rather than drops silently |
| 16 | P1 | **No shared asset store.** Every image element carries its own data URL, so a master logo/background imported onto 40 slides is stored 40× in the deck JSON (re-PUT on every sync, kept in undo history). Import decodes once and warns | `elements` model, `pptxImport.js` | A deck-level `assets` map (id → data URL) referenced by image elements / slide backgrounds; export embeds each once |
| 15 | P2 | Home "Start with AI" card also creates a plain blank deck (same honesty issue as #1) | `HomeView.jsx` | Route it to the Co-pilot (generate an outline → deck) or mark it "Soon" like other unbuilt controls |

## 3. Feature matrix vs PowerPoint

Legend: 🟢 supported · 🟡 partial/approximated · 🔴 missing · — n/a. "Import"/"Export" is
what survives the `.pptx` boundary in each direction.

**Scorecard** (45 PowerPoint features below):

| Surface | 🟢 supported | 🟡 partial | 🔴 missing | — n/a |
|---|---|---|---|---|
| Editor | 24 | 9 | 12 | 0 |
| Import | 14 | 14 | 9 | 8 |
| Export | 17 | 6 | 13 | 9 |

The editor covers about half of the checklist fully. The `.pptx` boundary is now honest:
everything the importer can't represent is warned about, never silently dropped. The largest
remaining gaps cluster in four places, which phase 2–3 target:
1. **Text model:** a single style per text box (#8), no insets or autofit (#13), no hyperlinks.
2. **Template model:** no data-driven masters, themes or slide sizes (#7, #9).
3. **Object types:** charts and tables don't import as editable objects (#10, #11).
4. **Export post-processing:** transitions, gradients, groups and flips (#12).

| Area | PowerPoint feature | Editor | Import | Export | Next |
|---|---|---|---|---|---|
| **File** | Open .pptx | 🟢 | 🟢 | — | — |
| | Save as .pptx | 🟢 | — | 🟢 | — |
| | PDF export | 🟢 | — | — | — |
| | Templates (.potx) | 🟡 built-in skeletons | 🔴 | 🔴 | after masters (#7) |
| | Slide size 16:9 / 4:3 / custom | 🔴 16:9 only | 🟡 letterbox | 🟡 16:9 | #9 |
| | Document properties (title, author) | 🟢 | 🟢 | 🟢 | — |
| **Slides** | New / duplicate / delete / reorder | 🟢 | — | — | — |
| | Sections | 🟢 | 🟢 | 🟢 | — |
| | Layouts (Title, Title+Content, Blank…) | 🟡 12 semantic + Blank | 🟡 → Blank | 🟢 | #7 |
| | Slide masters / themes | 🔴 (deck theme = accent only) | 🟡 resolved, not kept | 🔴 | #7 |
| | Background (solid / picture / gradient) | 🟡 solid on Blank | 🟢 solid / picture (incl. transparency); gradient → first stop; translucent colour blended over white; pattern/tiled warned | 🟡 | gradient bg |
| | Hide slide | 🔴 | 🟡 imported as visible (warned) | 🔴 | P2 |
| | Slide number / footer / date | 🟡 chrome on templates | 🟡 dropped, warned when the slide shows them | 🔴 | P2 |
| | Speaker notes | 🟢 | 🟢 | 🟢 | rich notes |
| **Text** | Text boxes, placeholders | 🟢 | 🟢 (geometry + style inheritance) | 🟢 | — |
| | Font family / size / B / I / U / colour | 🟢 per element | 🟡 first run | 🟢 | #8 |
| | Per-run mixed formatting | 🔴 | 🟡 flattened | 🔴 | #8 |
| | Bullets & levels | 🟡 list layout | 🟡 as text glyphs (bullets + auto-numbering per level) | 🟡 | #8 |
| | Alignment H / V | 🟢 | 🟢 | 🟢 | — |
| | Line spacing | 🟢 | 🟢 | 🟢 | — |
| | Autofit / insets / columns | 🔴 | 🟡 fontScale applied | 🔴 | #13 |
| | Hyperlinks | 🔴 | 🟡 plain text / inert shape (warned) | 🔴 | P2 |
| **Shapes** | Preset shapes | 🟡 11 presets | 🟡 common presets mapped (rounded outlines kept), rest → rect (warned) | 🟢 | more presets |
| | Fill solid / gradient / transparency | 🟢 | 🟢 every colour form; fill and outline alpha kept separately; radial and per-stop alpha approximated (warned) | 🟡 gradient blended | #12 |
| | Outline colour / width / dash | 🟢 | 🟢 | 🟢 | — |
| | Shadow | 🟢 | 🔴 | 🟢 | effectLst import |
| | Lines / connectors | 🟡 straight | 🟢 straight, dashed, elbow; curved → elbow and arrowheads dropped (both warned) | 🟢 | arrowheads |
| | Freeform / pen | 🟢 | 🔴 custGeom → rect | 🟢 | custGeom paths |
| | Group / ungroup | 🟢 | 🟢 | 🟡 flattened | grpSp export |
| | Rotate / flip | 🟡 rotate only | 🟡 rotate incl. rotated groups and tables; flips on lines, pictures/shapes warned | 🟡 rotate only | flip |
| | Align / distribute / z-order | 🟢 | — | — | — |
| **Images** | Insert / move / resize / transparency | 🟢 | 🟢 PNG/JPEG/GIF/SVG/WebP, stretch fit, transparency; tiled → stretched (warned) | 🟢 | — |
| | Crop | 🔴 | 🔴 imported uncropped (warned) | 🔴 | P2 |
| | EMF/WMF | 🔴 | 🔴 skipped (warned) | — | rasterise |
| **Tables** | Insert / edit cells / rows / cols | 🟢 table layout | 🟡 as cell grid | 🟢 native | #11 |
| | Table styles / merged cells | 🔴 | 🟡 spans, cell fills/borders (incl. transparency) kept; styles dropped (warned) | 🔴 | #11 |
| **Charts** | Bar / line / area / pie-donut | 🟢 | 🔴 placeholder (warned) | 🟢 native, editable | #10 |
| **SmartArt / equations / media** | — | 🔴 | 🔴 placeholder (warned) | 🔴 | later |
| **Transitions** | Fade / push / morph… | 🟢 fade / slide / morph (presenter) | 🟢 mapped | 🔴 | #12 |
| **Animations** | Entrance builds | 🟡 stored, not played | 🔴 | 🔴 | #12 |
| **Slide show** | Present, presenter notes, laser, blackout | 🟢 | — | — | — |
| **Review** | Comments | 🔴 (planned) | 🔴 | 🔴 | P2 |
| **View** | Sorter, rulers, grid/snap, zoom | 🟢 | — | — | — |
| **Automation** | (VBA) | 🟢 MCP / REST + Co-pilot | — | — | — |
| **Editing** | Find & replace, format painter, smart guides | 🔴 | — | — | phase 3 |

## 4. What phase 1 ships (this change)

- **`.pptx` import** — `lib/pptxImport.js`, client-side (JSZip + DOMParser), no upload.
  Every slide becomes a `blank` slide whose `elements` reproduce the source:
  - geometry from `xfrm` scaled uniformly into 1920×1080 (other aspect ratios letterbox);
    groups map their child coordinate space and tag members with a shared `groupId`;
  - placeholders inherit position and text style slide → layout → master → `txStyles`
    (size, colour, font incl. `+mj-lt`/`+mn-lt` theme fonts, alignment, bullets per level,
    `normAutofit` font scale, anchor, line spacing);
  - colours resolve `srgbClr`/`schemeClr`/`sysClr`/`prstClr` through the master colour map,
    slide `clrMapOvr`, and theme, applying `lumMod`/`lumOff`/`tint`/`shade`/`alpha`;
  - preset shapes with solid / gradient / style (`fillRef`/`lnRef`/`fontRef`) fills and
    outlines; outline-only shapes become closed stroked paths; connectors become rotated lines;
  - pictures (and picture backgrounds) embed as data URLs; master/layout art shows unless
    `showMasterSp="0"`; footer/date/number placeholders are skipped;
  - native tables become a grouped grid of cells (fills, spans, anchors);
  - speaker notes, transitions (fade/push→slide/morph), sections, title and author.
  - Everything not representable is **reported** (`warnings`, toasted in the app) with an
    honest placeholder where it occupied space — never silently dropped. Every element passes
    the same `isValidElement` gate the Co-pilot and MCP writes go through.
- **Home → Import PowerPoint** opens a `.pptx` picker; the deck is saved to the library and
  opened, with the slide count and warnings toasted.
- **`blank` layout** (PowerPoint's Blank) with a hex `bgColor`, wired through the renderer,
  layout picker, factories, patch gate, Co-pilot prompts and export.
- **Export parity**: per-slide colour scheme matching the canvas; PowerPoint sections;
  text `valign`.
- **Canvas**: `fontStack()` Office font fallbacks; Properties panel ANCHOR control and
  imported font families.

Verified beyond unit tests by (a) round-tripping the sample deck through real pptxgenjs
output into the importer, (b) importing a PowerPoint-authored template (Office master,
theme, placeholders, table) in the running app, and (c) re-exporting that import and
rendering both in LibreOffice Impress side by side.

## 5. Roadmap

**Phase 2 — round-trip fidelity** (makes "open → edit → save" lossless for typical decks)
1. Rich text runs/paragraphs (#8) — the biggest remaining fidelity gap.
2. Chart import into the native `chart` model (#10).
3. `table` element type + table styles (#11).
4. Export post-processing via JSZip: transitions, gradient fills, group shapes (#12).
5. Text insets + autofit (#13).
6. Shared asset store for pictures (#16) — imported master art is currently copied per slide.

**Phase 3 — PowerPoint authoring parity**
1. Data-driven themes/masters/layouts (#7) — import keeps the source master; "Design" panel
   edits theme colours/fonts like PowerPoint's Design tab; `.potx` templates.
2. Slide size (#9), hide slide, slide number / footer / date, hyperlinks.
3. Editor conveniences users expect from PowerPoint: format painter, find & replace,
   duplicate-with-Ctrl-drag, smart guides, image crop, more preset shapes + arrowheads.

**Phase 4 — motion & review**
Animation playback + export (`p:timing`), comments (the ⚪ collaboration item), media.

### Compatibility principles (apply to every phase)
- **Round-trip what we model, warn on what we don't.** No silent drops — a warning and, where
  space was occupied, a labelled placeholder.
- **One gate.** Imported content goes through the same validation as UI, Co-pilot and MCP
  writes, so an import can never produce a deck the editor couldn't.
- **Canvas == export.** Any new visual property lands on the renderer, the export and the gate
  together (the existing single-sourcing convention).
