import { ACCENTS } from '@stagecraft/core/data/deck.js';

export function accentTokens(accent, theme) {
  const { chroma, hue } = ACCENTS[accent] || ACCENTS.indigo;
  return {
    '--accent': `oklch(0.62 ${chroma} ${hue})`,
    '--accent-2': `oklch(0.55 ${chroma} ${hue})`,
    '--accent-wash': `oklch(0.62 ${chroma} ${hue} / ${theme === 'dark' ? 0.18 : 0.08})`,
  };
}
