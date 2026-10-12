# Vendored: officeview drawing engine

A pinned, unmodified copy of the Canvas2D drawing engine from
[officeview](https://github.com/julianshen/officeview) (MIT, see `LICENSE`):
preset geometry, Office fills/gradients/lines, and rich-text layout and paint.
`drawing/presets.json` derives from Apache POI (Apache-2.0, see `drawing/LICENSE`
and `drawing/NOTICE.md`). Design context: `docs/CANVAS-EDITOR.md` (Phase K).

- **Do not edit `core/` or `drawing/` by hand.** Fix upstream, then re-sync.
- `officeview.json` is the manifest: the repo, the pinned `commit`, the `entries`
  Stagecraft imports, and the `files` the sync copied (their import closure).
- Re-sync the pin: `node scripts/sync-officeview.mjs`.
  Move the pin: `node scripts/sync-officeview.mjs --ref <sha|branch>`
  (or `--from <local checkout>`). To need another module, add it to `entries`.
- The files are TypeScript. Vite/Vitest strip the types with esbuild; Stagecraft
  itself stays JavaScript and has no `tsc` step. Their only package dependency is
  `fast-xml-parser` (used by the XML-parsing paths).
- `vendor.test.js` checks the manifest matches the files on disk and smoke-tests
  the engine. The vendored code is not under the coverage gate (it carries
  officeview's own tests upstream).
