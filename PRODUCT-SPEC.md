# Stagecraft — Product & UX Design Spec

> The "why and how it should feel" layer. `SPEC.md` is the engineering ledger (per-feature
> implementation status); `design.md` is the visual token system. This document sits above
> both: product vision, personas, information architecture, end-to-end user journeys, and
> screen-by-screen UX behavior. Where this spec describes something not yet built, it is
> marked ⚪ **planned** and cross-references the `SPEC.md` section that tracks it.

**Companion docs:** `SPEC.md` (feature status + data model) · `design.md` (tokens).

---

## 1. Vision & positioning

**Stagecraft is a keyboard-first, information-dense deck editor for people who build decks
often and fast, with an AI Co-pilot and an agent API as first-class citizens — not a
document-camera clone of PowerPoint, and not a slide-generator toy.**

Three products currently anchor the category, and Stagecraft deliberately sits between them:

| | Chrome-heavy, ribbon UI, huge surface area, optimized for one-off decks by casual users. | Beautiful output, opinionated auto-design, but you can't drive it from code and the editing model is shallow. | Real-time collaboration, familiar PowerPoint-alike, but not built for speed or automation. |
|---|---|---|---|
| **PowerPoint / Keynote** | ✅ full fidelity | ❌ slow, cluttered | ❌ not scriptable |
| **Gamma / Beautiful.ai** | ❌ limited editing | ✅ fast to a first draft | ❌ no agent API |
| **Google Slides** | ✅ collaborative | ❌ generic visual system | ❌ not scriptable |
| **Stagecraft** | 🎯 dense canvas, real direct manipulation | 🎯 AI Co-pilot edits *your* slide in place | 🎯 every operation is an HTTP/MCP call |

### 1.1 Design principles

1. **Density over decoration.** Chrome is small (26–36px controls), information is close
   together, and the UI gets out of the way of the 1920×1080 canvas. Linear/Figma register,
   not a consumer app.
2. **The keyboard is the primary input.** Every frequent action — undo, duplicate, align,
   nudge, copy/paste, group — has a shortcut, and shortcuts work the instant a slide is
   selected. Mouse-only workflows are supported but never assumed.
3. **One canvas, every surface.** The exact same `<Slide>` renderer draws the editor canvas,
   the thumbnail rail, the sorter grid, and the presenter. What you see while editing is
   pixel-identical to what you present and (as close as `pptxgenjs` allows) what you export.
   No separate "preview mode."
4. **The AI edits your slide, not a chat transcript.** Co-pilot output is never a wall of
   text to copy-paste — it's a validated patch applied to the selected slide's real fields.
   The user always sees exactly what changed and can undo it like any other edit.
5. **The app and the agent are the same user.** Anything a human can do through the UI has an
   equivalent MCP tool or REST call, and both write through the same validated patch gate —
   so an agent can never leave the deck in a state the UI itself couldn't produce.
6. **Show status honestly.** Every feature in `SPEC.md` is tagged 🟢/🟡/🔴/⚪. This isn't just
   an engineering ledger — the product itself should never imply a control does more than it
   does (see §9, empty/decorative states).

### 1.2 Non-goals

Unchanged from `SPEC.md` §1.2: no real-time multi-user collab backend, no cloud sync/database
(local JSON snapshot only), no freeform vector drawing engine beyond the current shape/pen
tools. This spec does not propose adding them; where a related UX question comes up (e.g.
comments, presence) it's flagged ⚪ and left out of scope.

---

## 2. Personas & jobs-to-be-done

### 2.1 The Operator
*"I build a board deck or a sales deck every week and I resent every second spent fighting
the tool."*

- Power user of a real productivity app (Linear, Superhuman, Raycast, VS Code). Expects
  instant response, keyboard shortcuts for everything, no modal dead-ends.
- Builds decks from a template or a previous deck, not a blank canvas.
- Wants the AI to draft/rewrite text and re-sequence sections, but wants **manual, granular
  control** over the final pixel — the Co-pilot proposes, the Operator disposes.
