// Builds a real starter deck from a template-picker entry ({ id, name, cat, vibe }).
// Templates are preview-only; picking one creates a themed, editable deck that's
// saved to the library (POST /api/decks) and opened — see App.handlePickTemplate.
//
// Each template vibe maps to a multi-section skeleton of placeholder slides in
// the layouts that fit its category, so a new deck opens as a structure to fill
// in rather than a blank page. `blank` (and any unknown vibe) stays minimal.
// Slide content comes from the shared slideFactories catalog — the same
// factories the editor toolbar uses — so skeleton slides and toolbar-inserted
// slides can never drift in schema. Only the cover is template-specific.

import { createComponentSlide, newId } from './slideFactories.js';

const VIBE_THEME = {
  blank: 'indigo', mono: 'slate', grid: 'indigo', cart: 'amber', atlas: 'slate',
  ledger: 'amber', field: 'emerald', subs: 'magenta', dossier: 'coral',
};

// A template's visual vibe → a deck theme (falls back to indigo).
export function vibeTheme(vibe) {
  return VIBE_THEME[vibe] || 'indigo';
}

// Per-vibe skeletons: ordered sections of layout names, opened by a cover and
// (for non-blank vibes) closed by a thanks slide.
const SKELETONS = {
  blank:   [{ name: 'Section 1', layouts: ['cover', 'text'] }],
  mono:    [{ name: 'Opening', layouts: ['cover', 'text'] },
            { name: 'The story', layouts: ['split', 'list'] },
            { name: 'Close', layouts: ['thanks'] }],
  grid:    [{ name: 'Overview', layouts: ['cover', 'kpi'] },
            { name: 'The data', layouts: ['table', 'chart'] },
            { name: 'Close', layouts: ['thanks'] }],
  cart:    [{ name: 'Pitch', layouts: ['cover', 'agenda'] },
            { name: 'Product', layouts: ['split', 'kpi', 'roadmap'] },
            { name: 'Close', layouts: ['thanks'] }],
  atlas:   [{ name: 'Opening', layouts: ['cover', 'agenda'] },
            { name: 'The body', layouts: ['divider', 'text', 'chart'] },
            { name: 'Close', layouts: ['thanks'] }],
  ledger:  [{ name: 'Summary', layouts: ['cover', 'kpi'] },
            { name: 'Detail', layouts: ['chart', 'table', 'risks'] },
            { name: 'Close', layouts: ['thanks'] }],
  field:   [{ name: 'Notes', layouts: ['cover', 'text'] },
            { name: 'Observations', layouts: ['list', 'split'] },
            { name: 'Close', layouts: ['thanks'] }],
  subs:    [{ name: 'Intro', layouts: ['cover', 'agenda'] },
            { name: 'The plan', layouts: ['chart', 'roadmap', 'risks'] },
            { name: 'Close', layouts: ['thanks'] }],
  dossier: [{ name: 'Brief', layouts: ['cover', 'agenda'] },
            { name: 'Findings', layouts: ['split', 'table', 'list'] },
            { name: 'Close', layouts: ['thanks'] }],
};

// The cover is the one template-specific slide; every other layout comes from
// the shared factory catalog.
function starterSlide(layout, t) {
  if (layout === 'cover') {
    return {
      id: newId('cover'),
      layout: 'cover',
      title: t.name || 'Untitled deck',
      subtitle: t.cat ? `${t.cat} template` : 'New deck',
    };
  }
  return createComponentSlide(layout);
}

export function templateDeck(template) {
  const t = template || {};
  const skeleton = SKELETONS[t.vibe] || SKELETONS.blank;
  const slides = [];
  const sections = skeleton.map((sec) => {
    const made = sec.layouts.map((layout) => starterSlide(layout, t));
    slides.push(...made);
    return { id: newId('sec'), name: sec.name, slides: made.map((s) => s.id) };
  });
  return { title: t.name || 'Untitled deck', theme: vibeTheme(t.vibe), sections, slides };
}
