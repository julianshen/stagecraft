# Export-time shrink measurement

`@stagecraft/renderer` exports synchronous `measureShrinkFits(document, { fonts, canvas? })` and frozen `SHRINK_FIT_POLICY`. It returns a `Map<objectId, {fontScale, lnSpcReduction}>` for the source export API:

```js
await window.document.fonts.ready;
const fit = measureShrinkFits(snapshot.document, { fonts: window.document.fonts });
const result = await source.export(snapshot.document, { fit });
```

`waitForShrinkFonts(document, { fonts, timeoutMs? })` loads eligible snapshot fonts, including hidden-slide script faces, and returns a readiness boolean (default limit: 2000ms). It shares font resolution with measurement. Custom hosts can use it before calling `measureShrinkFits`, or load the needed fonts themselves. Loading fonts, an unsuccessful `FontFaceSet.check`, or a missing canvas context produces an empty Map. Browser font readiness does not prove that an Office font is installed; the existing canvas font stack supplies substitutions. Headless callers may omit measurement. PresentationEditor uses this path for writable PPTX sources with text-body-layout capability. It waits up to two seconds for the captured snapshot’s fonts; timeout or failure exports without fit. Measurement and export use the same immutable snapshot even while the user continues editing.

The pure canonical adapter maps explicit run sizes and font slots, paragraph alignment/spacing/indents, body insets, wrap and anchor into officeview text layout. It uses the authored frame, DrawingML default insets (0.1 inch horizontal, 0.05 inch vertical), and real Canvas2D metrics. CRLF across adjacent or empty runs is one display break. Canonical snapshots and source font references are never modified.

PPTX theme entities expose read-only `extensions.pptxFontScheme` with `major`/`minor`, each containing `latin`, `eastAsian`, `complexScript`, and `supplemental` script names. The slide → layout → master → theme links select the scheme; new authored slides use the first native layout, matching the source writer. Omitted font slots inherit independently; `+mn-*`/`+mj-*` remain references and are resolved only for measurement. A shape's `extensions.pptxTextMetrics` records its major/minor font reference and whether its native metrics are supported. These appearance records are not editable source data.

Only plain rectangular geometry (or an absent preset for a default text box) is measured. Other presets, custom geometry, and preset adjustments are skipped because their shape-specific text rectangles are not projected; authored nonrectangular shapes are skipped too.

Native placeholders, custom master/presentation defaults (including inherited non-neutral language), paragraph/list font defaults, theme overrides, vertical text, columns, tabs, fields, nonzero list levels, non-projected spacing and other unsupported native metrics are skipped. Missing explicit run size, unresolved theme fonts, bullet semantics and group-relative geometry also skip measurement. An unknown script face is not inferred from a Latin-only font override. ODP is excluded. Empty text and text already fitting at 100% produce no entry.

Overflowing text is tested in descending font-scale order, with line reductions 0, 10000, and 20000 at each scale. Candidate scaling is explicit; officeview automatic fitting is disabled. The first candidate whose text height is at most 97% of available height wins. If none fits, the floor is emitted, so a result is not a guarantee against overflow. Width overflow with `wrap: none` is outside this height-only test. Point paragraph spacing scales with the candidate; insets and indents do not.

The exported policy uses 7500 scale decrements from 100000 to 25000. Native PowerPoint for Mac 16.115 (26110837) samples observed 92500, 85000, 77500, 62500, 40000 and 25000; three extreme-overflow probes stopped at 25000/20000. This supports the chosen step family and floor for this version, not exact algorithm parity or verification of every intermediate step. Browser and native metrics differ: the retained PR4 sample measured 77500/10000 here versus native 85000/10000.

The canonical editor currently uses DOM/SVG text. It does not share this adapter yet; preview/measurement unification belongs to the later canonical canvas work. Tests establish adapter/layout/candidate consistency, not preview parity. Source export still applies fit only to changed/authored eligible shrink objects, preserving its no-op and untouched-part guarantees.