- Presents live and rehearses beforehand (speaker notes, timing).
- **JTBD:** "When I have 45 minutes before a meeting, help me turn a rough narrative into a
  dense, on-brand deck without touching a mouse more than I have to."

### 2.2 The Agent
*Not a human — an LLM or script driving the deck through the MCP/REST API, on behalf of an
Operator or autonomously (e.g. "regenerate this deck from the latest metrics").*

- Never touches the DOM. Everything it does goes through `/api/mcp/tools/call` or the REST
  surface (`SPEC.md` §11).
- Needs the same validation guarantees a human editing through the UI gets — a malformed
  patch must be rejected the same way whether it comes from a click or a tool call.
- Its edits must **render live** in a session a human has open, so a human can watch an agent
  build/fix a deck in real time (`useDeckSync`, `SPEC.md` §11.6).
- **JTBD:** "Given a dataset / a set of bullet points / a previous deck, produce or update a
  deck without a human in the loop for every slide."

### 2.3 (Secondary, ⚪ mostly unbuilt) The Reviewer
*A stakeholder who receives a link, leaves a comment on slide 6, and never opens an editor.*
Collaboration is explicitly out of current scope (`SPEC.md` §16) but the persona is named
here because several UX decisions (comment badges already reserved in the thumbnail rail,
the unused "Link" export option) anticipate it. Treat as forward-looking context, not a
committed roadmap item.

---

## 3. Information architecture

```
┌─ Topbar (persistent) ─────────────────────────────────────────────┐
│ Logo · [Files] [Editor] [Sorter]   deck name / search   Settings   │
└──────────────────────────────────────────────────────────────────┘
        │             │            │
        ▼             ▼            ▼
   ┌─────────┐   ┌──────────┐  ┌─────────┐        ┌────────────┐
   │  Home   │   │  Editor  │  │ Sorter  │        │  Settings  │
   │ (Files) │   │          │  │         │        │ (side nav) │
   └─────────┘   └──────────┘  └─────────┘        └────────────┘
        │             │            │
        │             │            │
   deck library   toolbar/thumbs/  grid + outline
   grid/list      canvas/inspector reorder + section CRUD
        │             │            │
        └──────┬──────┴────────────┘
               ▼
        ⌘/Ctrl+Enter → Presenter (full-screen overlay, not a nav destination)
```

- **Views are peers, not a hierarchy** — Files, Editor, and Sorter are three lenses onto the
  same deck (library, single-slide authoring, whole-deck structure), reachable by one click
  each from the topbar tab nav. There's no "back" — the topbar tabs are always live.
- **Presenter is an overlay, not a route.** It suspends the current view rather than
  navigating away from it, so `Esc` always returns to exactly where you were.
- **Settings is a destination, not a modal**, because AI provider configuration and Appearance
  are things a user tunes once and revisits rarely — a full view (with its own left nav) is
  more discoverable than a buried menu, and it avoids interrupting an in-progress edit.
- **The deck is the unit of navigation; the slide is the unit of editing.** Home operates on
  decks. Editor and Sorter operate within one open deck. There is intentionally no
  slide-level URL/deep-link today (single-page app, no router) — see §12 open questions.

---

## 4. Core user journeys

Each journey below is written screen-by-screen, including the empty/error states a real
build must handle. 🟢/🟡/🔴/⚪ tags point at the `SPEC.md` section that implements each step.

### 4.1 Journey — first deck from a template (new user)

1. **Home** loads to the deck grid (`SPEC.md` §7.1). First-run empty state: no decks yet →
   the grid shows only the two "New" cards (Blank / From template) — no placeholder decks,
   no fake data. *(Confirm this empty state exists distinctly from "zero search results";
   today the grid falls back to nothing but doesn't yet show empathetic empty-state copy —
   ⚪ recommend adding a one-line "Create your first deck" prompt above the New cards.)*
2. User clicks **From template** → **Template Picker** opens (`SPEC.md` §14): category chips
   + search, a `TemplatePreview` thumbnail per template so the choice is visual, not a
   dropdown of names.
