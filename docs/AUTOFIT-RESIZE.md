# Export-only PPTX resize hints

`source.export(document, { resize })` accepts a `Map<objectId, { height }>` or a record of the same values. Height is a positive integer in EMU. This low-level option consumes a host measurement; it does not measure fonts or change the editor document, revision or undo history. Renderer measurement and editor integration are separate work.

Hints apply only to top-level, writable, unrotated rectangular PPTX text boxes whose snapshot body layout is `autofit: 'resize'`. They grow the existing height; smaller heights, unsupported targets and malformed hints throw `Invalid resize measurement`. Empty maps and same-height entries make no change. Native eligibility is checked against the privately retained source, not caller-provided flags. Signed sources still reject edits. ODP, groups, flips, vertical text, nonrectangular/custom/adjusted geometry, unresolved native metric layouts and `wrap: 'none'` are unsupported.

The exported width and x remain fixed. Top anchors preserve y; middle anchors preserve the center (rounded to integer EMU); bottom anchors preserve the bottom. **The new y may be negative: the box may extend above the slide or overlap nearby objects.** No neighboring objects move. The canonical document and canvas retain the drawn size. PowerPoint may subsequently grow or shrink the frame when its text is edited; the exported `a:spAutoFit` remains in place.

Measure the same immutable document snapshot that is passed to export. The exporter captures document and hint values before its first await and merges effective growth through its ordinary geometry writer. Other geometry fields and text formatting are retained. With no effective edits, export stays byte-identical; untouched ZIP parts stay byte-identical on edits, while untouched XML within rewritten parts is preserved semantically.

The existing `fit` shrink option is unchanged and can accompany resize hints for different objects. No font-size or shrink-scale change is introduced by `resize`.
