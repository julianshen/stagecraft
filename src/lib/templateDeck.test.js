import { describe, it, expect } from 'vitest';
import { templateDeck, vibeTheme } from './templateDeck.js';
import { flattenDeck } from './deckOrder.js';
import { TEMPLATES } from '../data/deck.js';

const LAYOUTS = ['cover', 'agenda', 'divider', 'kpi', 'chart', 'split', 'table', 'text', 'list', 'roadmap', 'risks', 'thanks'];

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
    expect(d.slides[0].layout).toBe('cover');
    expect(d.slides[0].title).toBe('Atlas');
    expect(d.slides.length).toBeGreaterThanOrEqual(2);
  });

  it('section membership references every slide exactly once, in slide-pool order', () => {
    const d = templateDeck({ name: 'Ledger', vibe: 'ledger' });
    expect(d.sections.flatMap((s) => s.slides)).toEqual(d.slides.map((s) => s.id));
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

describe('per-template skeletons', () => {
  it.each(TEMPLATES.map((t) => [t.name, t]))('%s yields a structurally valid deck', (_, t) => {
    const d = templateDeck(t);
    // every slide referenced exactly once, render order == pool order
    expect(d.sections.flatMap((s) => s.slides)).toEqual(d.slides.map((s) => s.id));
    expect(flattenDeck(d)).toHaveLength(d.slides.length);
    // only known layouts, cover first and titled after the template
    for (const s of d.slides) expect(LAYOUTS).toContain(s.layout);
    expect(d.slides[0].layout).toBe('cover');
    expect(d.slides[0].title).toBe(t.name);
    // every section is named and non-empty
    for (const sec of d.sections) {
      expect(sec.name).toBeTruthy();
      expect(sec.slides.length).toBeGreaterThan(0);
    }
  });

  it('Blank stays minimal: one section, cover + starter text', () => {
    const d = templateDeck(TEMPLATES[0]); // Blank
    expect(d.sections).toHaveLength(1);
    expect(d.slides.map((s) => s.layout)).toEqual(['cover', 'text']);
  });

  it('non-blank templates get a multi-section skeleton ending in a thanks slide', () => {
    for (const t of TEMPLATES.filter((x) => x.vibe !== 'blank')) {
      const d = templateDeck(t);
      expect(d.sections.length).toBeGreaterThanOrEqual(2);
      expect(d.slides.length).toBeGreaterThanOrEqual(5);
      expect(d.slides[d.slides.length - 1].layout).toBe('thanks');
    }
  });

  it('skeletons use the layouts that fit the template category', () => {
    const layoutsOf = (vibe) => templateDeck({ name: 'X', vibe }).slides.map((s) => s.layout);
    expect(layoutsOf('ledger')).toEqual(expect.arrayContaining(['kpi', 'chart', 'table', 'risks'])); // Finance
    expect(layoutsOf('grid')).toEqual(expect.arrayContaining(['table', 'chart']));                   // Data
    expect(layoutsOf('subs')).toEqual(expect.arrayContaining(['roadmap', 'risks']));                 // Tech
    expect(layoutsOf('cart')).toEqual(expect.arrayContaining(['split', 'kpi', 'roadmap']));          // Product
  });

  it('data-layout starters carry the field shapes the renderer and export expect', () => {
    const d = templateDeck({ name: 'Ledger', vibe: 'ledger' });
    const by = (l) => d.slides.find((s) => s.layout === l);
    expect(by('kpi').kpis.length).toBeGreaterThan(0);
    expect(by('kpi').kpis[0]).toHaveProperty('label');
    expect(by('kpi').kpis[0]).toHaveProperty('val');
    expect(by('chart').chart.categories.length).toBeGreaterThan(0);
    expect(by('chart').chart.series[0].values).toHaveLength(by('chart').chart.categories.length);
    expect(by('table').columns.length).toBeGreaterThan(0);
    for (const row of by('table').rows) expect(row).toHaveLength(by('table').columns.length);
    for (const item of by('risks').items) {
      expect(['high', 'med', 'low']).toContain(item.sev);
      expect(item.t).toBeTruthy();
    }
    const agendaDeck = templateDeck({ name: 'Atlas', vibe: 'atlas' });
    const agenda = agendaDeck.slides.find((s) => s.layout === 'agenda');
    expect(agenda.items.length).toBeGreaterThan(0);
    expect(agenda.items[0]).toHaveProperty('n');
    expect(agenda.items[0]).toHaveProperty('t');
  });

  it('an unknown vibe falls back to the minimal cover + text skeleton', () => {
    const d = templateDeck({ name: 'Mystery', vibe: 'wat' });
    expect(d.slides.map((s) => s.layout)).toEqual(['cover', 'text']);
    expect(d.theme).toBe('indigo');
  });
});
