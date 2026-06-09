// -------------------- accent palettes --------------------
export const ACCENTS = {
  indigo:  { name: 'Indigo',  hue: 265, chroma: 0.17 },
  amber:   { name: 'Amber',   hue: 75,  chroma: 0.15 },
  emerald: { name: 'Emerald', hue: 155, chroma: 0.13 },
  magenta: { name: 'Magenta', hue: 335, chroma: 0.18 },
  coral:   { name: 'Coral',   hue: 25,  chroma: 0.17 },
};

// -------------------- "Meet Stagecraft" intro deck --------------------
export const SAMPLE_DECK = {
  id: 'intro',
  title: 'Meet Stagecraft',
  subtitle: 'A dense, pro presentation editor',
  author: 'Built with Claude · 2026',
  theme: 'indigo',
  sections: [
    { id: 's1', name: 'Intro',   slides: ['cover', 'agenda'] },
    { id: 's2', name: 'Why',     slides: ['div-why', 'kpi-numbers', 'chart-coverage', 'split-ds'] },
    { id: 's3', name: 'Inside',  slides: ['div-inside', 'table-layouts', 'roadmap-built', 'list-next'] },
    { id: 's4', name: 'Build',   slides: ['div-build', 'text-mcp', 'risks-limits'] },
    { id: 's5', name: 'Close',   slides: ['thanks'] },
  ],
  slides: [
    { id: 'cover', layout: 'cover', title: 'Meet Stagecraft', subtitle: 'A dense, pro presentation editor · Built with Claude', bg: 'ink' },

    { id: 'agenda', layout: 'agenda', title: 'Agenda', eyebrow: 'Overview · 4 parts', items: [
      { n: '01', t: 'Why Stagecraft', d: 'What it is and who it is for' },
      { n: '02', t: 'What\'s inside',  d: 'Twelve layouts, charts, theming' },
      { n: '03', t: 'How it\'s built', d: 'Vite + React, MCP, Co-pilot' },
      { n: '04', t: 'Honest limits',   d: 'What\'s shipped vs. what\'s next' },
    ]},

    { id: 'div-why', layout: 'divider', chapter: '01', title: 'Why Stagecraft', bg: 'accent' },

    { id: 'kpi-numbers', layout: 'kpi', title: 'Stagecraft by the numbers', eyebrow: 'By the numbers', note: 'as shipped today',
      kpis: [
        { label: 'Slide layouts', val: '12',   delta: 'all wired', target: 'cover → thanks',          good: true },
        { label: 'Chart types',   val: '4',    delta: 'SVG',       target: 'line · bar · area · donut', good: true },
        { label: 'Accents',       val: '5',    delta: 'live',      target: '+ light / dark',           good: true },
        { label: 'MCP tools',     val: '6',    delta: 'agent-ready', target: 'CRUD + set_theme',       good: true },
        { label: 'LLM providers', val: '6',    delta: 'BYO key',   target: 'Anthropic → local',        good: true },
        { label: 'Cold build',    val: '2.3s', delta: '50 mods',   target: 'vite build',               good: true },
      ]
    },

    { id: 'chart-coverage', layout: 'chart', chartType: 'bar', title: 'Prototype → production', eyebrow: 'Coverage',
      sub: 'Every prototype surface, ported and then extended' },

    { id: 'split-ds', layout: 'split', title: 'One design system', eyebrow: 'Design system',
      body: 'Every color, size, and shadow is a token. Light and dark themes, five accent palettes, and three densities all flow from the same variables — no hard-coded colors in the UI.',
      stats: [
        { lbl: 'Design tokens', val: '60+' },
        { lbl: 'SVG icons',     val: '90+' },
        { lbl: 'CSS lines',     val: '2.1k' },
      ]
    },

    { id: 'div-inside', layout: 'divider', chapter: '02', title: 'What\'s inside' },

    { id: 'table-layouts', layout: 'table', title: 'Twelve layouts, one renderer', eyebrow: 'Layouts',
      columns: ['Layout', 'Best for', 'Family', 'Status'],
      rows: [
        ['Cover · Divider', 'Openers & breaks', 'Structure', 'Ready'],
        ['KPI · Table',     'Numbers',          'Data',      'Ready'],
        ['Chart',           'Trends',           'Data',      'Ready'],
        ['Agenda · List',   'Outlines',         'Text',      'Ready'],
        ['Roadmap · Risks', 'Planning',         'Narrative', 'Ready'],
      ]
    },

    { id: 'roadmap-built', layout: 'roadmap', title: 'Built in a single session' },

    { id: 'list-next', layout: 'list', title: 'What\'s next', eyebrow: 'Roadmap',
      items: [
        'Render charts to images so PPTX export is pixel-perfect',
        'Code-split the bundle (pptxgenjs is the heavy bit)',
        'Persist decks to a backend instead of in-memory state',
        'Collaborative cursors and live comments',
      ]
    },

    { id: 'div-build', layout: 'divider', chapter: '03', title: 'How it\'s built' },

    { id: 'text-mcp', layout: 'text', title: 'Agent-controllable by design', eyebrow: 'Platform',
      body: 'Every deck operation is exposed over an MCP HTTP API at /api/mcp — agents can add, update, reorder, and re-theme slides using the same endpoints the editor uses. The Co-pilot routes LLM calls through /api/llm so your API keys never touch the browser.' },

    { id: 'risks-limits', layout: 'risks', title: 'Honest limitations', eyebrow: 'Honest take',
      items: [
        { sev: 'med', t: 'Charts export as placeholders', d: 'SVG charts can\'t rasterize into PPTX yet — exported as a labeled note' },
        { sev: 'low', t: 'Single JS bundle',              d: '647 KB (pptxgenjs) — code-splitting is pending' },
        { sev: 'low', t: 'No persistence',                d: 'Deck state is in-memory; a backend store is on the roadmap' },
      ]
    },

    { id: 'thanks', layout: 'thanks', title: 'Thanks', subtitle: 'Stagecraft · built with Claude · try /api/mcp' },
  ]
};

