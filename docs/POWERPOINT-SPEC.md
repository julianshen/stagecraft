# PowerPoint compatibility — UI review, feature spec & delivery plan

> Status: **spec + plan** (nothing here is built unless marked ✅). Inputs:
> - a UI walkthrough of the running app (every view plus element selection, context menu and Shape menu);
> - a code inventory of every toolbar, panel, menu and shortcut;
> - the parity matrix in [`POWERPOINT-PARITY.md`](POWERPOINT-PARITY.md).
>
> Rendering and editing move to `<canvas>` in **Phase K**; that design lives in [`CANVAS-EDITOR.md`](CANVAS-EDITOR.md).
>
> Companions:
> - [`SPEC.md`](../SPEC.md) — per-feature status;
> - [`PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) — vision, personas, UX;
> - [`design.md`](../design.md) — design tokens.

**Goal.** A user can open a typical corporate `.pptx`, edit it with the tools they expect from PowerPoint, save it back, and have PowerPoint show what Stagecraft showed. Agents get the same capabilities through MCP.

**Not the goal:**
- A ribbon clone. Stagecraft keeps its dense, keyboard-first, agent-driven interaction model (PRODUCT-SPEC §1).
- Long-tail features: VBA, 3D models, WordArt effects, ink-to-math, SmartArt *editing*.

Contents:
1. UI design review
2. Target UI architecture
3. Feature spec, area by area, with data model, UI, canvas, export, import and acceptance criteria
4. Delivery plan: phases → milestones → PRs
5. Definition of done, risks, open questions

---

## 1. UI design review

Severity: **P1** = breaks the PowerPoint mental model or a common task · **P2** = friction or polish.
Each finding links to the feature spec (§3) that resolves it.

| # | Sev | Finding (observed) | Resolution |
|---|---|---|---|
| U1 | P1 | **A shape with text is two objects.** An imported "Callout" box is a rect plus a text element overlaid on it. Clicking selects the text, and the box's fill can't be reached without a marquee. In PowerPoint the text lives *inside* the shape. | F-TXT-2 text in shapes |
| U2 | P1 | **Text boxes can't be edited on the canvas.** Overlay text elements render plain `content`; the only way to change their text is the Properties → Content textarea. (Template fields *are* inline-editable.) | F-TXT-1 |
| U3 | P1 | **Context menu ignores context, and its shortcut labels are wrong.** Right-clicking an element shows the canvas menu: Paste, Generate, Change layout, Apply theme, Duplicate/Delete slide. There is no Cut/Copy/Delete/Arrange/Group for the element. "Duplicate slide ⌘D" and "Delete slide ⌫" are labelled with keys that act on *elements*. ⌘K is shown but not bound. | F-UI-1 command registry |
| U4 | P1 | **Insert means "add a slide", not "add an object".** The toolbar Text/Table/Chart menus add a *slide* with that layout. PowerPoint's Insert → Table/Chart drops an object on the current slide. There is no table or chart *element*. | F-OBJ-1, F-OBJ-2, F-UI-2 |
| U5 | P1 | **Text formatting splits by where the text lives.** Template fields get the floating FormatToolbar (B/I/U, size, colour, per field). Text boxes get the Properties panel (per element). Neither has per-character formatting, bullets, strikethrough, highlight, etc. | F-TXT-3 rich text |
| U6 | P1 | **The Animate panel promises builds that never play.** Builds are stored as `{type}` with no target element and no timing, and the presenter never plays them. The Timeline drawer is a hard-coded mock. | F-MOT-2 |
| U7 | P1 | **Text colour is labelled "Fill".** The Properties panel shows a text element's colour as FILL, and text boxes have no box fill or outline, though PowerPoint text boxes have both. | F-TXT-2, F-UI-3 |
| U8 | P2 | **Mocked or lying controls are still visible.** Examples:<br>• Version history button (no handler)<br>• Timeline drawer<br>• Thumbs "outline" and "more"<br>• Sorter "All sections / By order"<br>• Export QUALITY/COMMENTS and the "~6.4 MB · est 4s" estimate<br>• Settings → Export defaults<br>• Presenter clock starts at 6:52 with a fixed "target 40:00"<br>• Status-bar "Grid 8px / Guides on / en-US" are static<br>• "Fit" zoom resets to 62%, and zoom above 92% has no visible effect<br>• Hard-coded greeting<br>• "Start with AI" creates a blank deck | F-UI-4 honesty pass 2 |
| U9 | P2 | **Shortcuts are hinted but unbound.** Tooltips show V/P/I, Settings lists ⌘N/⌘K/⌘//⌘B/⌘I/⌘⇧L, and none are bound. ⌘⏎ checks only `metaKey`, so Ctrl+Enter doesn't work on Windows/Linux. There's no slide navigation in the editor (PgUp/PgDn) and no ⌘B/⌘I/⌘U on a selected text box. | F-UI-1 |
| U10 | P2 | **The toolbar is icon-only and unlabelled.** Text-align and element-align groups sit next to each other and read alike. Group/Ungroup, Bring forward/Send backward and Flip have no buttons. | F-UI-2 |
| U11 | P2 | **Native `<select>` controls show a double chevron.** Affects FAMILY, SPACING, DASH and the Export NOTES option: the browser arrow plus the styled one. | F-UI-3 |
| U12 | P2 | **Model features have no UI.** The slide background (`bgColor`, `bg`) can only be set by the AI. Image `fit` has no control. A chart's type can't be changed after insert (AI only). | F-UI-3, F-DES-3 |
| U13 | P2 | **Home deck cards don't preview the deck.** They're generic coloured tiles, so imported decks are hard to tell apart. | F-UI-4 |
| U14 | P2 | **Notes live only in an inspector tab.** PowerPoint keeps a resizable notes pane under the slide. | F-VIEW-1 |

What works well and should be kept:
- One renderer for canvas, thumbnails, sorter and presenter, so they look identical.
- One validation gate for UI, AI and MCP writes.
- Direct manipulation, smart guides, marquee, grouping.
- Section-grouped thumbnails with drag-reorder.
- The presenter view: next slide, notes, laser, blackout.
- An honest save badge.
- Import that warns instead of dropping content silently.

---

## 2. Target UI architecture

### 2.1 Map of PowerPoint's ribbon onto Stagecraft (no ribbon)

| PowerPoint | Stagecraft surface |
|---|---|
| Home / Insert / Draw | **Toolbar**: tools (Select, Text, Shapes ▾, Picture, Pen) · Insert ▾ (Table, Chart, Link, Symbol, Header & footer…) · Arrange ▾ · Slide ▾ (Layout, Background, Hide). Icons get labels on hover with the real shortcut (from the registry). |
| Shape Format / Picture Format / Table Design / Chart Design (contextual tabs) | **Inspector tabs that appear with the selection**:<br>• *Shape* — fill, line, effects, size, arrange, text options<br>• *Text* — font, paragraph, bullets<br>• *Picture* — crop, fit, alt text, transparency<br>• *Table* — style, borders, rows/cols<br>• *Chart* — type, elements, data |
| Design | Inspector **Design** tab: theme (colours, fonts, variants), slide size, Format Background |
| Transitions / Animations | Inspector **Animate** tab: transition plus the slide's animation list (= Animation Pane). The Timeline drawer is rebuilt on the same model. |
| Slide Show | Present ▾ (From beginning / From current), presenter view |
| Review | Inspector **Comments** tab plus a thumbnail badge; Accessibility check under Review ▾ |
| View | Status bar (zoom, fit, gridlines, guides, notes pane), Sorter, Outline |
| Right-click | Context-aware menus: element · multi-select · canvas · thumbnail · section |
| (none) | **⌘K command palette**: every command, searchable — the Stagecraft answer to "Tell me what you want to do" |

### 2.2 F-UI-1 — Command registry (foundation for every surface) ✅ (A1)

`lib/commands.js` exports a registry of commands. Each command has:
- `id` — for example `element.duplicate`;
- `label`, `icon`;
- `keys` — for example `['Mod+D']`, where Mod is ⌘ on macOS and Ctrl elsewhere;
- `when(ctx)` → boolean;
- `run(ctx)`.

Everything else derives from it:
- toolbar buttons and tooltips;
- every context menu (each menu is a list of command ids filtered by `when`);
- the ⌘K palette;
- the global key handler, through one `useCommandKeys` hook;
- Settings → Shortcuts, generated from the registry.

A label can never claim a shortcut that isn't bound.

**Acceptance criteria:**
- No hard-coded shortcut strings remain in components.
- Every displayed shortcut works.
- Ctrl works wherever ⌘ does.
- The element context menu offers:
  - Cut / Copy / Paste / Duplicate / Delete;
  - Bring forward / Send backward / Front / Back;
  - Group / Ungroup;
  - Flip;
  - Format… (opens the matching inspector tab);
  - Link…
- The thumbnail menu offers:
  - New slide / Duplicate / Delete;
  - Hide slide;
  - Move to section;
  - Layout ▸.

**Editor shortcut baseline (PowerPoint-compatible):**

| Group | Shortcuts |
|---|---|
| Edit | ⌘A select all · ⌘C/X/V · ⌘⇧V paste text only · ⌘D duplicate |
| Group | ⌘G group · ⌘⇧G ungroup |
| Arrange | ⌘⇧] / ⌘⇧[ front / back · ⌘] / ⌘[ forward / backward |
| Text | ⌘B/I/U · ⌘⇧> / ⌘⇧< font size · ⌘L/E/R/J align · ⌘⇧L bullets |
| Find | ⌘F find · ⌘H replace |
| Slides | ⌘M new slide · PgUp/PgDn previous/next slide |
| Show | ⌘⏎ from beginning · ⇧⌘⏎ from current |
| Palette | ⌘K |

### 2.3 F-UI-2 — Insert objects, not slides

- Toolbar **Table ▾** and **Chart ▾** insert a *table/chart element* (F-OBJ-1/2) on the current slide, centred.
- Adding a whole slide of that kind moves to **New slide ▾** (layout gallery).
- The **Text ▾** menu becomes text-box presets (Title, Heading, Body) that insert *text elements*.

### 2.4 F-UI-3 — Inspector correctness

- **Label colours by meaning:**
  - text colour → *Text colour*;
  - shape fill → *Fill*;
  - text boxes gain Fill and Line (default none).
- **Shared `Select` primitive** with one chevron (fixes U11).
- **Controls for model-only fields:** image fit (Fit / Fill / Stretch), chart type, background (F-DES-3).

### 2.5 F-UI-4 — Honesty pass 2

Every control in U8 is either wired or hidden behind the shared `SoonTag`:
- Presenter clock starts at 0, with **Reset**. The target is optional and set in Settings.
- **Fit** computes the zoom from the viewport. *(Delivered by K5, the canvas stage.)*
- The 92% zoom cap is removed (the canvas scrolls). *(K5.)*
- Status-bar values bind to the real settings.
- Export shows a real size estimate (the byte length after generation) or none.
- **Start with AI** opens the Co-pilot with a "make a deck about…" prompt, which produces an outline and then slides.
- Home cards render slide 1 through `<SlideCanvas>`. *(Delivered by K4.)*

---

## 3. Feature spec

Conventions for every feature below:
- **Model** — the fields and validator added to `deckUtils.js` (gate), plus the MCP/Co-pilot schema.
- **Canvas** — `SlideRenderer`/`ElementView`.
- **Export** — `pptxExport.js`, plus `pptxPost.js` (F-EXP-1) where pptxgenjs lacks an API.
- **Import** — `pptxImport.js`. A feature isn't done until a `.pptx` round-trip test passes.

Colours stay hex unless F-DES-1 says otherwise. Lengths are canvas px (1920 wide; 1 in = 144 px).

### 3.1 Text — `F-TXT`

**F-TXT-1 · In-place editing for text boxes.**
- Double-click a text element (or press Enter with it selected) to edit in place, using the same `EditableText` engine as template fields.
- The Properties textarea stays as a fallback.
- **Acceptance criteria:**
  - Typing on the canvas updates `content` through the gate with undo coalescing.
  - Esc reverts.
  - A click outside commits.

**F-TXT-2 · Text inside shapes, plus insets and autofit.**
- **Model:** every shape type accepts the text fields:
  - `content` / `paragraphs`;
  - font fields;
  - `align`, `valign`;
  - `inset {l,t,r,b}` — default 14.4 / 7.2 px, PowerPoint's 0.1″ / 0.05″;
  - `autofit: 'none'|'shrink'|'resize'`;
  - `wrap: bool` (default true).
- `text` elements gain an optional `fill`/`stroke` box. Text-box fill defaults to none (today a text element's `fill` is its text colour — migrated to `color`, see below).
- **Canvas:**
  - Text is laid out in the shape's text rectangle: the box minus insets. Clip-path shapes use their preset's text rect, e.g. triangle = lower centre.
  - `shrink` scales the font to fit.
  - `resize` grows `h`.
- **Export:** one `addText` with `shape` + `fill` + `line`; `margin` = insets; `fit: 'shrink'|'resize'`.
- **Import:** a `p:sp` with geometry and `txBody` becomes **one** element; remove the pair-grouping workaround. `bodyPr lIns/tIns/rIns/bIns`, `normAutofit` and `spAutoFit` map directly.
- **Migration:** text elements' `fill` → `color`. The gate accepts the legacy shape for one release, and `normalizeDeck` rewrites it.
- **Acceptance criteria:**
  - An imported callout is one selectable object.
  - Its fill and text are both editable.
  - Round-trip keeps the insets.

**F-TXT-3 · Rich text (paragraphs → runs).** This is the biggest fidelity item.
- **Model:** `paragraphs: Paragraph[]` alongside the plain `content`. `content` is derived, kept for search, AI and back-compat, and written by the gate.
  - `Paragraph`:
    - `runs: Run[]`
    - `align`
    - `level: 0..8`
    - `bullet: {kind:'none'|'char'|'number', char?, scheme?: 'arabicPeriod'|'alphaLcParenR'|…, startAt?}`
    - `indent`, `hanging`
    - `spaceBefore`, `spaceAfter`
    - `lineSpacing`
  - `Run`:
    - `text`
    - `bold`, `italic`, `underline`, `strike`
    - `color`, `highlight`
    - `fontSize`, `fontFamily`
    - `baseline: 'super'|'sub'`
    - `caps: 'none'|'all'|'small'`
    - `spacing` (letter-spacing)
    - `link` (F-LNK-1)
  - Element-level font fields become the **defaults** that runs override, matching PowerPoint's inheritance.
- **Pure library `lib/richText.js`:**
  - `applyRunStyle(paragraphs, range, patch)`
  - `insertText`, `deleteRange`
  - `splitParagraph`, `mergeParagraphs`
  - `setParagraphProps(range, patch)`
  - `toggleBullets`, `indent` / `outdent`
  - `normalize`, which merges adjacent identical runs
  - `toPlain`
  - Ranges are `{start:{p,o}, end:{p,o}}`. All functions are unit-tested and contain no DOM.
- **Editing:**
  - The canvas caret adapter (K6) maps pointer/keyboard/IME input ↔ range, and every edit goes through `richText.js` and then the gate.
  - The FormatToolbar becomes the single text toolbar for **both** template fields and elements. It adds:
    - font family;
    - strike, sub/superscript;
    - highlight;
    - bullets/numbering;
    - indent;
    - align;
    - clear formatting.
  - Template fields' `slide.fmt` stays per field. Rich runs are scoped to elements, and template fields can adopt them later.
- **Canvas:** laid out and painted by the Phase K text engine (officeview `layoutTextBody`) and edited on canvas (K6, [`CANVAS-EDITOR.md`](CANVAS-EDITOR.md) §7). Bullets/numbers use the PowerPoint auto-number schemes, with the counter logic shared with the importer's `autoNumber`.
- **Export:** pptxgenjs `addText([{text, options}])` per run, with `bullet`, `indentLevel`, `paraSpaceBefore`/`After`, `hyperlink`, `superscript`/`subscript`, `strike`, `highlight`, `charSpacing`.
- **Import:** keep runs and paragraph props instead of flattening, and remove the "first run" approximation. Bullets become real bullet props instead of text glyphs.
- **Acceptance criteria:**
  - Bold one word in a sentence on the canvas → the exported PowerPoint shows exactly that word bold.
  - A multi-level bullet list round-trips with levels and numbering intact.

**F-TXT-4 · Find & replace.**
- ⌘F/⌘H dialog with match case and whole word, searching:
  - template fields;
  - element runs;
  - table cells;
  - notes (optional).
- Replace preserves run formatting when the match lies within one run, and replaces across runs by collapsing to the first run's style.
- Results list jumps to the slide or element.

**F-TXT-5 · Format painter.**
- Captures the selection's style:
  - an element: fill, line, effects, font defaults;
  - a text range: run style.
- Applies it once, or stays sticky on double-click, like PowerPoint.

### 3.2 Objects — `F-OBJ`

**F-OBJ-1 · Table element.**
- **Model:** `type:'table'` with:
  - `cols: number[]` (widths)
  - `rows: [{h, cells: Cell[]}]`
  - `Cell = {paragraphs|content, fill, borders:{l,t,r,b: {color,width,dash}|null}, anchor, inset, gridSpan?, rowSpan?, hMerge?, vMerge?}`
  - `style?: {id, firstRow, lastRow, bandRows, firstCol, bandCols}`, with built-in styles mapped to PowerPoint's table style GUIDs.
- **UI:** inspector *Table* tab:
  - style gallery and style options;
  - cell fill and borders;
  - insert/delete row/column;
  - merge/split;
  - distribute rows/columns.
  - Tab moves to the next cell.
  - Inline cell editing reuses F-TXT-3.
  - The **table layout** slide keeps its own model. "Convert to table element" is offered for free-form editing.
- **Export:** `addTable` at the element's x/y/w with `colW`, row heights, per-cell `fill`/`border`/`margin`/`rowspan`/`colspan`.
- **Import:** `a:tbl` becomes **one** table element, replacing the grouped cell grid. `tableStyleId` maps to a built-in style; unknown styles fall back to explicit cell props, with a warning.
- **Acceptance criteria:** an imported table is selectable as one object, editable cell by cell, and re-exports as a native PowerPoint table with the same spans.

**F-OBJ-2 · Chart element.**
- **Model:** `type:'chart'`, reusing the existing chart model:
  - `chartType` — bar / column / line / area / pie / donut / scatter, plus stacked variants;
  - `categories`, `series[{name, values, color?}]`;
  - `options {legend, dataLabels, axes, gridlines, title}`.
- **UI:**
  - inspector *Chart* tab: type, elements toggles, colours;
  - the existing Data tab grid editor;
  - **chart type can change after insert**.
- **Export:** `addChart` at x/y (native, editable), as the chart layout does today.
- **Import:** parse the `c:chartSpace` part (`c:barChart`/`c:lineChart`/`c:pieChart`/…: `c:cat`/`c:val` caches, series names and colours) into a chart element.
  - Unsupported chart kinds keep today's labelled placeholder and warning.
  - Combo charts are approximated as their first chart type, with a warning.
- **Acceptance criteria:** a PowerPoint bar or line chart imports as an editable chart with the same data and re-exports natively.

**F-OBJ-3 · Pictures.**
- **Model:**
  - `crop {l,t,r,b}` (fractions);
  - `alt` (string);
  - `lockAspect` (bool);
  - `fit` gets UI (Fill = cover / Fit = contain / Stretch).
- **UI:**
  - inspector *Picture* tab;
  - **Crop mode**: handles on the crop rect, with the image ghosted outside it.
  - Shift-resize keeps the aspect ratio; `lockAspect` makes that the default.
- **Canvas:** an inner `<img>` positioned by crop, with overflow clipped.
- **Export:** pptxgenjs `sizing:{type:'crop', x, y, w, h}` and `altText`.
- **Import:** `a:srcRect` becomes `crop` (remove the warning); `cNvPr descr` becomes `alt`.
- **Acceptance criteria:** a cropped picture round-trips pixel-identically within 1 px.

**F-OBJ-4 · Shapes: presets, flip, arrowheads, connectors.**
- **Presets.** Grow `SHAPES` from 11 to the ~30 most-used PowerPoint presets:
  - basic: parallelogram, trapezoid, octagon, plus/cross, frame, donut, heart, cloud, chord;
  - arrows: right/left/up/down arrow, chevron, homePlate (pentagon arrow);
  - callouts: wedgeRect, wedgeRoundRect, wedgeEllipse;
  - flowchart: process, decision, terminator, document, data, predefined process.
  - Each preset is a clip polygon (or SVG path for curves) plus its `pptx` name. `PRST_TYPE` in the importer derives from it automatically.
- **Flip:** `flipH`/`flipV` on every element.
  - Canvas: `scale(-1)` composed with rotation.
  - Export: pptxgenjs `flipH`/`flipV`.
  - Import: map directly and remove the flip warning.
  - UI: Arrange ▸ Rotate/Flip (Rotate 90° left/right, Flip H/V).
- **Arrowheads:** `arrowStart`/`arrowEnd` on `line`/`path`/connectors, each `none|triangle|stealth|oval|diamond|arrow`, with sizes S/M/L.
  - Canvas: SVG markers.
  - Export: `beginArrowType`/`endArrowType`.
  - Import: `a:headEnd`/`a:tailEnd`, removing the warning.
- **Connectors:**
  - A `connector` element with a `route: 'straight'|'elbow'|'curved'` and optional `from: {elementId, site}` / `to`, re-routed when its endpoints move. Glue is phase 2 polish.
  - Export: elbow/curved as custom geometry.
  - Import: `bentConnector*`/`curvedConnector*` as real routes; drop the elbow approximation for curved connectors.
- **Freeform:** the import of `custGeom` paths becomes a `path` element with closed or filled support (`closed: bool`, `fill`), replacing "custGeom → rect".

**F-OBJ-5 · Arrange & selection.**
- **Commands:**
  - Bring forward / Send backward (one step);
  - Front / Back;
  - Align to slide | to selection (toggle);
  - Distribute horizontally / vertically (explicit axis);
  - Select all.
- **Selection pane** (View): the slide's element list in z-order. It supports rename (`name`), hide-in-editor (`hidden`), lock (`locked`) and drag-to-reorder z.
- `name` is also the default alt-text candidate and the accessibility reading order.

**F-OBJ-6 · Shared asset store.**
- **Model:** `deck.assets: {[id]: {src, mime, w, h, bytes}}`. Image elements and backgrounds reference `assetId` instead of embedding a data URL. Inline `src` stays valid for back-compat.
- **Sync:** assets are pushed once (`PUT /api/deck` diff or `/api/assets`), not per keystroke.
- **Import:** dedupe by part path and hash, so master art on 40 slides is stored once. This removes the "repeated pictures" warning.
- **Export:** pptxgenjs 3.12 dedupes media only *within a slide*. `addImage` looks up the current slide's `_relsMedia` and otherwise writes a new slide-specific media target ([gen-objects.ts L431–466](https://github.com/gitbrent/PptxGenJS/blob/v3.12.0/src/gen-objects.ts#L431-L466)), so the API alone still writes a 40-slide logo 40 times. A **media-dedupe patch** in `pptxPost.js` (F-EXP-1) fixes this:
  1. hash every `ppt/media/*` part;
  2. keep one part per hash;
  3. rewrite each `ppt/slides/_rels/slideN.xml.rels` (and layout/master rels) `Target` to the survivor;
  4. delete the duplicates and their `[Content_Types].xml` overrides.
  - The acceptance test exports an asset used on 40 slides and asserts exactly one `ppt/media` part, with every slide rel pointing at it.
- **Acceptance criteria:** importing a 40-slide deck with a logo master stores one copy, and undo history does not duplicate images.

### 3.3 Slides & show — `F-SLD`

**F-SLD-1 · Hidden slides.**
- **Model:** `slide.hidden: bool`.
- **UI:** thumbnail/sorter context menu → Hide slide; the hidden thumbnail is dimmed with a slashed number.
- **Presenter:** skips hidden slides. A go-to can still reach them.
- **Export:** pptxgenjs `slide.hidden = true` (3.12 supports it), which writes `<p:sld show="0">`.
- **Import:** `show="0"` becomes `hidden`, removing the warning.

**F-SLD-2 · Header & footer.**
- **Model:** `deck.footer {text, slideNumber:bool, date: {mode:'fixed'|'auto', value?, format?}, hideOnTitle:bool}`, plus a per-slide override `slide.footer?: false | {…}`.
- **UI:** Insert ▸ Header & footer dialog (PowerPoint's), with Apply / Apply to all.
- **Canvas:** footer, number and date render in the template chrome positions. For `blank`/master slides they render in the master's `ftr`/`sldNum`/`dt` boxes (F-DES-2).
- **Export:** pptxgenjs `slideNumber` plus text boxes, or master placeholders once F-DES-2 lands.
- **Import:** slide-level `ftr`/`dt`/`sldNum` placeholders map to the model (removing the warning). Layout-only ones stay templates.

**F-SLD-3 · Slide size.**
- **Model:** `deck.size {w:1920, h, physical: {cx, cy}}`.
  - The *authoring* space keeps width 1920, so all existing geometry stays valid. `h = round(1920 · cy / cx)`: 1080 for 16:9, 1440 for 4:3, or any custom ratio.
  - `physical` is the slide's real size in **EMU**, kept separately because decks with the same aspect ratio differ physically. For example, PowerPoint's 4:3 is 10 × 7.5 in (9144000 × 6858000), not 13.333 × 10 in; the importer's existing 10 × 7.5 in fixture is one such deck.
  - Presets set both fields: 16:9 = 12192000 × 6858000, 4:3 = 9144000 × 6858000. Imported decks keep the source `p:sldSz` exactly.
- **Code:** `SLIDE_W`/`SLIDE_H` become per-deck reads (`slideDims(deck)`).
- **UI:** Design ▸ Slide size, with "Scale content / Don't scale", as in PowerPoint.
- **Export:** pptxgenjs 3.12's `defineLayout` only *registers* a layout. The export must:
  1. call `pptx.defineLayout({name: 'STAGECRAFT', width: physical.cx / 914400, height: physical.cy / 914400})` — sizes in inches, from the stored physical size and not from the authoring px. Element geometry scales by `physical.cx / 1920` EMU per px.
  2. then **select** it with `pptx.layout = 'STAGECRAFT'`. Without this step the file silently stays at the default size.
  - A round-trip test asserts `ppt/presentation.xml` `p:sldSz` equals `deck.size.physical` exactly, including a 10 × 7.5 in source.
- **Import:** use the source `sldSz` instead of letterboxing, removing the warning.

**F-SLD-4 · Slide show.**
- Present ▾: From beginning / From current (⇧⌘⏎).
- Go to slide (type a number + Enter; G opens a slide grid).
- W = white screen (B already exists).
- Real elapsed clock with Reset; optional rehearsal target.
- Ephemeral pen/highlighter ink (not saved).
- Hidden-slide skip (F-SLD-1).
- Animation playback (F-MOT-2).
- **Later:** a dual-screen presenter. `window.open` an audience view synced over `BroadcastChannel`; the presenter keeps notes, next slide and timer.

**F-SLD-5 · New slide with layout & reuse.**
- **New slide ▾** opens the layout gallery: built-in semantic layouts plus master layouts (F-DES-2).
- Reuse slides: insert slides from another library deck or a `.pptx`, via the importer, keeping either the source or the destination formatting.

### 3.4 Design — `F-DES`

**F-DES-1 · Theme object.**
- **Model:** `deck.theme` becomes `{name, colors: {dk1, lt1, dk2, lt2, accent1…6, hlink, folHlink}, fonts: {major, minor}}`.
  - The six legacy theme strings map to built-in theme presets, so `normalizeDeck` migrates them.
  - Colour values may be a hex or a **scheme ref** `{scheme:'accent1', lumMod?, lumOff?}`, resolved at render and export time. Re-theming then recolours imported content the way PowerPoint does.
  - Theme fonts are referenced as `+mj`/`+mn` in `fontFamily`.
- **UI:** Design tab:
  - theme gallery;
  - **Colours** editor (the 12 slots);
  - **Fonts** pair;
  - **Variants** (built-in colour/font sets).
  - Colour pickers show a "Theme colours" row with tints, as in PowerPoint.
- **Export:** pptxgenjs `theme: {headFontFace, bodyFontFace}`. Scheme refs export as resolved hex in v1, and as `schemeClr` via `pptxPost.js` in v2.
- **Import:** keep the source theme (today it is resolved and discarded) and keep scheme refs on imported fills and text.

**F-DES-2 · Masters & layouts as data.**
- **Model:** `deck.masters[{id, name, themeId, clrMap, background, elements[] (furniture), placeholders[{type, idx, x,y,w,h, textDefaults}], layouts[{id, name, background?, clrMapOvr?, showMasterShapes, elements[], placeholders[]}]}]`.
  - **Themes per master.** F-DES-1's theme object lives in `deck.themes: {[id]: Theme}`, and each master points at one with `themeId`. `deck.theme` becomes the id of the default theme, used by semantic-layout slides and new masters. Scheme refs resolve through the slide's master, its `clrMap`, and the layout's or slide's `clrMapOvr`, exactly as the importer resolves colours today. Importing a deck whose masters use different themes keeps every palette and font pair.
  - **Master-shape visibility.** `layouts[].showMasterShapes` and `slide.showMasterShapes` (default true) carry PowerPoint's `showMasterSp`:
    - A slide with `false` hides both master and layout furniture ("Hide background graphics").
    - A layout with `false` hides the master's furniture on its slides.
    - The renderer, the export (v1: the furniture baked per layout is omitted; v2: `showMasterSp="0"` is written) and import all honour it, with a round-trip test. Without it, logos the importer hides today would reappear once D4 links masters.
  - A slide may set `layoutRef: {masterId, layoutId}`. Its placeholder-backed text elements carry `ph: {type, idx}` and inherit geometry and text style until overridden, as PowerPoint does.
  - The 13 semantic layouts stay as Stagecraft's opinionated components; masters govern free-form slides.
- **UI:** View ▸ **Edit master**: a master/layout editor using the same canvas, which edits `deck.masters`. Slide ▸ Layout lists master layouts. "Reset slide" re-applies the placeholder geometry.
- **Export:** pptxgenjs 3.12 writes a **single** `ppt/slideMasters/slideMaster1.xml`. Each `defineSlideMaster` call becomes a *layout* under that one master ([pptxgen.ts L495–508](https://github.com/gitbrent/PptxGenJS/blob/v3.12.0/src/pptxgen.ts#L495-L508)), so the master hierarchy can't be expressed through its API. Delivery is staged:
  - **v1 (D4):**
    - Export one master. Every layout of every `deck.masters[]` entry goes through `defineSlideMaster` (background, objects, placeholders), and slides use `addSlide({masterName})`.
    - Slides keep their own layout, so what's on each slide survives. The *master grouping* collapses: per-master backgrounds and furniture are baked into each of its layouts, scheme colours are exported resolved through each master's own theme (so nothing is recoloured), and the package's single theme part carries the default theme.
    - Import keeps all masters in the model.
    - Export **warns** "This deck has N slide masters; they are saved as layouts under one master" when `deck.masters.length > 1`. There is no silent collapse.
  - **v2 (D5, after D4):** `pptxPost.js` (F-EXP-1) rebuilds a true multi-master package:
    - writes `slideMasterN.xml` (+ rels, and a `themeN.xml` from that master's `deck.themes[themeId]`, with its `clrMap`) per `deck.masters[]` entry;
    - re-parents each `slideLayout` to its master;
    - updates `p:sldMasterIdLst`, `[Content_Types].xml` and the presentation rels.
  - **Acceptance criteria:**
    - v1: a 2-master corporate deck re-exports with every slide's layout and look intact, and the warning shown.
    - v2: PowerPoint's Slide Master view shows both masters.
- **Import:** keep masters and layouts instead of baking furniture into every slide. Placeholders become `ph`-linked elements. This also removes most of the asset duplication.
- **`.potx`:** the same parts as a `.pptx`. "From template" accepts `.potx` (and `.pptx`) and creates a deck with its masters and no slides.

**F-DES-3 · Format Background.**
- **Model:**
  - `slide.background` is `{kind:'solid', color} | {kind:'gradient', from, to, angle} | {kind:'picture', assetId, fit}`. This generalises `bgColor`, which is migrated.
  - For semantic layouts, the existing scheme (`bg: ink|accent`) is surfaced as the control instead.
- **UI:** Design ▸ Format background, with **Apply to all**.
- **Export:**
  - `background: {color}` / `{data}`;
  - gradient through `pptxPost.js` (`<p:bg><p:bgPr><a:gradFill>`).
- **Import:** gradient backgrounds stop collapsing to their first stop.

### 3.5 Motion — `F-MOT`

**F-MOT-1 · Transitions.**
- **Model:** `{type, duration, direction?, advance: {onClick:bool, afterMs?}}`.
- **Types:** none, fade, push, wipe, split, reveal, cover, uncover, zoom, morph.
- **UI:**
  - Animate tab: effect gallery and direction;
  - "After N s";
  - **Apply to all**;
  - Preview, which plays on the canvas.
- **Presenter:** auto-advance timer.
- **Export:** `<p:transition>` (with `p14`/`p159` extensions for morph) through `pptxPost.js`.
- **Import:** keep the direction and the advance timing.

**F-MOT-2 · Animations.**
- **Model:** `slide.animations: [{id, target: elementId | fieldKey, category:'entrance'|'emphasis'|'exit', effect, start:'click'|'with'|'after', delay, duration, direction?}]`.
  - Effects v1:
    - entrance: appear, fade, fly in, zoom, wipe, float in;
    - emphasis: pulse, grow/shrink, spin;
    - exit: the mirror of each entrance.
  - `builds` is migrated (or dropped, since builds have no target today).
- **UI:**
  - **Animation pane** in the Animate tab: an ordered list with drag-reorder, and start/delay/duration fields.
  - A numbered badge on canvas elements.
  - Preview.
  - The Timeline drawer is rebuilt as a real view of the same list, replacing the mock.
- **Presenter:** a step machine. Each click advances to the next `click` group; `with`/`after` items chain. CSS animations run per element.
- **Export:** `<p:timing>` for the v1 preset IDs through `pptxPost.js`.
- **Import:** `p:timing` main sequence for v1 presets; anything else is warned and dropped.
- **Acceptance criteria:** a title that flies in on click, followed by bullets that fade in after it, plays identically in the presenter and in PowerPoint after export.

### 3.6 Links, review, accessibility — `F-LNK`, `F-REV`

**F-LNK-1 · Hyperlinks.**
- **Model:**
  - run-level `link: {url} | {slideId}`;
  - element-level `link` (a click action on a shape or picture).
- **UI:** ⌘K-free **Insert ▸ Link** (⌘⇧K) dialog: URL or "Place in this deck".
- **Canvas:** links are underlined. ⌘-click opens them while editing; the presenter follows them.
- **Export:** pptxgenjs `hyperlink: {url} | {slide}`.
- **Import:** `a:hlinkClick` via `r:id` → rels target or a slide jump, removing the warning.

**F-REV-1 · Comments.**
- **Model:** `deck.comments: [{id, slideId, anchor?: {elementId}|{x,y}, author, text, createdAt, resolved, replies[]}]`.
- **UI:**
  - inspector **Comments** tab;
  - canvas pins;
  - thumbnail badges (today a mock);
  - resolve / reopen.
- The single-user author comes from Settings, and MCP agents can comment. This is the Reviewer persona's first tool.
- **Export:** legacy comments (`ppt/comments/*`, `commentAuthors.xml`) or modern threaded comments through `pptxPost.js`.
- **Import:** both comment formats; the warning becomes a count.

**F-REV-2 · Accessibility check.** Review ▸ Check accessibility flags:
- missing alt text (F-OBJ-3);
- contrast below 4.5:1 for text over its fill or background;
- slides without titles;
- reading order (selection-pane order, F-OBJ-5).

Each issue links to its fix. Spell-check uses the browser's spellcheck in edit mode (Settings toggle).

### 3.7 View — `F-VIEW`

**F-VIEW-1 · View controls.**
- Notes pane under the canvas (resizable, collapsible), alongside the Notes tab.
- Gridlines/guides toggles in the status bar, bound to settings, plus user guides dragged from the rulers.
- Computed Fit, and zoom beyond 92%.
- Outline view: editable titles and bullets, the classic PowerPoint outline (phase 3).

### 3.8 Export post-processor — `F-EXP-1`

`lib/pptxPost.js` takes the pptxgenjs output (`pptx.write({outputType:'arraybuffer'})`), opens it with JSZip and applies **pure XML patches per slide**. Each patch is unit-tested against fixture XML.

Patches:
- transitions (F-MOT-1);
- timing (F-MOT-2);
- `gradFill` on shapes and backgrounds (removes the "gradient blended to a solid" loss);
- `grpSp` grouping for `groupId` (groups survive in PowerPoint);
- comments (F-REV-1);
- media dedupe across slides (F-OBJ-6);
- scheme colours (F-DES-1 v2).

The patches find their targets through pptxgenjs object names: export sets `objectName`, and the patcher matches the `p:cNvPr name`. Every exported object that a patch may target gets a stable name:
- **Elements:** `objectName = el.id`.
- **Template fields** (semantic-layout text such as a cover title or a list item): `objectName = "<slideId>:<fieldKey>"`, using the same `fieldKey` paths as `slide.fmt` (`title`, `items.2`, `kpis.0.val`, …). Each layout builder in `pptxExport.js` passes it on every `addText`/`addShape` it emits for a field.

The patcher resolves a target, e.g. an F-MOT-2 animation's `target: elementId | fieldKey`, by looking up `el.id` or `"<slideId>:<fieldKey>"` on that slide. An unresolved target fails loudly in tests and is warned at export. A builder test asserts every field-bearing object carries its name.

---

## 4. Delivery plan

Each milestone is one PR, following CLAUDE.md: branch → TDD → `/simplify` → `/code-review` → PR → bot review → merge.

Size: **S** ≤ 1 day · **M** 2–4 days · **L** 1–2 weeks of focused work.

The order is driven by dependencies:
- The command registry unblocks every UI surface.
- **The canvas engine (Phase K, [`CANVAS-EDITOR.md`](CANVAS-EDITOR.md)) comes before the object-model work.** Text in shapes, rich text, tables, charts and preset shapes are built once, on the canvas painter, instead of first in DOM/CSS and then again on canvas.
- Text in shapes and rich text unblock tables, charts, links and find.
- The post-processor unblocks motion, gradients and groups in export.

Order: **A → K → B → C → D → E → F**. A3 lands **before K1**, because its `fill` → `color` migration changes the element contract the scene builder reads. A4 doesn't touch the render path and may run in parallel with K.

### Phase A — UX honesty & foundations (unblocks everything)
| M | Scope | Size | Depends |
|---|---|---|---|
| A1 ✅ | **F-UI-1 command registry**: context-aware element/thumbnail/canvas menus, truthful shortcuts, Ctrl parity, ⌘K palette, generated Shortcuts page, editor PgUp/PgDn | M | — |
| A2 | **F-UI-4 honesty pass 2**: presenter clock/reset, status bar binds, real export size, hide/wire remaining mocks, Start with AI. *Fit/zoom > 92% moves to K5 and Home slide-1 thumbnails to K4: both are rewritten by the canvas engine.* | S | — |
| A3 | **F-UI-3 inspector correctness**: Select primitive (single chevron), text-colour labelling + `fill`→`color` migration, image fit control, chart-type control | S | — |
| A4 | **F-EXP-1 `pptxPost.js` scaffold** + first patches: `grpSp` groups, shape/background `gradFill`, element flips | M | — |

### Phase K — Canvas engine (re-platform rendering and editing)
Full design, options and test strategy: [`CANVAS-EDITOR.md`](CANVAS-EDITOR.md). Konva stage for interaction, officeview's drawing engine (preset geometry, Office gradients, line ends, rich-text layout) for pixels, one framework-free `paintSlide()` for every non-editing surface. Each milestone ships behind a setting until K7.

| M | Scope | Size | Depends |
|---|---|---|---|
| K0 | Spike + decision record: officeview `drawing` subpath export (or vendoring), `konva` + `react-konva@18`, Vitest `paint` + `browser` projects, perf budget | S–M | — |
| K1 | Drawing core: scene builder for elements (slide height read from the deck, never hard-coded, so D3 slide size needs no canvas refactor), preset geometry, fills/gradients/lines/arrows, images (all A3 fit modes: `cover`, `contain`, `stretch`), `paintSlide`, `<SlideCanvas>` (DPR), `ensureAssets` (fonts + image decode; exports await it) | M | K0, A3 |
| K2 | Text engine (officeview layout + measurer, font epochs, layout cache, insets/anchors/**autofit**/bullets) **+ F-TXT-3 model**: `paragraphs`/runs schema, validator, `normalizeDeck` migration, MCP schema, and canvas painting + PPTX export/import of **every** F-TXT-3 run and paragraph property (all run styles, align, level, bullets/numbering, indent/hanging, spacing, line spacing; `link` excepted, C5) | L | K1 |
| K3 | Layouts and content as scenes: 12 layout compilers (`cover`, `agenda`, `divider`, `kpi`, `chart`, `split`, `table`, `text`, `list`, `roadmap`, `risks`, `thanks`; `blank` has no template content and is complete from K1, so all 13 layouts are covered), chart painter (from `chartSpec.js`), roadmap/risks painters, table grid painter; **PPTX layout builders export from the compiled scene** (one geometry source) | L | K2 |
| K4 | Read-only surfaces on canvas: thumbnails/sorter (bitmap cache keyed by a render key that includes deck-wide inputs), presenter, **Home slide-1 cards (U13)**, PDF export via canvas | M | K3 |
| K5 | Konva editor stage: select/drag/guides/Transformer/marquee/draw/pen/context-menu/collab, **zoom + Fit + pan (U8)**; text via DOM overlay for plain-string text only (multi-run text is read-only until K6, [`CANVAS-EDITOR.md`](CANVAS-EDITOR.md) §7) | L | K4 |
| K6 | Canvas-native text editing: caret map, hidden-textarea input + IME, selection, `lib/richText.js` edit operations, rich-run editing (F-TXT-1, editing half of F-TXT-3) | L | K5 |
| K7 | Cut-over: remove DOM renderer, overlay, `modern-screenshot`, flags; update SPEC/CLAUDE.md | S | K6 |

