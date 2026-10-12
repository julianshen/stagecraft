// The set of source files a vendored copy needs: every module reachable from
// the entry points through relative imports. Pure — files are read through
// `read(path) → contents | null`, with paths relative to the source root and
// '/'-separated.
import path from 'node:path';

// `import … from '…'` / `export … from '…'` (multi-line clauses included).
const FROM = /\b(?:import|export)\s[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g;

/** The relative specifiers a module imports or re-exports from. */
export const relativeImports = (src) => [...src.matchAll(FROM)].map((m) => m[1]).filter((s) => s.startsWith('.'));

// The file a specifier names: as written, or with .ts / /index.ts appended.
function resolve(read, from, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return [base, `${base}.ts`, `${base}/index.ts`].find((p) => read(p) !== null) ?? null;
}

/** Every file reachable from `entries`, sorted. Throws on an unresolvable import or entry. */
export function importClosure(read, entries) {
  const seen = new Set();
  const visit = (file, importer) => {
    if (seen.has(file)) return;
    const src = read(file);
    if (src === null) throw new Error(importer ? `${importer}: cannot resolve ${file}` : `missing entry ${file}`);
    seen.add(file);
    if (file.endsWith('.json')) return;
    for (const spec of relativeImports(src)) {
      const dep = resolve(read, file, spec);
      if (!dep) throw new Error(`${file}: cannot resolve ${spec}`);
      visit(dep, file);
    }
  };
  for (const e of entries) visit(e, null);
  return [...seen].sort();
}
