import { describe, it, expect } from 'vitest';
import { SHAPE_TOOLS } from './ShapeMenu.jsx';
import { shapeDef } from '../../../lib/shapes.js';

// Drift guard: the shape menu is the third place shape types appear (after the
// canvas renderer and the PPTX export, now both single-sourced via shapes.js).
// If a menu tool's id isn't a known shape, creating it would silently fall back
// to a rect on both surfaces — this test fails instead.
describe('ShapeMenu shape vocabulary', () => {
  it('every shape tool id resolves to a shape in the registry', () => {
    for (const t of SHAPE_TOOLS) {
      expect(shapeDef(t.id), `menu tool "${t.id}" is not in the shape registry`).toBeTruthy();
    }
  });
});
