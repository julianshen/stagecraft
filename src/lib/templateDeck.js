// Builds a real starter deck from a template-picker entry ({ id, name, cat, vibe }).
// Templates are preview-only; picking one creates a themed, editable deck that's
// saved to the library (POST /api/decks) and opened — see App.handlePickTemplate.
//
// Each template vibe maps to a theme plus a multi-section skeleton of
// placeholder slides in the layouts that fit its category, so a new deck opens
// as a structure to fill in rather than a blank page. `blank` (and any unknown
// vibe) stays minimal. Slide content comes from the shared slideFactories
// catalog (the same per-layout shapes the editor toolbar draws from), so
// skeleton slides and toolbar-inserted slides share one schema; only the
// cover's title/subtitle are template-specific.

import { createComponentSlide, newId } from './slideFactories.js';

// One record per vibe: theme + skeleton together, so a new template can't get
// one without the other. Skeletons are ordered sections of layout names,
// opened by a cover and (for non-blank vibes) closed by a thanks slide.
const VIBES = {
  blank:   { theme: 'indigo',
             sections: [{ name: 'Section 1', layouts: ['cover', 'text'] }] },
  mono:    { theme: 'slate',
             sections: [{ name: 'Opening', layouts: ['cover', 'text'] },
                        { name: 'The story', layouts: ['split', 'list'] },
                        { name: 'Close', layouts: ['thanks'] }] },
  grid:    { theme: 'indigo',
             sections: [{ name: 'Overview', layouts: ['cover', 'kpi'] },
                        { name: 'The data', layouts: ['table', 'chart'] },
                        { name: 'Close', layouts: ['thanks'] }] },
  cart:    { theme: 'amber',
             sections: [{ name: 'Pitch', layouts: ['cover', 'agenda'] },
                        { name: 'Product', layouts: ['split', 'kpi', 'roadmap'] },
                        { name: 'Close', layouts: ['thanks'] }] },
  atlas:   { theme: 'slate',
             sections: [{ name: 'Opening', layouts: ['cover', 'agenda'] },
                        { name: 'The body', layouts: ['divider', 'text', 'chart'] },
                        { name: 'Close', layouts: ['thanks'] }] },
  ledger:  { theme: 'amber',
             sections: [{ name: 'Summary', layouts: ['cover', 'kpi'] },
                        { name: 'Detail', layouts: ['chart', 'table', 'risks'] },
                        { name: 'Close', layouts: ['thanks'] }] },
  field:   { theme: 'emerald',
             sections: [{ name: 'Notes', layouts: ['cover', 'text'] },
                        { name: 'Observations', layouts: ['list', 'split'] },
                        { name: 'Close', layouts: ['thanks'] }] },
  subs:    { theme: 'magenta',
             sections: [{ name: 'Intro', layouts: ['cover', 'agenda'] },
                        { name: 'The plan', layouts: ['chart', 'roadmap', 'risks'] },
                        { name: 'Close', layouts: ['thanks'] }] },
  dossier: { theme: 'coral',
             sections: [{ name: 'Brief', layouts: ['cover', 'agenda'] },
                        { name: 'Findings', layouts: ['split', 'table', 'list'] },
                        { name: 'Close', layouts: ['thanks'] }] },
};

// A template's visual vibe → a deck theme (falls back to indigo).
export function vibeTheme(vibe) {
  return (VIBES[vibe] || VIBES.blank).theme;
}

export function templateDeck(template) {
  const t = template || {};
  const name = t.name || 'Untitled deck';
  const vibe = VIBES[t.vibe] || VIBES.blank;
  const slides = [];
  const sections = vibe.sections.map((sec) => {
    const made = sec.layouts.map((layout) => layout === 'cover'
      // The cover is the one template-specific slide: titled after the template.
      ? { ...createComponentSlide('cover'), title: name, subtitle: t.cat ? `${t.cat} template` : 'New deck' }
      : createComponentSlide(layout));
    slides.push(...made);
    return { id: newId('sec'), name: sec.name, slides: made.map((s) => s.id) };
  });
  return { title: name, theme: vibe.theme, sections, slides };
}
