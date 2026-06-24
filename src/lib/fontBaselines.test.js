import { describe, it, expect } from 'vitest';
import { CANVAS_BASELINE_PX } from './fontBaselines.js';

describe('CANVAS_BASELINE_PX', () => {
  it('exposes the text-layout title/body canvas baselines', () => {
    expect(CANVAS_BASELINE_PX.text.title).toBe(84);
    expect(CANVAS_BASELINE_PX.text.body).toBe(32);
  });

  it('is deeply frozen — it is shared between the renderer and the export, so no consumer may mutate it', () => {
    expect(Object.isFrozen(CANVAS_BASELINE_PX)).toBe(true);
    expect(Object.isFrozen(CANVAS_BASELINE_PX.text)).toBe(true);
  });
});
