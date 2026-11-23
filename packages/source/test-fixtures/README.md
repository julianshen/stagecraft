# Native ODP regression fixture

`powerpoint-16.115-font-slots.odp` is the synthetic six-slide font-slot matrix generated from Stagecraft head `2dc5511ab157eaf127f352691e34995b79713df6`, opened in Microsoft PowerPoint for Mac 16.115 (16.115.26110837), edited (`Control Latin ABC` → `Control Latin ABC!`), saved as ODP, closed and reopened on 2026-11-23/24. It contains no user slide content. Before committing, only `meta.xml` author metadata was anonymised to `Stagecraft Test`. Every other uncompressed ZIP part is byte-identical to the original PowerPoint output, including `presentation:settings` in `content.xml`.

SHA-256: `8387fd09e7e33efe21c25b3f38f776e885235b9d31b585327b61e2d04e5f212a`.

The test hashes the anonymised input, verifies no-op export equality, edits a canonical text run, checks settings retention and other-part byte equality, and reopens the edited output. Synthetic variants of the same package cover custom shows, unused field declarations and rejection boundaries. They are not evidence of LibreOffice behavior.