3. Picking a template **immediately creates a real deck** (`templateDeck()` → `POST
   /api/decks`) with a themed multi-section skeleton already populated with placeholder
   content in layouts that fit the category (e.g. a "Ledger" deck opens with kpi/chart/
   table/risks slides already there) — the user lands in the **Editor** on slide 1, not a
   blank canvas. This is deliberate: an Operator's first 30 seconds should be *replacing*
   placeholder copy, never staring at an empty page deciding what layout to use.
4. From here the journey continues into §4.2 (author + AI) or §4.4 (present).

### 4.2 Journey — the Operator authors a deck under time pressure

This is the primary journey the product optimizes for.

1. **Editor** opens with the left **thumbnail rail** showing every slide grouped by section,
   the **canvas** showing the current slide at whatever zoom fits, and the **right
   inspector** on Design/Properties/Data/Notes/Animate tabs.
2. **Text edits are inline, not modal.** Double-click any field on the canvas (title, body,
   a KPI value, a table cell, a roadmap lane label) → it becomes editable in place with a
   floating format toolbar (bold/italic/underline/size/color) anchored above it (`SPEC.md`
   §7.2.4). There is never a "properties dialog" the user has to open to change a headline.
3. **Structural edits are toolbar-driven and reversible.** Add slide / change layout / add
   table-or-chart / duplicate — every action is one click plus, for anything destructive
   (delete), immediately undoable with `⌘Z` (`SPEC.md` §11.7, 500 ms coalesce window so a
   burst of typing is one undo step, not fifty).
