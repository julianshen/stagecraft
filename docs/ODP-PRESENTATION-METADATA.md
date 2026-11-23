# ODP presentation metadata import

Stagecraft accepts PowerPoint-saved ODP presentation settings without treating them as slides. It retains metadata in the source package; the canonical document still lists only `draw:page` slides. Retention does not implement playback settings, custom-show playback or field evaluation.

## Observed and specified content

The retained PowerPoint 16.115 outputs from the font-slot matrix, PR4 text matrix and four FU-CR rounds all add an empty `presentation:settings` after the pages. No other direct non-page children were observed in those files. The committed native regression fixture records its provenance and hash in `packages/source/test-fixtures/README.md`.

[ODF 1.3 Part 3, §3.6 and §10.9.3](https://docs.oasis-open.org/office/OpenDocument/v1.3/OpenDocument-v1.3-part3-schema.html) permits the following categories. This is a specification inventory, not a claim that LibreOffice was exercised:

| Content | Import policy |
|---|---|
| `draw:page` | Existing slide projection. |
| `presentation:settings`, containing `presentation:show` | Retained opaque; settings/show attributes preserved. Custom shows describe playback order, not additional slide content. `presentation:show` directly under `office:presentation` is rejected. |
| `presentation:header-decl`, `footer-decl`, `date-time-decl` | Retained only when unreferenced by the corresponding `presentation:use-*-name` attributes in content.xml or styles.xml. Referenced declarations are rejected because the reader cannot resolve their visible fields. |
| `table:calculation-settings`, `consolidation`, `content-validations`, `data-pilot-tables`, `database-ranges`, `dde-links`, `label-ranges`, `named-expressions` | Rejected; these are not interpreted by the presentation model and may affect table data. |
| `text:alphabetical-index-auto-mark-file`, `dde-connection-decls`, `sequence-decls`, `user-field-decls`, `variable-decls` | Rejected; their dependent content is not resolved by this reader. |

Other direct children remain rejected with namespace URI and local name in the error. Settings may contain only childless presentation:show elements and whitespace/comments. Declarations may contain character data but no child elements. A misplaced draw:page, frame or paragraph inside allowed metadata is therefore not silently discarded. Namespace prefixes are immaterial; namespace URIs are checked.

## Preservation and limits

A whole-source no-op export is byte-identical. Unedited ZIP parts stay byte-identical. Untouched metadata inside a rewritten XML part retains its parsed elements, attributes, values and child order; serialization may normalize quotes, entity spellings and namespace declarations.

Metadata is not exposed as an editable canonical object. Text edits do not rewrite custom-show or start-page references. Structural slide editing does not maintain those opaque references; applications needing custom-show-aware slide deletion/renaming must not infer that capability from successful import. No external DDE data is fetched by this change. Referenced visible field declarations remain an explicit unsupported case instead of presenting a partial projection as complete.
