// Builds a real starter deck from a template-picker entry ({ id, name, cat, vibe }).
// Templates are preview-only; picking one creates a themed, editable deck that's
// saved to the library (POST /api/decks) and opened — see App.handlePickTemplate.

const VIBE_THEME = {
  blank: 'indigo', mono: 'slate', grid: 'indigo', cart: 'amber', atlas: 'slate',
  ledger: 'amber', field: 'emerald', subs: 'magenta', dossier: 'coral',
};

// A template's visual vibe → a deck theme (falls back to indigo).
export function vibeTheme(vibe) {
  return VIBE_THEME[vibe] || 'indigo';
}

let seq = 0;
function sid() { return `tpl-${Date.now().toString(36)}-${(seq++).toString(36)}`; }

export function templateDeck(template) {
  const t = template || {};
  const name = t.name || 'Untitled deck';
  const cover = { id: sid(), layout: 'cover', title: name, subtitle: t.cat ? `${t.cat} template` : 'New deck' };
  const intro = { id: sid(), layout: 'text', title: 'Start here', body: 'Replace this with your content — or ask the Co-pilot to draft it.' };
  return {
    title: name,
    theme: vibeTheme(t.vibe),
    sections: [{ id: sid(), name: 'Section 1', slides: [cover.id, intro.id] }],
    slides: [cover, intro],
  };
}