### Phase B — Object model fidelity (round-trip for typical decks)
All B milestones paint and edit through the Phase K engine. B1/B2 shrink because the rich-text model and its export/import (K2), autofit (K2) and in-place editing with `richText.js` (K6) land in Phase K; what remains is text-in-shapes and the full text toolbar.

| M | Scope | Size | Depends |
|---|---|---|---|
| B1 | **F-TXT-2** text inside shapes (one object), insets UI, autofit UI; import as one object; export | S–M | A3, K6 |
| B2 | **F-TXT-3 rich text**, rest: the editing UI only — unified text toolbar (family, strike, sub/sup, highlight, bullets/numbering, indent, clear) driving `richText.js`. No model or export/import work: K2 already owns every property these controls set | M | B1 |
| B3 | **F-OBJ-1 table element** (K3 grid painter, cell text via K6) + Table tab + import/export | M–L | B2 (cell text) |
| B4 | **F-OBJ-2 chart element** (K3 chart painter) + Chart tab + `c:chartSpace` import | M | A3, K3 |
| B5 | **F-OBJ-6 asset store** + import dedupe + sync + export media-dedupe patch | M | A4 |
| B6 | **F-UI-2 insert objects** (toolbar Table/Chart/Text insert elements) | S | B3, B4 |

### Phase C — Formatting & arrange parity
| M | Scope | Size | Depends |
|---|---|---|---|
| C1 | **F-OBJ-4** flip UI + arrowheads + presets (all 187 paint via K1; expose the common ones + adjust handles as Konva anchors) + `custGeom` import as paths | M | A4, K5 |
| C2 | **F-OBJ-3** crop / alt text / lock aspect + Picture tab | M | B5 |
| C3 | **F-OBJ-5** forward/backward, align-to-slide, distribute H/V, Select all, Selection pane | M | A1 |
| C4 | **F-TXT-4 find & replace** + **F-TXT-5 format painter** | M | B2 |
| C5 | **F-LNK-1 hyperlinks** | S–M | B2 |
| C6 | **F-SLD-1 hidden slides** + **F-SLD-2 header & footer** | M | A1, A4 |

