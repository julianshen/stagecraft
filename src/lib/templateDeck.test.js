import { describe, it, expect } from 'vitest';
import { templateDeck, vibeTheme } from './templateDeck.js';
import { flattenDeck } from './deckOrder.js';

describe('vibeTheme', () => {
  it('maps a template vibe to a known deck theme, defaulting to indigo', () => {
    expect(vibeTheme('subs')).toBe('magenta');
    expect(vibeTheme('field')).toBe('emerald');
    expect(vibeTheme('nope')).toBe('indigo');
    expect(vibeTheme(undefined)).toBe('indigo');
  });
});

describe('templateDeck', () => {
  it('builds a valid starter deck titled and themed from the template', () => {
    const d = templateDeck({ id: 't5', name: 'Atlas', cat: 'Corporate', vibe: 'atlas' });
    expect(d.title).toBe('Atlas');
    expect(d.theme).toBe(vibeTheme('atlas'));
    expect(d.sections).toHaveLength(1);
    // a cover slide titled after the template, plus a starter content slide
    expect(d.slides[0].layout).toBe('cover');
    expect(d.slides[0].title).toBe('Atlas');
    expect(d.slides.length).toBeGreaterThanOrEqual(2);
  });

  it('section membership references the slides so flattenDeck renders them in order', () => {
    const d = templateDeck({ name: 'Ledger', vibe: 'ledger' });
    expect(d.sections[0].slides).toEqual(d.slides.map((s) => s.id));
    expect(flattenDeck(d).map((s) => s.id)).toEqual(d.slides.map((s) => s.id));
  });

  it('gives every slide a unique id, even across calls', () => {
    const a = templateDeck({ name: 'A', vibe: 'mono' });
    const b = templateDeck({ name: 'B', vibe: 'mono' });
    const ids = [...a.slides, ...b.slides].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to a sensible title for a nameless template', () => {
    expect(templateDeck({}).title).toBe('Untitled deck');
    expect(templateDeck().title).toBe('Untitled deck');
  });
});
