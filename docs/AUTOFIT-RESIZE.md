# Export-only PPTX resize hints

`source.export(document, { resize })` accepts a `Map<objectId, { height }>` or a record of the same values. Height is a positive integer in EMU. This low-level option consumes a host measurement; it does not measure fonts or change the editor document, revision or undo history. Renderer measurement and editor integration are separate work.

Hints apply only to top-level, writable, unrotated rectangular PPTX text boxes whose snapshot body layout is `autofit: 'resize'`. They grow the existing height; smaller heights, unsupported targets and malformed hints throw `Invalid resize measurement`. Empty maps and same-height entries make no change. Native eligibility is checked against the privately retained source, not caller-provided flags. Signed sources still reject edits. ODP, groups, flips, vertical text, nonrectangular/custom/adjusted geometry, unresolved native metric layouts and `wrap: 'none'` are unsupported.

The exported width and x remain fixed. Top anchors preserve y; middle anchors preserve the center (rounded to integer EMU); bottom anchors preserve the bottom. **The new y may be negative: the box may extend above the slide or overlap nearby objects.** No neighboring objects move. The canonical document and canvas retain the drawn size. PowerPoint may subsequently grow or shrink the frame when its text is edited; the exported `a:spAutoFit` remains in place.

Measure the same immutable document snapshot that is passed to export. The exporter captures document and hint values before its first await and merges effective growth through its ordinary geometry writer. Other geometry fields and text formatting are retained. With no effective edits, export stays byte-identical; untouched ZIP parts stay byte-identical on edits, while untouched XML within rewritten parts is preserved semantically.

The existing `fit` shrink option is unchanged and can accompany resize hints for different objects. No font-size or shrink-scale change is introduced by `resize`.

Theme `a:objectDefaults` are not resolved into canonical layout. If the applicable `txDef` (text box) or `spDef` (shape) has nonempty `bodyPr` or `lstStyle`, native text metrics are conservatively unsupported, even when some local properties override them. This protects both resize eligibility and shrink measurement; empty defaults and defaults for the other object kind do not disable measurement. The theme XML remains untouched.

The reader records this eligibility summary as read-only `theme.extensions.pptxObjectDefaults` flags (`txDef` / `spDef`, true means unsupported inherited defaults). New authored resize targets are checked against the retained theme as well; new slides use the first retained layout, matching the source writer. Caller edits to these appearance flags cannot grant resize eligibility.
