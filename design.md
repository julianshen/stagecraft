# Stagecraft — Design System

Dense pro presentation tool. Linear/Figma-adjacent — original design, not a clone.

---

## Typography

| Role | Font | Weight | Size range |
|---|---|---|---|
| UI / body | Inter | 400–600 | 11–14px |
| Metadata, numerics, shortcuts | JetBrains Mono | 400–600 | 9.5–20px |
| Slide headlines | Inter | 600 | 72–140px |
| Decorative titles | Fraunces (serif) | 400–600 | editorial only |

Antialiasing: `-webkit-font-smoothing: antialiased` always. Features: `cv11, ss01, ss03`.

---

## Color tokens (CSS custom properties)

### Light theme (default — warm neutral)

```css
--bg:        oklch(0.985 0.004 85)   /* page background */
--bg-2:      oklch(0.965 0.005 85)   /* topbar, panels */
--bg-3:      oklch(0.945 0.006 85)   /* hover states */
--panel:     oklch(1 0 0)            /* floating panels, modals */
--line:      oklch(0.9 0.006 85)     /* primary dividers */
--line-2:    oklch(0.82 0.008 85)    /* heavier borders */
--ink:       oklch(0.22 0.01 85)     /* primary text */
--ink-2:     oklch(0.4 0.008 85)     /* secondary text */
--ink-3:     oklch(0.58 0.007 85)    /* tertiary / muted */
--ink-4:     oklch(0.72 0.006 85)    /* placeholder / disabled */
```

### Dark theme (`[data-theme="dark"]`) — cool charcoal

```css
--bg:        oklch(0.17 0.01 260)
--bg-2:      oklch(0.2  0.01 260)
--bg-3:      oklch(0.235 0.012 260)
--panel:     oklch(0.22 0.012 260)
--line:      oklch(0.3  0.015 260)
--line-2:    oklch(0.38 0.018 260)
--ink:       oklch(0.96 0.008 260)
--ink-2:     oklch(0.82 0.01 260)
--ink-3:     oklch(0.62 0.012 260)
--ink-4:     oklch(0.48 0.012 260)
```

### Accent palettes (set via JS on `:root`)

Default accent is **Indigo**. Configurable to any of:

| Name | Hue | Chroma | CSS |
|---|---|---|---|
| Indigo | 265 | 0.17 | `oklch(0.62 0.17 265)` |
| Amber | 75 | 0.15 | `oklch(0.62 0.15 75)` |
| Emerald | 155 | 0.13 | `oklch(0.62 0.13 155)` |
| Magenta | 335 | 0.18 | `oklch(0.62 0.18 335)` |
| Coral | 25 | 0.17 | `oklch(0.62 0.17 25)` |

Accent tokens derived:
```css
--accent:      oklch(0.62 {chroma} {hue})
--accent-2:    oklch(0.55 {chroma} {hue})          /* pressed / hover */
--accent-wash: oklch(0.62 {chroma} {hue} / 0.08)   /* light: 0.08 / dark: 0.18 */
--accent-ink:  oklch(0.96 0.02 {hue})               /* text on dark accent */
```

### Semantic colors

```css
--success:  oklch(0.62 0.13 155)   /* green */
--warn:     oklch(0.7  0.15 70)    /* amber */
--danger:   oklch(0.6  0.2  25)    /* red */
```

---

## Spacing & metrics

8-point base grid. All sizes in `px`.

### Shell chrome

```css
--topbar-h:    40px   /* compact: 36 / cozy: 44 */
--toolbar-h:   36px   /* compact: 32 / cozy: 40 */
--statusbar-h: 28px   /* compact: 24 / cozy: 32 */
--left-w:      220px  /* compact: 200 / cozy: 240 */
--right-w:     288px  /* compact: 272 / cozy: 312 */
```

### Radii

```css
--radius-s: 4px
--radius:   6px
--radius-l: 10px
```

### Shadows

```css
--shadow-1: 0 1px 0 oklch(0 0 0 / 0.04)
--shadow-2: 0 8px 24px oklch(0 0 0 / 0.08), 0 1px 0 oklch(0 0 0 / 0.04)
--shadow-3: 0 24px 80px oklch(0 0 0 / 0.18), 0 2px 0 oklch(0 0 0 / 0.04)
```

Dark theme multiplies opacities ×5.

---

## Component patterns

### Buttons

| Variant | Background | Text | Use |
|---|---|---|---|
| `ghost` | none (hover: `bg-3`) | `ink-2` | Most toolbar actions |
| `quiet` | none | `ink-3` | Subtle secondary actions |
| `outline` | none + border `line` | `ink-2` | Alternative secondary |
| `primary` | `ink` | `bg` | Modal confirm |
| `accent` | `--accent` | white | Primary CTA (Present) |

Height: **26px** (lg: 32px). Padding: `0 8px`. Font: 12.5px / 500.

### Icon buttons

26×26px, `var(--radius)` border-radius. Color: `ink-3` → hover `ink`, active: accent-wash + accent color.

### Toolbar groups

Groups separated by short centered hairlines (1px × 16px, `var(--line)`). Gap between items: 1px. Between groups: 6px padding-right + 2px margin-right.

### Selects in toolbar

```
height: 26px  padding: 0 7px  font: 12px / 500
border: 1px solid transparent  (hover: bg-3)
```

### Panels (left/right panes)

