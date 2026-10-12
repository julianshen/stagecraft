import { describe, it, expect } from 'vitest';
import { importClosure, importSpecifiers } from './vendorClosure.mjs';

// An in-memory source tree: path → contents.
const tree = (files) => (p) => (p in files ? files[p] : null);

describe('importSpecifiers', () => {
  it('lists import/export specifiers, value and type-only, single- and multi-line', () => {
    const src = [
      "import { a, type B } from './a'",
      "import type { C } from '../core/c'",
      "export { d } from './d'",
      "export * from './e'",
      "import presets from './presets.json'",
      "import { XMLParser } from 'fast-xml-parser'",
      "import {",
      '  f,',
      '  g,',
      "} from './fg'",
    ].join('\n');
    expect(importSpecifiers(src)).toEqual(['./a', '../core/c', './d', './e', './presets.json', 'fast-xml-parser', './fg']);
  });

  it('includes side-effect and dynamic imports', () => {
    expect(importSpecifiers("import './polyfill'\nconst m = await import('./lazy')\nimport \"pkg/side\"")).toEqual(['./polyfill', './lazy', 'pkg/side']);
  });

  it('ignores imports inside comments, but not comment-like text inside strings', () => {
    const src = [
      "// import { old } from './old'",
      "/* export * from './gone'",
      "   import './gone-too' */",
      "const url = 'https://example.com/x' // trailing comment",
      "import { real } from './real'",
    ].join('\n');
    expect(importSpecifiers(src)).toEqual(['./real']);
  });
});

describe('importClosure', () => {
  it('walks relative imports from the entries (extensionless and index modules) and collects package imports', () => {
    const read = tree({
      'drawing/paint.ts': "import { s } from './style'\nimport type { G } from './geometry'",
      'drawing/style.ts': "import { x } from '../core/xml'",
      'drawing/geometry.ts': "import data from './presets.json'\nimport { f } from '../core/fonts'",
      'drawing/presets.json': '{}',
      'core/xml.ts': "import { XMLParser } from 'fast-xml-parser'\nimport { y } from 'fast-xml-parser/src/y'",
      'core/fonts/index.ts': "import type { T } from '@scope/pkg/types'",
      'drawing/unused.ts': "import z from 'not-reached'",
    });
    expect(importClosure(read, ['drawing/paint.ts'])).toEqual({
      files: ['core/fonts/index.ts', 'core/xml.ts', 'drawing/geometry.ts', 'drawing/paint.ts', 'drawing/presets.json', 'drawing/style.ts'],
      packages: ['@scope/pkg', 'fast-xml-parser'],
    });
  });

  it('reads each path at most once, however many modules import it', () => {
    const files = { 'a.ts': "import { b } from './b'\nimport { c } from './c'", 'b.ts': "import { c } from './c'", 'c.ts': '' };
    const seen = [];
    importClosure((p) => (seen.push(p), p in files ? files[p] : null), ['a.ts', 'b.ts']);
    expect(seen.length).toBe(new Set(seen).size);
  });

  it('throws on an import it cannot resolve, so a sync never vendors a broken tree', () => {
    expect(() => importClosure(tree({ 'a.ts': "import { b } from './missing'" }), ['a.ts'])).toThrow(/a\.ts.*\.\/missing/);
  });

  it('throws on a missing entry', () => {
    expect(() => importClosure(tree({}), ['nope.ts'])).toThrow(/nope\.ts/);
  });
});
