import { describe, it, expect } from 'vitest';
import { importClosure, relativeImports } from './vendorClosure.mjs';

// An in-memory source tree: path → contents.
const tree = (files) => (p) => (p in files ? files[p] : null);

describe('relativeImports', () => {
  it('lists relative import/export specifiers, value and type-only alike, ignoring packages', () => {
    const src = [
      "import { a, type B } from './a'",
      "import type { C } from '../core/c'",
      "export { d } from './d'",
      "export * from './e'",
      "import presets from './presets.json'",
      "import { XMLParser } from 'fast-xml-parser'",
      "import {",
      "  f,",
      "  g,",
      "} from './fg'",
    ].join('\n');
    expect(relativeImports(src)).toEqual(['./a', '../core/c', './d', './e', './presets.json', './fg']);
  });
});

describe('importClosure', () => {
  it('walks relative imports from the entries, resolving extensionless and index modules', () => {
    const read = tree({
      'drawing/paint.ts': "import { s } from './style'\nimport type { G } from './geometry'",
      'drawing/style.ts': "import { x } from '../core/xml'",
      'drawing/geometry.ts': "import data from './presets.json'\nimport { f } from '../core/fonts'",
      'drawing/presets.json': '{}',
      'core/xml.ts': "import { XMLParser } from 'fast-xml-parser'",
      'core/fonts/index.ts': '',
      'drawing/unused.ts': '',
    });
    expect(importClosure(read, ['drawing/paint.ts'])).toEqual([
      'core/fonts/index.ts',
      'core/xml.ts',
      'drawing/geometry.ts',
      'drawing/paint.ts',
      'drawing/presets.json',
      'drawing/style.ts',
    ]);
  });

  it('throws on an import it cannot resolve, so a sync never vendors a broken tree', () => {
    expect(() => importClosure(tree({ 'a.ts': "import { b } from './missing'" }), ['a.ts'])).toThrow(/a\.ts.*\.\/missing/);
  });

  it('throws on a missing entry', () => {
    expect(() => importClosure(tree({}), ['nope.ts'])).toThrow(/nope\.ts/);
  });
});
