# @stagecraft/odp — experimental native ODP subset

`odpAdapter` implements the `@stagecraft/io` format contract. `importOdp(bytes,
options)` returns `{document, diagnostics}`; `writeOdp(document, options)` returns
`Uint8Array`. Local callers can use bytes/Blob; hosts supply loaders/destinations
through `importDocument` / `exportDocument`. No network resources are fetched.

Supported export: blank slides in section order; plain text frames with font
size/family, bold/italic, alignment and RGB color; solid RGB rectangles/ellipses;
notes; one page aspect ratio. Unsupported element/slide properties and semantic
layouts are rejected. Document title is stored as ODF `dc:title`; Stagecraft
document id/theme, section id/name/order, slide ids and element ids are stored in a
versioned `meta:user-defined` field named `stagecraft.identity`. Geometry uses
Stagecraft's 1920-wide authoring coordinates. Export writes native ODF 1.3
content/styles/meta/manifest, with an uncompressed mimetype entry first.

The identity field is capped at 256 KiB with bounded section/slide/element counts.
Ids must be valid, unique strings. Import treats the field as untrusted: malformed
or oversized metadata is ignored with an `identity-invalid` diagnostic. A
fingerprint of ordered page names and per-object ODF style tokens, geometry/type
and text digests must still match; otherwise ids are regenerated with `identity-stale` rather than assigned to the
wrong objects. Foreign/legacy ODP files without the field use deterministic
regenerated ids and report `identity-regenerated`. ODF 1.3 Part 3 §4.3.3 defines
`meta:user-defined` for additional document metadata; preservation through a
desktop LibreOffice save has not been natively verified.

Import reads that subset from native ODP files and reports losses. Named paragraph
and graphic style inheritance is resolved for supported properties. Rich text is
flattened, and master artwork, backgrounds, animation, embedded objects, images,
transformed objects and unsupported styling are not preserved. Mixed page aspect
ratios are rejected. Original package bytes are not retained. This is not a full
Impress/PowerPoint compatibility implementation and has not been certified by
opening the output in desktop Office or LibreOffice.

Browser DOMParser is the default XML parser. Server hosts must inject
`options.xml = { parse(text): Document }` with namespace-aware DOM methods
(`childNodes`, `getElementsByTagNameNS`, `getAttributeNS`, `createElement`) and XML
parse errors. DTD/entity declarations are rejected before parsing. Export needs
no DOM. `options.signal`, `maxBytes`, `maxEntries`, `maxEntryBytes`, and
`maxExpandedBytes` follow `@stagecraft/io`. ZIP validation checks actual expanded
sizes but JSZip allocates an inflated entry before checking: process isolation
or a streaming inflater remains necessary for a strict hostile-input memory cap.

OfficeView's ODF length conversion is reused under its MIT license with a separate
pinned attribution in `src/vendor/officeview/`. Existing drawing vendor files are
untouched.
