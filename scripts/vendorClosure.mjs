// What a vendored copy needs: every module reachable from the entry points
// through relative imports, and the npm packages those modules import. Pure —
// files are read through `read(path) → contents | null` (paths relative to
// the source root, '/'-separated), each at most once.
import path from 'node:path';

// `import … from '…'` / `export … from '…'` (multi-line clauses included).
const FROM = /\b(?:import|export)\s[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g;

/** The specifiers a module imports or re-exports from. */
export const importSpecifiers = (src) => [...src.matchAll(FROM)].map((m) => m[1]);

// A bare specifier's package: `pkg` or `@scope/pkg`, without any subpath.
const packageOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

/** `{ files, packages }` reachable from `entries`, both sorted. Throws on an unresolvable import or entry. */
export function importClosure(read, entries) {
  const contents = new Map();
  const load = (p) => {
    if (!contents.has(p)) contents.set(p, read(p));
    return contents.get(p);
  };
  // The file a relative specifier names: as written, or with .ts / /index.ts appended.
  const resolve = (from, spec) => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    return [base, `${base}.ts`, `${base}/index.ts`].find((p) => load(p) !== null);
  };

  const files = new Set();
  const packages = new Set();
  const visit = (file) => {
    if (files.has(file)) return;
    files.add(file);
    if (file.endsWith('.json')) return;
    for (const spec of importSpecifiers(load(file))) {
      if (!spec.startsWith('.')) {
        packages.add(packageOf(spec));
        continue;
      }
      const dep = resolve(file, spec);
      if (!dep) throw new Error(`${file}: cannot resolve ${spec}`);
      visit(dep);
    }
  };
  for (const e of entries) {
    if (load(e) === null) throw new Error(`missing entry ${e}`);
    visit(e);
  }
  return { files: [...files].sort(), packages: [...packages].sort() };
}