export const SPEAKER_NOTES = {
  'cover': 'Open with the one-liner: Stagecraft is a dense, keyboard-first presentation editor — think Linear/Figma energy, not slide-ware. Built end-to-end with Claude.',
  'kpi-numbers': 'These are real, shipped numbers — not aspirations. Linger on MCP tools and LLM providers; that is what makes this more than a pretty editor.',
  'chart-coverage': 'Every surface in the original prototype was ported, then three production features were added on top: PPTX export, the Co-pilot, and the MCP server.',
  'text-mcp': 'This is the headline. The same endpoints the UI calls are open to agents. Demo it live: curl /api/mcp/tools/call to add a slide while the deck is open.',
  'risks-limits': 'Be candid here. Naming the limits builds trust — and each one already has a concrete next step on the roadmap slide.',
};

// -------------------- templates --------------------
export const TEMPLATES = [
  { id: 't1', name: 'Blank',              cat: 'Basic',      vibe: 'blank' },
  { id: 't2', name: 'Monolith',           cat: 'Editorial',  vibe: 'mono' },
  { id: 't3', name: 'Spreadsheet',        cat: 'Data',       vibe: 'grid' },
  { id: 't4', name: 'Cartridge',          cat: 'Product',    vibe: 'cart' },
  { id: 't5', name: 'Atlas',              cat: 'Corporate',  vibe: 'atlas' },
  { id: 't6', name: 'Ledger',             cat: 'Finance',    vibe: 'ledger' },
  { id: 't7', name: 'Field Notes',        cat: 'Editorial',  vibe: 'field' },
  { id: 't8', name: 'Substrate',          cat: 'Tech',       vibe: 'subs' },
  { id: 't9', name: 'Dossier',            cat: 'Corporate',  vibe: 'dossier' },
];
