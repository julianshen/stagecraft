# @stagecraft/odp — experimental native ODP subset

`odpAdapter` implements the `@stagecraft/io` format contract. `importOdp(bytes,
options)` returns `{document, diagnostics}`; `writeOdp(document, options)` returns
`Uint8Array`. Local callers can use bytes/Blob; hosts supply loaders/destinations
through `importDocument` / `exportDocument`. No network resources are fetched.

Supported export: blank slides in section order; plain text frames with font
size/family, bold/italic, alignment and RGB color; solid RGB rectangles/ellipses;
notes; one page aspect ratio. Unsupported element/slide properties and semantic
layouts are rejected. Deck metadata and section names are reported as omitted.
Geometry uses Stagecraft's 1920-wide authoring coordinates. Export writes native
ODF 1.3 content/styles/manifest, with an uncompressed mimetype entry first.

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
