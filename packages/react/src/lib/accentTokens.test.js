import { accentTokens } from './accentTokens.js';

describe('accentTokens', () => {
  it('falls back to indigo for an unknown accent', () => {
    expect(accentTokens('unknown', 'light')).toEqual(accentTokens('indigo', 'light'));
  });

  it('uses a stronger wash in dark mode while keeping solid colors unchanged', () => {
    const light = accentTokens('indigo', 'light');
    const dark = accentTokens('indigo', 'dark');
    expect(light['--accent']).toBe('oklch(0.62 0.17 265)');
    expect(light['--accent-2']).toBe('oklch(0.55 0.17 265)');
    expect(light['--accent-wash']).toBe('oklch(0.62 0.17 265 / 0.08)');
    expect(dark).toEqual({ ...light, '--accent-wash': 'oklch(0.62 0.17 265 / 0.18)' });
  });
});
