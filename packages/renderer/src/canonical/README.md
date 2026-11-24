# Canonical canvas boundary

`buildCanonicalScene(document, slideId)` returns a complete immutable authored scene or a whole-slide refusal. Obtain opaque `CanonicalNode` values from that result; callers do not construct painter payloads. `paintCanonicalNode` paints in local CSS pixels; the host applies placement, center rotation, viewport scale and DPR. `paintCanonicalScene` applies placement and rotation for all nodes.

New PPTX slides use the writer's first native layout. A conflicting authored `layoutId` is refused as `inherited-appearance`; native theme resolution retains the linked layout. Native slides are not admitted by this initial surface. Missing authored run color uses `AUTHORED_TEXT_COLOR` from `@stagecraft/core/lib/authoredText.js`, shared with the SVG preview. Theme text-color resolution is deferred.

Horizontal text **spills outside its frame**, including bottom-anchored overflow and `wrap: none`, through the OfficeView painter. Hit testing and selection still use the frame (or the ellipse geometry for ellipse shapes); spilled glyphs do not expand the hit region. Canvas preview does not apply export autofit hints.

Every candidate object must pass core `validateAuthoredObject` before display adaptation. The renderer then applies its additional display-only restrictions (for example, unsupported list formatting). Unknown fields and retained native appearance refuse the entire slide. The core authored schema admits only its exact authored extension marker; it does not admit arbitrary object/run extensions, paragraph/run source references, or text/paragraph extension envelopes.

| Envelope / field | Outcome |
| --- | --- |
| Text object `fill` or `shape` | Refused; these belong to shape objects |
| Rectangular text-bearing shape with solid fill | Supported |
| Text `direction` / `columns` | Refused |
| Paragraph `direction` / `tabs` | Refused |
| Run `baseline` / `hyperlink` | Refused |
| Unknown paragraph/run style fields | Refused |
| Paragraph/run `source`, or run `extensions.pptxAppearance` | Refused by core authored schema |
| Text/paragraph extensions or extra object/run extension keys | Refused by core authored schema |
| Text object without a text body | Refused by core authored schema |
| Shape without a solid fill | Refused by core authored schema |

K2b owns asynchronous lifecycle safety: a late font result must never activate a scene from an obsolete editor/source, slide, revision or request. Integration tests must cover replacement during a pending load, suppress stale completion, and invalidate the paint environment after relevant font changes. The renderer's bounded font wait alone cannot establish ownership. Dispose environments on owner replacement/unmount.
