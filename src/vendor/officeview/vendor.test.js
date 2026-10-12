// The vendored officeview engine loads as plain TypeScript through Vite/Vitest
// (esbuild strips the types; no tsc step) and covers what Phase K builds on.
import { describe, it, expect } from 'vitest';
import { resolvePreset } from './drawing/geometry';
import { layoutTextBody } from './drawing/text-layout';
import { SHAPES } from '../../lib/shapes.js';
import { importClosure } from '../../../scripts/vendorClosure.mjs';
import manifest from './officeview.json';
import pkg from '../../../package.json';

// The vendored files on disk, by path relative to this folder.
const vendored = Object.fromEntries(Object.entries(import.meta.glob(['./core/**', './drawing/**'], { query: '?raw', import: 'default', eager: true }))
  .map(([p, src]) => [p.slice(2), src]));
const closure = importClosure((p) => vendored[p] ?? null, manifest.entries);

describe('vendored officeview', () => {
  it('is pinned to a full commit and holds exactly its entries\' import closure (+ licence files)', () => {
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(vendored).sort()).toEqual([...closure.files, ...manifest.extraFiles].sort());
  });

  it('imports only packages Stagecraft installs as runtime dependencies', () => {
    expect(closure.packages.filter((p) => !(p in pkg.dependencies))).toEqual([]);
  });

  it('resolves the preset geometry of every Stagecraft shape', () => {
    for (const [type, { pptx }] of Object.entries(SHAPES)) {
      const g = resolvePreset(pptx, 200, 100);
      expect(g.issues, type).toEqual([]);
      expect(g.paths.length, type).toBeGreaterThan(0);
      expect(g.paths[0].commands[0].kind ?? g.paths[0].commands[0][0], type).toBeDefined();
    }
  });

  it('lays out text headlessly through an injected measurer (no canvas needed)', () => {
    const body = {
      paragraphs: [{ runs: [{ text: 'aaa bbb ccc', fontSizePt: 10 }], align: 'left', level: 0 }],
      anchor: 't', insetLeftEmu: 0, insetRightEmu: 0, insetTopEmu: 0, insetBottomEmu: 0, wrap: true,
    };
    const measure = (text) => ({ width: text.length * 10 }); // 10 px per character
    const { lines } = layoutTextBody(body, 75, 200, measure);
    expect(lines.map((l) => l.segments.map((s) => s.text).join('').trim())).toEqual(['aaa bbb', 'ccc']);
  });
});
