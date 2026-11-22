import { describe, it, expect } from 'vitest';
import { slideBgClass } from './slideScheme.js';

describe('slideBgClass', () => {
  it('is light by default and for content layouts', () => {
    for (const layout of ['text', 'kpi', 'blank', undefined]) expect(slideBgClass({ layout })).toBe('');
    expect(slideBgClass(null)).toBe('');
  });
  it('honours the cover bg, defaulting to light', () => {
    expect(slideBgClass({ layout: 'cover' })).toBe('');
    expect(slideBgClass({ layout: 'cover', bg: 'accent' })).toBe('accent');
  });
  it('defaults the divider to ink and keeps thanks ink', () => {
    expect(slideBgClass({ layout: 'divider' })).toBe('ink');
    expect(slideBgClass({ layout: 'divider', bg: 'accent' })).toBe('accent');
    expect(slideBgClass({ layout: 'thanks', bg: 'accent' })).toBe('ink');
  });
});