### Phase D — Design system parity
| M | Scope | Size | Depends |
|---|---|---|---|
| D1 | **F-DES-1 theme object** + scheme colour refs + Design-tab colour/font editors | L | B2 |
| D2 | **F-DES-3 Format background** (solid/gradient/picture, apply to all) | S–M | A4, B5 |
| D3 | **F-SLD-3 slide size** | M | — |
| D4 | **F-DES-2 masters & layouts as data** (K3's layout compilers become layout definitions) + master editor + import keeps masters + `.potx` templates + Reset slide + **F-SLD-5**; export v1 = one master (multi-master warned) | L | D1, B1, K3 |
| D5 | **F-DES-2 export v2**: true multi-master packages via `pptxPost.js` | M | D4, A4 |

### Phase E — Motion
| M | Scope | Size | Depends |
|---|---|---|---|
| E1 | **F-MOT-1 transitions**: more types, direction, auto-advance, apply to all, export/import | M | A4 |
| E2 | **F-MOT-2 animations**: model + Animation pane + presenter playback + real Timeline | L | A1 |
| E3 | Animation export/import (`p:timing`) | M | E2, A4 |

### Phase F — Show & review
| M | Scope | Size | Depends |
|---|---|---|---|
| F1 | **F-SLD-4** from current, go-to/grid, white screen, ink, real timer | M | C6 |
| F2 | Dual-screen presenter (audience window) | M | F1 |
| F3 | **F-REV-1 comments** (model, panel, pins, import/export) | L | A4 |
| F4 | **F-REV-2 accessibility check** + spell-check + **F-VIEW-1** notes pane, gridlines/guides, editable outline | M | C2, C3 |

**Expected parity after each phase** (Editor / Import / Export 🟢 of the 45-row matrix in POWERPOINT-PARITY.md, rough targets):

| After phase | Editor 🟢 | Import 🟢 | Export 🟢 | What changes for users |
|---|---|---|---|---|
| today | 24 | 14 | 17 | — |
| A | 24 | 14 | 19 | honest UI; groups and gradients survive export |
| K | 24 | 14 | 19 | (fidelity, not new matrix rows) one canvas renderer everywhere: crisp zoom, real thumbnails, Office-accurate shapes/gradients/text wrap, better PDF |
| B | 29 | 22 | 23 | typical decks round-trip text, tables, charts |
| C | 35 | 27 | 29 | PowerPoint-grade formatting and arranging |
| D | 39 | 31 | 32 | corporate templates and masters survive |
| E | 41 | 33 | 35 | transitions and animations round-trip |
| F | 44 | 35 | 37 | show and review features |

Long-tail features remain out of scope: SmartArt editing, equations, media playback, 3D, WordArt, macros.

**Import-only quick wins** (can ride any phase):
- **Unsupported-feature sweep:** warn on the visible formatting the importer still ignores silently:
  - shape effects (`a:effectLst`: shadow, glow, soft edge, reflection);
  - `a:scene3d`/`a:sp3d`;
  - text effects (`a:effectLst` in `rPr`);
  - shape-level `a:pattFill` on lines.

  The outer shadow could map onto the existing element `shadow` field instead of only warning.
- **SmartArt** via its pre-rendered drawing part (`ppt/diagrams/drawing*.xml`, `dsp:` shapes): import as a grouped set of shapes instead of a placeholder.
- **Equations and other `mc:AlternateContent`** via the Fallback picture.

---

## 5. Definition of done, risks, open questions

### Definition of done (every milestone)
1. **One gate, one model.** New fields land in `deckUtils.js` validators, the canvas scene builder/painters (`SlideRenderer` until K7), `pptxExport.js` (and `pptxPost.js`), `pptxImport.js`, the MCP tool schemas and the Co-pilot prompts (`llmClient.js`) **in the same PR**.
2. **Round-trip test.** model → export → import gives the same model, within geometry tolerance, for every new field (fixture-driven, `src/test/pptxFixture.js`).
3. **TDD and coverage.** Red → green → refactor. New modules (`commands.js`, `richText.js`, `pptxPost.js`, …) are added to `coverage.include`, and the 90% gate holds.
4. **Migration.** `normalizeDeck` upgrades persisted decks. Legacy shapes stay readable for one release.
5. **Docs.** SPEC.md tags, the POWERPOINT-PARITY.md matrix and scorecard, and this file's status marks (✅) are updated.
6. **Honesty.** No control ships without a handler. If it isn't ready it's hidden or `SoonTag`ged, and every shortcut it shows is bound.

### Risks
- **Canvas-native rich-text editing (K6)** is the hardest piece: caret mapping, IME, undo coalescing.
  - Mitigation: a pure model library with exhaustive tests; caret geometry from the same layout that paints; edits on the model, never on the surface.
  - Fallback: K5's DOM editing overlay ships until K6 is solid. See [`CANVAS-EDITOR.md`](CANVAS-EDITOR.md) §10 for the other canvas risks (fidelity ownership, memory, accessibility, test migration).
- **pptxgenjs gaps.** Transitions, timing, groups, gradients and comments have no API, and `pptxPost.js` depends on object-name stability across pptxgenjs versions.
  - Mitigation: pin the version, and add a post-processor test that runs on real pptxgenjs output in CI.
- **pptxgenjs structural limits.** Its single-master package and the `defineLayout`/`layout` two-step are known; others may surface.
  - Mitigation: each export feature's acceptance test asserts the generated **XML parts** (`p:sldSz`, `p:sldMasterIdLst`, …), not just the absence of errors.
- **Payload growth.** Rich text and assets grow the synced deck. B5 (asset store) lands before the heavy-content features, and sync diffs by asset.
- **Scope creep from "PowerPoint has it".** Each milestone ships only its F-ids. New asks go into this doc first.

### Open questions (product owner)
1. Should semantic layouts adopt rich runs in template fields (B2 scope), or stay per-field formatted?
2. Masters (D4): should built-in semantic layouts be *expressed* as masters (a larger refactor) or coexist with them (recommended for v1)?
3. Comments (F3): single-user with an author name, or wait for the collaboration backend (PRODUCT-SPEC §12)?
4. Presenter dual-screen (F2): is a second browser window acceptable, or is a native/desktop wrapper planned?
