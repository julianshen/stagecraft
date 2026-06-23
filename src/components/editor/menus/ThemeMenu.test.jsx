import { describe, it, expect } from 'vitest';
import { accentColor, accentLabel, THEME_OPTIONS } from './ThemeMenu.jsx';

describe('accentColor', () => {
  it('renders a theme option as its fixed-lightness oklch accent', () => {
    expect(accentColor({ chroma: 0.13, hue: 155 })).toBe('oklch(0.62 0.13 155)');
  });

  // The literal-prefix check is the real invariant (lightness is the fixed
  // axis); test 1 above pins the exact format with a hardcoded value, so this
  // loop deliberately avoids re-deriving the whole string from the same template.
  it('fixes lightness at 0.62 for every theme (only chroma + hue vary)', () => {
    for (const o of THEME_OPTIONS) {
      expect(accentColor(o).startsWith('oklch(0.62 ')).toBe(true);
    }
  });
});

describe('accentLabel', () => {
  it('formats a theme as a compact slash readout, stripping the leading zero', () => {
    expect(accentLabel({ chroma: 0.13, hue: 155 })).toBe('oklch(.62/.13/155)');
  });

  it('keeps a whole-number chroma intact (a 0-chroma theme must not collapse to //)', () => {
    expect(accentLabel({ chroma: 0, hue: 260 })).toBe('oklch(.62/0/260)');
  });
});