4. **The AI Co-pilot is a drawer, not a takeover.** Opening it (toolbar right group) doesn't
   leave the canvas — suggestion chips ("Tighten this copy," "Add a KPI row," "Generate
   speaker notes") plus a freeform prompt box sit in a side panel while the slide underneath
   stays visible and interactive. A send:
   - Shows a busy state on the drawer only (canvas stays interactive).
   - Returns a **patch**, not prose — the reply visibly changes only the fields the model
     touched, and the drawer confirms *which* fields changed in one line ("Updated title,
     body").
   - On failure (no key configured, rate-limited, network), the drawer shows the specific,
     human-readable reason (`describeLLMError`, `SPEC.md` §11.4) — never a raw error object
     or a silent no-op.
5. **Rearranging is drag, not cut/paste.** Both the thumbnail rail and the Sorter grid
   support drag-to-reorder within and across sections (`SPEC.md` §7.2.3/§7.3). For a large
   restructure, **Rearrange with AI** (Sorter toolbar) sends a compact outline (id + title +
   layout + section) and applies the returned order — useful when the Operator knows the
   narrative should change but doesn't want to drag twenty cards by hand.
6. **Every mutation syncs to the server in the background** (debounced ~300 ms, `SPEC.md`
   §11.6) with no explicit "Save" button — the product's stance is that saving is not a
   decision the user should have to make. *(Known gap: the topbar "Saved" indicator is
   currently 🔴 static — see §9.2; this is the single highest-priority trust-affecting fix in
   this spec, because a dense/fast tool that hides its save state without confirming it
   erodes exactly the trust its speed is supposed to earn.)*

### 4.3 Journey — an Agent drafts or updates a deck

1. An external agent calls `GET /api/mcp` for the tool manifest, then `POST
   /api/mcp/tools/call` with `add_slide` / `update_slide` / `reorder_slides` / `set_theme`
   calls (`SPEC.md` §11.3).
2. Every write bumps the store's `rev` counter. If an Operator has the deck open in a browser
   tab, `useDeckSync`'s poll (`~1.5s`) picks up the new `rev` and **adopts the agent's edit
   live** — the human watches slides update without reloading (`SPEC.md` §11.6). This is the
   product's core "agent and human share one document" guarantee, not just a background sync
   detail: it's what makes "have an agent draft the deck while I watch and steer" a real
   workflow rather than a two-step handoff.
3. Because agent writes and UI writes converge on the **same validated patch gate**
   (`sanitizeSlidePatch`/`applySlidePatch`), a malformed agent write (bad layout, out-of-enum
   severity, non-hex color) is rejected the same way a bad manual edit would be — the agent
   can't corrupt a deck state the UI itself couldn't produce.
4. Conflict policy is intentionally simple: **last-write-wins**, no operational transform. An
   agent and a human editing the *same slide* in the same ~300ms window will race; the
   product accepts this for v1 (single-agent-or-single-human-at-a-time is the assumed usage
   pattern) rather than building CRDT infrastructure for a case that hasn't proven common.
   ⚪ If multi-agent-plus-human-concurrently becomes a real pattern, this is the first thing
   to revisit (see §12).

### 4.4 Journey — rehearse and present

1. From the Editor, `⌘/Ctrl+Enter` (or the toolbar **Present** button) opens **Presenter** as
   a full-screen overlay — it does not navigate away from the Editor underneath, so `Esc`
   returns exactly where the user was (`SPEC.md` §4.2, §7.5).
2. Presenter shows: current slide (scaled) + next slide (small preview, so the presenter
   always knows what's coming), the section label, speaker notes (`slide.notes`, falling back
   to a bundled starter note so a slide is never blank), an elapsed-time clock against a
   40:00 target, and progress dots.
3. **Keyboard-first here too**: `← → space` advance, `Esc` exits, `B` blacks out the screen
   (e.g. to field a question without the deck as a distraction) — no on-screen button is
   required for the core loop.
4. **Laser pointer** tracks the mouse in real slide-percent coordinates so it's accurate at
   any window size or projector resolution (`SPEC.md` §7.5).
5. **Transitions play on advance** if the slide has one authored in the Animate panel — a
   fade/slide/morph CSS entrance, keyed so it re-plays every advance rather than only once.
   This is presenter-only; the PPTX export carries no transition (pptxgenjs has no animation
   API), which is disclosed rather than silently dropped.

### 4.5 Journey — export to PowerPoint

1. Toolbar **Export** → **Export Modal** (`SPEC.md` §13): format chooser (PPTX is the only
   live format; Keynote/PDF/PNG-sequence/MP4/Link are visibly present but close-only —
   product stance: show the eventual surface area, but never let a decorative control look
   functional without a clear affordance that it isn't wired yet, see §9.2).
2. **Range** (From/To, 1-indexed over the flattened slide order) and **Notes**
   (include/exclude speaker notes) are both real and affect the output. Quality/Comments
   toggles are decorative and *should* — this is a vector export; "quality" has no meaning
   until a raster format exists.
3. Export runs entirely client-side (`pptxgenjs` builds the file in-browser) and triggers a
   browser download — no server round-trip beyond a fire-and-forget acknowledgement ping.
4. Every layout, the free-form elements overlay, native charts, and a native roadmap timeline
   export with close visual parity to the canvas (`SPEC.md` §12) — the product's promise
   here is **"what you see is what exports,"** with the few known exceptions (risk severity
   as text+color rather than a native indicator, gradient fills approximated as a solid
   blend) explicitly disclosed in `SPEC.md` rather than discovered by the user after the fact.

### 4.6 Journey — returning user, deck library management

1. **Home** lists every persisted deck (disk-backed JSON snapshot, survives reload/restart,
   `SPEC.md` §17) as cards: cover tint + initials, title, "edited" relative time, and a
   **LIVE** badge on whichever deck is currently open in the Editor.
2. Per-card **⋯ menu**: Rename (inline, sets `deck.title`) and Delete. Opening a card
   activates that deck server-side and the Editor adopts it.
3. ⚪ **List view** exists as a toggle but per-row rename/delete isn't wired yet (grid only) —
   flagged here because it's a real UX gap: a user who prefers list view for a large library
   currently loses the management affordances the grid has.

---

## 5. Screen-by-screen UX specification

### 5.1 Topbar (persistent, all views)

| Region | Content | Behavior |
|---|---|---|
| Left | Logo + tab nav (Files / Editor / Sorter) | Active tab underlined/filled; switching tabs never loses unsaved edits (autosync) |
| Center | Context-dependent: deck name + save indicator (Editor/Sorter), search (Home), "Settings" label | Keeps the topbar single-purpose per view rather than cluttering it with controls only relevant to one screen |
| Right | Settings toggle | Opens the Settings view; toggles back to the previous view on second click |

**Height is a density-controlled token** (36/40/44px compact/default/cozy) — the topbar is
part of the "chrome should shrink, canvas should grow" principle, not fixed chrome.

### 5.2 Home / Files

- **Primary object: the deck card.** Cover tint + initials (derived, not uploaded — no image
  upload flow exists or is planned for deck covers), title, relative edited time, LIVE badge.
  This is deliberately lightweight — no deck-level metadata form, because the product's
  stance is a deck's identity *is* its title and its content, not a separate record.
- **Two "New" entry points are always pinned first**: Blank (instant, zero-friction) and From
  Template (the recommended path per §4.1) — both visually distinct from deck cards (dashed
  border / "+" affordance) so they never get confused with existing content.
- ⚪ **Search, Filter/Edited sort, and the Recent/Starred/Trash sidebar are UI-present but
  not wired.** Product recommendation: search is the highest-value of these to wire next —
  once a library exceeds ~15–20 decks, scanning a grid stops scaling and search becomes the
  primary retrieval method. Starred/Trash imply a data-model change (a flag + soft-delete)
  and should wait for a real signal that users are asking for them.

### 5.3 Editor

The core surface; four coordinated regions that share one deck object.

```
┌─ Toolbar (History | Tools | Insert | Slide | Arrange | Misc | Co-pilot/Export/Present) ─┐
├──────────┬─────────────────────────────────────────────┬──────────────────────────────┤
│  Thumbs  │                  Canvas                       │        Inspector             │
│  (left)  │        (ScaledSlide, 1920×1080 space)         │  Design/Properties/Data/     │
│          │      Ruler + StatusBar (zoom, dims)           │  Notes/Animate tabs           │
└──────────┴─────────────────────────────────────────────┴──────────────────────────────┘
```

- **Toolbar grouping is legibility over density**: hairline separators between History /
  Tools / Insert / Slide / Arrange / Misc groups so a 30-icon toolbar still scans as six
  small decisions, not one long row. Every group's controls are disabled (not hidden) when
  their preconditions aren't met (e.g. Align disabled below 2 selected elements) — the
  Operator should never wonder "did that button disappear or is it just off."
- **Thumbnail rail** is the spatial map of the deck: section-grouped, scrollable, drag to
  reorder. It is the fastest way to jump slides (click) without ever going to Sorter.
- **Canvas** is the only place pixel-precise editing happens: inline text, direct element
  manipulation (select/move/resize/rotate/marquee/group), shape/pen drawing. The right-click
  context menu surfaces the same structural actions the toolbar has (change layout, apply
  theme, duplicate, delete, generate with AI) so a mouse-first user never has to reach for
  the toolbar for common structural moves.
- **Inspector** is scoped to *the current selection*: with nothing selected on the canvas it
  shows slide-level Design/Data/Notes/Animate; with an element selected, Properties takes
  over with that element's geometry/style. This context-switch (rather than always-visible
  tabs for everything) keeps the panel from showing controls that don't apply.
- **Co-pilot** is a drawer, covered in §4.2 step 4 — anchored so the canvas is never fully
  obscured.

### 5.4 Sorter

- **Grid is the primary/default mode**: section-grouped cards at a size where composition
  (not fine text) is legible — this is the "read the deck's shape" view, complementary to
  the Editor's "edit one slide precisely" view.
- **Outline mode** (toggle) is the list/tree equivalent for scanning titles fast in a large
  deck. ⚪ Currently read-only (editing surface is the grid) — noted as a spec gap in
  `SPEC.md` §7.3; product recommendation is to defer making Outline a full second editing
  surface until there's a specific workflow it unlocks that Grid doesn't (e.g. bulk
  section reassignment via multi-select), rather than duplicating drag-reorder logic for its
  own sake.
- **Section CRUD lives here, not in the Editor thumb rail** — New Section / Rename / Delete
  are Sorter-toolbar and section-header actions. This is a deliberate split: the Editor rail
  is for *navigating and light reordering while authoring one slide*; the Sorter is for
  *restructuring the deck itself*. Duplicating full section CRUD into the rail would blur
  that distinction without adding capability (the rail already supports drag-reorder).
- **Rearrange with AI** — see §4.2 step 5.

### 5.5 Presenter (overlay)

Covered in journey form in §4.4. UX notes specific to the screen:

- **Full-bleed, no chrome except what's needed mid-talk** — controls fade/are minimal so the
  audience-facing screen (if mirrored) doesn't show editor furniture.
- **Next-slide preview is always visible**, not a hover-to-reveal — a presenter should never
  have to think about *how* to check what's next.
- **Blackout (`B`) and laser are the only "presentation trick" affordances** — deliberately
  minimal compared to PowerPoint's Presenter View (no ink/pen annotation, no zoom-to-region).
  This matches the product's density principle applied to the one surface where *less* on
  screen is the actual goal.

### 5.6 Settings

- **Left nav, not tabs across the top** — consistent with treating Settings as a small
  sub-application (General / Appearance / AI & Co-pilot / Export defaults / Shortcuts) rather
  than a single crowded form.
- **AI & Co-pilot is the most complex panel** by necessity: provider cards, API key
  (show/hide), Test Connection (with classified failure reasons, not a generic "failed"),
  base URL for endpoint-configurable providers, model picker, temperature/top-p/max-tokens,
  per-task routing. Product stance: **surface real provider errors verbatim where useful**
  (auth vs rate-limit vs network are different user actions) rather than flattening
  everything to "something went wrong."
- **Appearance is fully live** — every control (theme/accent/density/layout) applies
  immediately, no "Apply" button, because trying an accent color is inherently exploratory
  and a confirm step would only add friction to trying five options in ten seconds.
- ⚪ **General and Shortcuts are currently reference/decorative** — General's autosave-style
  toggles don't do anything yet (autosave already happens unconditionally, so these toggles
  are misleading placeholders rather than neutral no-ops — see §9.2), and Shortcuts is a
  static reference list. Product recommendation: either wire General's toggles or remove them
  until they do something, since a non-functional toggle in a settings panel is a worse trust
  signal than an absent one.

---

## 6. Interaction model

### 6.1 The direct-manipulation grammar (canvas)

One consistent vocabulary across every element type (text, shapes, lines, images, freehand
paths):

| Action | Gesture |
|---|---|
| Select one | Click |
| Add to selection | Shift-click |
| Select region | Marquee drag on empty canvas |
| Add region to selection | Shift + marquee |
| Move | Drag any selected member (moves the whole selection) |
| Resize | Drag a handle (8 handles single-element; group frame scales all members proportionally) |
| Rotate | Drag the rotate handle (single or group) |
| Nudge | Arrow keys (1 grid step); Shift+Arrow (×5) |
| Duplicate | ⌘/Ctrl+D |
| Copy / Cut / Paste | ⌘C / ⌘X / ⌘V (cross-slide capable) |
| Delete | Delete / Backspace |
| Group / Ungroup | ⌘/Ctrl+G / ⌘/Ctrl+Shift+G |
| Align (2+) | Toolbar/Arrange buttons |
| Distribute (3+) | Toolbar/Arrange buttons |
| Z-order | Bring to front / send to back |

All of the above are **suppressed while a text field is focused**, so the same physical keys
(⌘C, arrow keys, Delete) fall through to native text editing rather than fighting it
(`SPEC.md` §7.2.4/§9). This is the single most important invariant in the interaction model:
**the canvas hotkeys and the browser's native text-editing hotkeys must never compete for the
same keystroke while a field is being typed in.**

### 6.2 Inline editing pattern

Every piece of slide text — including generated SVG chart/roadmap labels — is editable by
double-click in place, with a floating format toolbar rather than a properties panel. The
principle: **anything you can read on the slide, you can edit where you read it.** The Data
tab (§6.4) exists for structural edits (add/remove/reorder a row) that don't map to "click a
spot on the slide," not as the primary text-editing path.

### 6.3 Undo/redo

A single linear history (not per-panel), 500ms coalescing window, capped at 50 steps, bound
to ⌘Z/⌘⇧Z (and ⌘Y). The product guarantee: **any mutation reachable from the UI — including
AI-applied patches and drag-reorders — is one undo away.** Server/agent writes are not part of
this human undo stack (an agent edit is adopted as new "present" state, matching the "agent
and human share a live document" model in §4.3) — undoing *your own* last action should never
accidentally also revert something an agent just did concurrently.

### 6.4 Structural editing (Data tab) vs. inline editing (canvas)

Two editing surfaces exist on purpose, not by accident:

- **Canvas / inline** — "I know what I want this text to say" — zero navigation, edit where
  you look.
- **Inspector → Data tab** — "I need to add a fourth KPI card" or "reorder these agenda
  items" — anything that changes the *shape* of a collection (count, order) rather than the
  *content* of one field. Chart and roadmap data specifically live here because there's no
  natural "click a spot on the SVG" gesture for "add a data series."

Both routes converge on the same validated patch gate, so neither surface can produce a state
the other can't also produce or repair.

### 6.5 Keyboard shortcut philosophy

`SPEC.md` §4.4 lists what's bound today; the product principle governing *what to bind next*
(as Settings → Shortcuts grows from a static list into a real reference) is: **bind
high-frequency, low-risk actions unconditionally; require a confirming click for anything
destructive across multiple slides** (e.g. delete-section has a disabled-on-last-section
guard rather than a keyboard shortcut at all).

---

## 7. Content model UX — choosing a layout

`SPEC.md` §3.2/§6.3 defines the 12 layouts structurally; this section is the *authoring
guidance* a user (or the AI Co-pilot, via its system prompt) should follow when picking one.
This is currently tacit knowledge in the Layout menu's ordering — ⚪ recommend surfacing it as
short helper copy in the Layout picker itself (one line per option), since a new user
currently has to infer "kpi vs. split vs. chart" from the icon alone.

| Layout | Use it for | Don't use it for |
|---|---|---|
| **cover** | Deck open / section-opening title moment | Content-bearing slides |
| **agenda** | "Here's what we'll cover" — numbered, 2-col | A list with no inherent order (use `list`) |
| **divider** | A hard section break the audience should feel | A soft topic shift within a section |
| **kpi** | 3–9 named metrics with a value + delta + target | A single headline number (use `split`) |
| **chart** | Trend/comparison the audience should read visually | A table of exact values (use `table`) |
| **split** | One narrative point + supporting stats | Two independent topics (use two slides) |
| **table** | Exact values across categories, side-by-side | Trends over time (use `chart`) |
| **text** | A single prose point that needs room to breathe | Bulletable content (use `list`) |
| **list** | 3–7 unordered points | Sequenced steps (use `agenda`/`roadmap`) |
| **roadmap** | Time-boxed workstreams across lanes | A single milestone timeline with no lanes |
| **risks** | Severity-ranked concerns needing a decision | General caveats (use `list`) |
| **thanks** | Deck close / contact | Mid-deck |

---

## 8. Onboarding

- **No tour, no modal walkthrough** — consistent with the "dense tool for frequent users"
  principle: a first-time overlay explaining 30 features is the wrong onboarding for someone
  who's going to live in this tool daily. Onboarding happens through content: a template
  deck's placeholder copy *is* the tutorial (§4.1) — "replace this text" teaches inline
  editing by doing it.
- ⚪ **Recommended addition**: a single dismissible hint on first Editor visit pointing at the
  Co-pilot drawer ("Try: 'tighten this slide'") — the AI feature is the one capability with
  no visual affordance discoverable by exploration alone (everything else is a labeled
  toolbar icon). This is the one piece of proactive onboarding worth the friction; everything
  else should stay discoverable-by-use.

---

## 9. Trust, status, and empty states

### 9.1 Principle

A dense tool earns trust by never lying about its own state. Two categories of surface exist
today and should be visually distinguishable so a user never has to *test* a control to learn
it's inert:

- **Live** — does what it looks like it does.
- **Decorative** (🔴/⚪ in `SPEC.md`) — present but not wired.

### 9.2 Current gaps worth calling out explicitly

These are the decorative surfaces most likely to mislead a user into thinking they've taken
an action they haven't, ranked by how costly the false signal is:

1. **Topbar "Saved" indicator is static.** Autosave is real (§4.2 step 6) but the indicator
   doesn't reflect in-flight vs. synced vs. failed states. A static "Saved" label that never
   changes is worse than no label — it implies a guarantee the UI isn't actually checking.
   **Highest priority fix.**
2. **Settings → General toggles** (e.g. autosave-labeled switches) imply a setting the user
   can turn off, when the behavior they name is already unconditional. Recommend removing
   until wired rather than leaving them clickable-but-inert.
3. **Export Modal's non-PPTX format options** (Keynote/PDF/PNG/MP4/Link) are visible and
   clickable but close the modal with no output. Recommend either graying them with a
   "coming soon" affordance or removing them from the list until built — a click that silently
   does nothing is a worse experience than a visibly disabled option.
4. **Home's search/filter/sort controls** accept input but don't filter anything. Same
   remedy as above once prioritized (§5.2 already flags search as the highest-value one to
   actually wire).

None of these require new capability — they're a UI-truthfulness pass: either wire the
control or visibly disable/remove it. Given `SPEC.md`'s existing 🟢/🟡/🔴 discipline, this is
really "apply the same rigor from the engineering spec to the UI's own honesty."

---

## 10. Accessibility notes

Not exhaustively audited in this pass; flagging what the current architecture implies and
what to verify:

- **Color is never the sole signal** where the product has already addressed it (risk
  severity ships a spelled-out `● {SEV}` label alongside color, both on canvas and export —
  `SPEC.md` §12) — this pattern should be the template for any future severity/status
  encoding (e.g. roadmap lane states).
- **Keyboard-first is inherently accessibility-positive** for motor-impairment and
  power-user cases alike, but only if focus order and visible focus rings are correct across
  the canvas's custom-drawn selection UI (rotate handles, group frames) — ⚪ not verified in
  this pass; recommend a dedicated screen-reader/focus-order audit before calling the canvas
  accessible, since a canvas built from absolutely-positioned divs and SVG easily loses
  native focus semantics even when keyboard shortcuts work for a sighted mouse-and-keyboard
  user.
- **Toast notifications** (`useToasts`, image-upload errors today) are already a
  `role="status"` polite live region — the right pattern; extend it as the single channel for
  any future transient error surface rather than inventing a second one.

---

## 11. Success signals (qualitative, no telemetry today)

Since there's no analytics pipeline in this app, "success" is currently only assessable by
observation/dogfooding, not metrics. If instrumentation is ever added, these are the signals
that would validate the principles in §1.1:

- Time from "open Template Picker" to "first inline edit" (should be seconds, per §4.1).
- Ratio of Co-pilot-drafted fields that survive un-edited vs. get manually rewritten
  afterward (validates whether the Co-pilot's drafts are actually saving time, per §4.2).
- Fraction of structural edits (reorder, section CRUD, layout change) done via keyboard/drag
  vs. via a menu — a low keyboard-shortcut usage rate would contradict the "keyboard is
  primary" principle and suggest shortcuts aren't discoverable enough.
- Frequency of an agent write landing while a human tab is open (validates §4.3's "shared
  live document" bet is actually being exercised, not just theoretically supported).

---

## 12. Open product questions

Flagged rather than answered, for a follow-up decision:

1. **Deep-linking to a specific slide.** No URL scheme exists for "open deck X, slide Y"
   today (§3). Worth revisiting once/if decks are shared outside a single browser session.
2. **Concurrent editing beyond one agent + one human.** Last-write-wins (§4.3) is a
   deliberate v1 simplification; revisit if multi-agent-concurrent or multi-human-concurrent
   becomes a real usage pattern.
3. **List-view parity in Home** (§4.6) — worth wiring rename/delete before promoting List as
   an equally-supported mode, or otherwise signal that Grid is the supported view.
4. **Comment/presence infrastructure** — several UI seams already anticipate it
   (comment badges reserved on thumbnails, `CollabLayer`, the Reviewer persona in §2.3) but
   it's explicitly out of scope per `SPEC.md` §16. This spec doesn't propose reversing that;
   it's named so a future decision to build it has a persona and seam already identified.
