// Builds a real starter deck from a template-picker entry ({ id, name, cat, vibe }).
// Templates are preview-only; picking one creates a themed, editable deck that's
// saved to the library (POST /api/decks) and opened — see App.handlePickTemplate.
//
// Each template vibe maps to a multi-section skeleton of placeholder slides in
// the layouts that fit its category, so a new deck opens as a structure to fill
// in rather than a blank page. `blank` (and any unknown vibe) stays minimal.

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

// Starter content per layout — placeholder copy in the exact field shapes the
// renderer and the PPTX builders expect (see SAMPLE_DECK in data/deck.js).
// Layouts with model-level demo fallbacks (roadmap) stay title-only.
const STARTERS = {
  text:    () => ({ layout: 'text', title: 'Start here', body: 'Replace this with your content — or ask the Co-pilot to draft it.' }),
  agenda:  () => ({ layout: 'agenda', title: 'Agenda', items: [
    { n: '01', t: 'Opening', d: 'Why we are here' },
    { n: '02', t: 'The middle', d: 'What we found / built / propose' },
    { n: '03', t: 'Close', d: 'Decisions and next steps' },
  ] }),
  divider: () => ({ layout: 'divider', chapter: '01', title: 'Part one' }),
  kpi:     () => ({ layout: 'kpi', title: 'The numbers', kpis: [
    { label: 'Metric one', val: '—', delta: 'vs last period', target: 'fill me in', good: true },
    { label: 'Metric two', val: '—', delta: 'vs last period', target: 'fill me in', good: true },
    { label: 'Metric three', val: '—', delta: 'vs last period', target: 'fill me in', good: true },
  ] }),
  chart:   () => ({ layout: 'chart', chartType: 'bar', title: 'The trend', sub: 'Replace with your data', chart: {
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [{ name: 'Series A', values: [20, 40, 60, 80] }],
  } }),
  split:   () => ({ layout: 'split', title: 'One key idea', body: 'Pair a short narrative with the numbers that back it up.', stats: [
    { lbl: 'Stat one', val: '—' },
    { lbl: 'Stat two', val: '—' },
  ] }),
  table:   () => ({ layout: 'table', title: 'The details', columns: ['Item', 'Status', 'Owner'], rows: [
    ['First thing', 'In progress', '—'],
    ['Second thing', 'Planned', '—'],
    ['Third thing', 'Done', '—'],
  ] }),
  list:    () => ({ layout: 'list', title: 'Key points', items: [
    'First point — replace me',
    'Second point — replace me',
    'Third point — replace me',
  ] }),
  roadmap: () => ({ layout: 'roadmap', title: 'Roadmap' }),
  risks:   () => ({ layout: 'risks', title: 'Risks & mitigations', items: [
    { sev: 'high', t: 'Biggest risk', d: 'What could go wrong, and the mitigation' },
    { sev: 'med', t: 'Second risk', d: 'What could go wrong, and the mitigation' },
    { sev: 'low', t: 'Watch item', d: 'Worth tracking, not blocking' },
  ] }),
  thanks:  () => ({ layout: 'thanks', title: 'Thanks', subtitle: 'Questions & discussion' }),
};

// Per-vibe skeletons: ordered sections of layout names. `cover` is always
// prepended to the first section (titled after the template) by templateDeck.
const SKELETONS = {
  mono:    [{ name: 'Opening', layouts: ['text'] },
            { name: 'The story', layouts: ['split', 'list'] },
            { name: 'Close', layouts: ['thanks'] }],
  grid:    [{ name: 'Overview', layouts: ['kpi'] },
            { name: 'The data', layouts: ['table', 'chart'] },
            { name: 'Close', layouts: ['thanks'] }],
  cart:    [{ name: 'Pitch', layouts: ['agenda'] },
            { name: 'Product', layouts: ['split', 'kpi', 'roadmap'] },
            { name: 'Close', layouts: ['thanks'] }],
  atlas:   [{ name: 'Opening', layouts: ['agenda'] },
            { name: 'The body', layouts: ['divider', 'text', 'chart'] },
            { name: 'Close', layouts: ['thanks'] }],
  ledger:  [{ name: 'Summary', layouts: ['kpi'] },
            { name: 'Detail', layouts: ['chart', 'table', 'risks'] },
            { name: 'Close', layouts: ['thanks'] }],
  field:   [{ name: 'Notes', layouts: ['text'] },
            { name: 'Observations', layouts: ['list', 'split'] },
            { name: 'Close', layouts: ['thanks'] }],
  subs:    [{ name: 'Intro', layouts: ['agenda'] },
            { name: 'The plan', layouts: ['chart', 'roadmap', 'risks'] },
            { name: 'Close', layouts: ['thanks'] }],
  dossier: [{ name: 'Brief', layouts: ['agenda'] },
            { name: 'Findings', layouts: ['split', 'table', 'list'] },
            { name: 'Close', layouts: ['thanks'] }],
};

export function templateDeck(template) {
  const t = template || {};
  const name = t.name || 'Untitled deck';
  const cover = { id: sid(), layout: 'cover', title: name, subtitle: t.cat ? `${t.cat} template` : 'New deck' };

  const skeleton = SKELETONS[t.vibe];
  if (!skeleton) {
    // blank / unknown vibe — the original minimal pair
    const intro = { id: sid(), ...STARTERS.text() };
    return {
      title: name,
      theme: vibeTheme(t.vibe),
      sections: [{ id: sid(), name: 'Section 1', slides: [cover.id, intro.id] }],
      slides: [cover, intro],
    };
  }

  const slides = [cover];
  const sections = skeleton.map((sec, i) => {
    const made = sec.layouts.map((layout) => ({ id: sid(), ...STARTERS[layout]() }));
    slides.push(...made);
    return {
      id: sid(),
      name: sec.name,
      slides: [...(i === 0 ? [cover.id] : []), ...made.map((s) => s.id)],
    };
  });

  return { title: name, theme: vibeTheme(t.vibe), sections, slides };
}
