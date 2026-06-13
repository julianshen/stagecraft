import { describe, it, expect } from 'vitest';
import { ACCENTS, SAMPLE_DECK, SPEAKER_NOTES, TEMPLATES, resolveNotes } from './deck.js';
import { flattenDeck } from '../lib/deckOrder.js';

describe('resolveNotes', () => {
  it('prefers authored slide.notes, honouring an intentionally-empty string', () => {
    expect(resolveNotes({ id: 'cover', notes: 'mine' })).toBe('mine');
    expect(resolveNotes({ id: 'cover', notes: '' })).toBe(''); // cleared on purpose → no notes
  });
  it('falls back to the bundled SPEAKER_NOTES by id, then to the given fallback', () => {
    expect(resolveNotes({ id: 'cover' })).toBe(SPEAKER_NOTES.cover);
    expect(resolveNotes({ id: 'no-such-id' })).toBe('');               // default fallback
    expect(resolveNotes({ id: 'no-such-id' }, 'nudge')).toBe('nudge'); // custom fallback (presenter)
  });
});

const KNOWN_LAYOUTS = new Set([
  'cover', 'agenda', 'divider', 'kpi', 'chart', 'split', 'table', 'text', 'list', 'roadmap', 'risks', 'thanks',
]);

describe('SAMPLE_DECK integrity', () => {
  it('every section slide id resolves to a real slide', () => {
    const ids = new Set(SAMPLE_DECK.slides.map((s) => s.id));
    for (const sec of SAMPLE_DECK.sections) {
      for (const sid of sec.slides) expect(ids.has(sid)).toBe(true);
    }
  });

  it('every slide uses a known layout', () => {
    for (const s of SAMPLE_DECK.slides) expect(KNOWN_LAYOUTS.has(s.layout)).toBe(true);
  });

  it('flattened length equals the sum of section slide counts', () => {
    const total = SAMPLE_DECK.sections.reduce((n, s) => n + s.slides.length, 0);
    expect(flattenDeck(SAMPLE_DECK)).toHaveLength(total);
  });

  it('declares a theme and speaker notes key into real slides', () => {
    expect(typeof SAMPLE_DECK.theme).toBe('string');
    const ids = new Set(SAMPLE_DECK.slides.map((s) => s.id));
    for (const id of Object.keys(SPEAKER_NOTES)) expect(ids.has(id)).toBe(true);
  });
});

describe('catalogs', () => {
  it('defines five accent palettes with hue + chroma', () => {
    const keys = Object.keys(ACCENTS);
    expect(keys).toHaveLength(5);
    for (const k of keys) {
      expect(typeof ACCENTS[k].hue).toBe('number');
      expect(typeof ACCENTS[k].chroma).toBe('number');
    }
  });

  it('TEMPLATES have stable unique ids', () => {
    const tplIds = TEMPLATES.map((t) => t.id);
    expect(new Set(tplIds).size).toBe(tplIds.length);
  });
});