- Background: `bg-2`
- `pane-header`: 32px, mono uppercase 10.5px, `ink-3`
- `pane-section`: 10px 12px padding, separated by `line`

### Context menu

```
background: panel  border: 1px solid line-2  shadow: shadow-3
border-radius: radius  padding: 6px  min-width: 180px
```
Items: 28px height, `ink-2` → hover `ink` on `bg-3`.

---

## Density system

Set via `[data-density]` attribute on `<html>`:
- `compact` — tightest, for power users
- `default` — standard
- `cozy` — more breathing room

All shell-chrome variables adjust automatically via CSS attribute selectors.

---

## Slide canvas

Slides render at **1920 × 1080** coordinate space and are scaled down via CSS `transform: scale()` inside `<ScaledSlide>`. Never apply media queries or viewport-relative units inside slide content.

### Slide color scheme (inside slide canvas)

Slides use hardcoded light colors (they look like paper/screens):
- Background: `white` or `oklch(0.985 0.004 85)` for white slides
- "ink" slides: `oklch(0.22 0.01 85)` (deep warm charcoal) as background, white text
- "accent" slides: `var(--accent)` background, white text
- Borders inside slides: `#eee` or `#e8e5df`
- Muted text inside slides: `#666`, `#888`

---

## Icon system

Custom SVG path icons, 16×16 viewBox, stroke-only (no fill), `currentColor`. Used as `<Icon name="..." size={14} />`.

Available icons: `chevron-down`, `chevron-right`, `chevron-left`, `chevron-up`, `arrow-right`, `arrow-left`, `plus`, `minus`, `x`, `check`, `search`, `text`, `shape`, `circle`, `line`, `triangle`, `diamond`, `hexagon`, `rounded-rect`, `arrow-shape`, `pentagon`, `image`, `pen`, `grid`, `table`, `list`, `sidebar`, `folder`, `document`, `star`, `bolt`, `sparkle`, `play`, `pause`, `stop`, `layers`, `columns`, `rows`, `lock`, `eye`, `eye-off`, `message`, `share`, `copy`, `trash`, `chart-up`, `chart-bar`, `user`, `palette`, `sun`, `moon`, `comment-dot`, `history`, `settings`, `flag`, `link`, `download`, `upload`, `refresh`, `bold`, `italic`, `underline`, `align-left`, `align-center`, `align-right`, `move`, `zoom-in`, `zoom-out`, `expand`, `key`, `dot`, `menu`, `more-h`, `more-v`, `filter`, `sort`, `magic`, `template`, `presentation`, `outline`, `aspect`, `logic`, `ai`, `frame`, `cursor`, `timeline`, `component`.

---

## Themes (deck themes — separate from app theme)

Deck themes change the accent used inside slide content:

| Theme id | Primary color |
|---|---|
| `indigo` | `oklch(0.62 0.17 265)` |
| `emerald` | `oklch(0.62 0.13 155)` |
| `amber` | `oklch(0.7 0.15 75)` |
| `coral` | `oklch(0.62 0.17 25)` |
| `magenta` | `oklch(0.62 0.18 335)` |
| `slate` | `oklch(0.55 0.05 260)` |

---

## Slide layouts

| Layout id | Description |
|---|---|
| `cover` | Full-bleed dark cover with large title |
| `agenda` | 2-column grid of numbered agenda items |
| `divider` | Section break — dark background, chapter number + title |
| `kpi` | 3-column grid of KPI metric cards |
| `chart` | Title + chart area (line/bar/area/donut) |
| `split` | Two-column — text left, stats right |
| `table` | Title + data table with header row |
| `text` | Title + paragraph body copy |
| `list` | Title + bullet list |
| `roadmap` | Swimlane roadmap timeline (SVG) |
| `risks` | Risk matrix — severity + title + description |
| `thanks` | Closing slide — thanks + contact |

---

## AI & Co-pilot

Provider support (in settings):
- **Anthropic** — Claude Opus 4 / Sonnet 4 / Haiku 3.5
- **OpenAI** — GPT-4o / GPT-4.1 / o3-mini  
- **Google** — Gemini 2.5 Pro / Flash
- **OpenRouter** — 400+ models via one key
- **Local** — Ollama / LM Studio (no key needed)
- **Custom** — OpenAI or Anthropic-compatible endpoint

Settings stored in `localStorage['stagecraft.ai']`:
```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4",
  "apiKey": "sk-...",
  "temperature": 0.7,
  "maxTokens": 2048,
  "baseUrl": "",
  "apiFormat": "anthropic"
}
```

Co-pilot tasks: slide generation, text rewriting, speaker notes, layout suggestions.

---

## MCP HTTP API

Base: `/api` (same origin as the app)

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server health check |
| GET | `/api/mcp` | MCP capabilities manifest |
| POST | `/api/mcp/tools/call` | Execute a tool by name |
| GET | `/api/deck` | Get full deck state |
| PUT | `/api/deck` | Replace deck state |
| GET | `/api/slides` | List all slides |
| POST | `/api/slides` | Add a slide |
| PUT | `/api/slides/:id` | Update a slide |
| DELETE | `/api/slides/:id` | Delete a slide |
| POST | `/api/llm` | LLM proxy call |

MCP tools: `get_deck`, `add_slide`, `update_slide`, `delete_slide`, `reorder_slides`, `set_theme`.
