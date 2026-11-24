# Canonical canvas boundary

`buildCanonicalScene(document, slideId)` returns a complete immutable authored scene or a whole-slide refusal. Obtain opaque `CanonicalNode` values from that result; callers do not construct painter payloads. `paintCanonicalNode` paints in local CSS pixels; the host applies placement, center rotation, viewport scale and DPR. `paintCanonicalScene` applies placement and rotation for all nodes.

New PPTX slides use the writer's first native layout. A conflicting authored `layoutId` is refused as `inherited-appearance`; native theme resolution retains the linked layout. Native slides are not admitted by this initial surface. Missing authored run color uses `AUTHORED_TEXT_COLOR` from `@stagecraft/core/lib/authoredText.js`, shared with the SVG preview. Theme text-color resolution is deferred.

Horizontal text **spills outside its frame**, including bottom-anchored overflow and `wrap: none`, through the OfficeView painter. Hit testing and selection still use the frame (or the ellipse geometry for ellipse shapes); spilled glyphs do not expand the hit region. Canvas preview does not apply export autofit hints.

The supported envelopes are deliberately closed. Unknown fields refuse the entire slide; `extensions` remains opaque host data and is never passed to the painter.

| Envelope / field | Outcome |
| --- | --- |
| Text object `fill` or `shape` | Refused; these belong to shape objects |
| Rectangular text-bearing shape with solid fill | Supported |
| Text `direction` / `columns` | Refused |
| Paragraph `direction` / `tabs` | Refused |
| Run `baseline` / `hyperlink` | Refused |
| Unknown paragraph/run style fields | Refused |
| Text / paragraph / run `extensions` | Retained as opaque metadata; no rendering semantics |

K2b owns asynchronous lifecycle safety: a late font result must never activate a scene from an obsolete editor/source, slide, revision or request. Integration tests must cover replacement during a pending load, suppress stale completion, and invalidate the paint environment after relevant font changes. The renderer's bounded font wait alone cannot establish ownership. Dispose environments on owner replacement/unmount.
