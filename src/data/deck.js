// -------------------- accent palettes --------------------
export const ACCENTS = {
  indigo:  { name: 'Indigo',  hue: 265, chroma: 0.17 },
  amber:   { name: 'Amber',   hue: 75,  chroma: 0.15 },
  emerald: { name: 'Emerald', hue: 155, chroma: 0.13 },
  magenta: { name: 'Magenta', hue: 335, chroma: 0.18 },
  coral:   { name: 'Coral',   hue: 25,  chroma: 0.17 },
};

// -------------------- sample decks --------------------
export const DECKS = [
  { id: 'qbr-q3', name: 'Q3 Business Review — Atlas', owner: 'You', edited: '2m ago', slides: 24, cover: 'Q3', tint: 'oklch(0.62 0.17 265)' },
  { id: 'gtm-26', name: '2026 GTM Plan', owner: 'Sam Levine', edited: '1h', slides: 18, cover: 'GTM', tint: 'oklch(0.67 0.14 155)' },
  { id: 'board-apr', name: 'April Board Deck', owner: 'You', edited: 'Yesterday', slides: 42, cover: 'BOARD', tint: 'oklch(0.28 0.02 260)' },
  { id: 'proj-cascade', name: 'Project Cascade — Kickoff', owner: 'Jules Kwon', edited: '2d', slides: 11, cover: 'PC', tint: 'oklch(0.7 0.14 75)' },
  { id: 'eoy-retro', name: 'EOY Retro + FY27 Planning', owner: 'Mira Cohen', edited: '3d', slides: 30, cover: 'EOY', tint: 'oklch(0.6 0.18 335)' },
  { id: 'ar-update', name: 'Analyst Relations Update', owner: 'You', edited: '1w', slides: 16, cover: 'AR', tint: 'oklch(0.55 0.1 260)' },
  { id: 'hiring', name: 'Hiring Plan — Engineering', owner: 'Rohan Patel', edited: '2w', slides: 9, cover: 'H', tint: 'oklch(0.62 0.17 25)' },
  { id: 'onboard', name: 'New Hire Onboarding', owner: 'HR', edited: '1mo', slides: 22, cover: 'HR', tint: 'oklch(0.6 0.08 260)' },
];

// -------------------- Q3 QBR deck content --------------------
export const SAMPLE_DECK = {
  id: 'qbr-q3',
  title: 'Q3 Business Review — Atlas',
  subtitle: 'Atlas Platform · Quarterly Business Review',
  author: 'Atlas Leadership · Oct 2025',
  theme: 'indigo',
  sections: [
    { id: 's1', name: 'Opening',    slides: ['cover', 'agenda', 'divider-scorecard'] },
    { id: 's2', name: 'Scorecard',  slides: ['metrics', 'revenue-chart', 'nrr', 'divider-segment'] },
    { id: 's3', name: 'Segments',   slides: ['segment-table', 'cohort', 'geo'] },
    { id: 's4', name: 'Product',    slides: ['roadmap', 'launches', 'divider-risks'] },
    { id: 's5', name: 'Outlook',    slides: ['risks', 'q4-goals', 'thanks'] },
  ],
  slides: [
    { id: 'cover', layout: 'cover', title: 'Q3 Business Review', subtitle: 'Atlas Platform · Oct 2025', bg: 'ink' },
    { id: 'agenda', layout: 'agenda', title: 'Agenda', items: [
      { n: '01', t: 'Scorecard',    d: 'Revenue, NRR, pipeline velocity' },
      { n: '02', t: 'Segments',     d: 'Enterprise vs mid-market split, cohorts' },
      { n: '03', t: 'Product',      d: 'Shipped, in-flight, at-risk' },
      { n: '04', t: 'Outlook',      d: 'Q4 bets & dependencies' },
    ]},
    { id: 'divider-scorecard', layout: 'divider', chapter: '01', title: 'Scorecard', bg: 'accent' },
    { id: 'metrics', layout: 'kpi', title: 'Scorecard — Q3 FY26', note: 'Figures USD · v. plan',
      kpis: [
        { label: 'Net ARR',     val: '$184.2M', delta: '+14.2%', target: 'vs plan $172M', good: true },
        { label: 'NRR',         val: '118%',    delta: '+3 pts', target: 'target 115%', good: true },
        { label: 'New Logos',   val: '73',      delta: '-6',     target: 'plan 79', good: false },
        { label: 'Pipeline',    val: '$412M',   delta: '+22%',   target: 'coverage 3.1×', good: true },
        { label: 'GRR',         val: '94%',     delta: 'flat',   target: 'target 95%', good: null },
        { label: 'Magic #',     val: '1.4',     delta: '+0.2',   target: 'healthy > 1.0', good: true },
      ]
    },
    { id: 'revenue-chart', layout: 'chart', title: 'Net ARR trajectory', sub: 'Quarterly, cumulative, $M',
      chart: 'revenue'
    },
    { id: 'nrr', layout: 'split', title: 'NRR decomposition', body: 'Expansion driven by seat growth in the 1k-5k tier; churn concentrated in sub-$50k accounts acquired in Q4 FY25.',
      stats: [
        { lbl: 'Expansion', val: '+21%' },
        { lbl: 'Contraction', val: '-4%' },
        { lbl: 'Churn', val: '-3%' },
      ]
    },
    { id: 'divider-segment', layout: 'divider', chapter: '02', title: 'Segments' },
    { id: 'segment-table', layout: 'table', title: 'Segment performance',
      columns: ['Segment', 'ARR', 'QoQ', 'Logos', 'NRR', 'Health'],
      rows: [
        ['Enterprise',    '$112.4M', '+18%', '34', '126%', 'strong'],
        ['Mid-market',    '$48.7M',  '+9%',  '22', '112%', 'steady'],
        ['SMB',           '$18.1M',  '+2%',  '17', '101%', 'watch'],
        ['Public sector', '$5.0M',   '+41%', '—',  'n/a',  'new'],
      ]
    },
    { id: 'cohort', layout: 'text', title: 'Cohort retention', body: 'FY24 cohorts continue to expand; FY25 cohort underperforming early signal. Two design partners in the Q1 FY25 cohort flagged pricing concerns — tracked in S-327.' },
    { id: 'geo', layout: 'text', title: 'Geographic mix', body: 'North America remains 72% of revenue. EMEA accelerating via self-serve funnel (+34% QoQ). APAC gated by regional data residency — delivering in Q4.' },
    { id: 'roadmap', layout: 'roadmap', title: 'Product roadmap — H2' },
    { id: 'launches', layout: 'text', title: 'Shipped this quarter', body: 'Workflow Engine GA · Audit Log v2 · SAML→OIDC migration · Mobile companion (beta) · 14 customer-requested integrations.' },
    { id: 'divider-risks', layout: 'divider', chapter: '03', title: 'Risks & Outlook' },
    { id: 'risks', layout: 'risks', title: 'Top risks entering Q4',
      items: [
        { sev: 'high',   t: 'SMB churn exposure', d: 'Trailing cohort concentrated in vertical X; -$4.2M at-risk ARR' },
        { sev: 'med',    t: 'Competitive pressure', d: 'Bundled pricing from incumbent on 6 open deals > $250k' },
        { sev: 'low',    t: 'Hiring pace', d: '12 open SWE, recovering from Q2 freeze — plan met 88%' },
      ]
    },
    { id: 'q4-goals', layout: 'list', title: 'Q4 bets',
      items: [
        'Land 3 lighthouse design partners in public sector',
        'Ship data residency for APAC (BLR + SYD)',
        'Re-price SMB tier; expected NRR lift of 2-3 pts',
        'Close FY26 plan with +1 quarter runway on pipeline',
      ]
    },
    { id: 'thanks', layout: 'thanks', title: 'Thanks', subtitle: 'Questions? — atlas-leadership@' },
  ]
};

export const SPEAKER_NOTES = {
  'cover': 'Open strong. "Q3 was a beat on revenue, a miss on new logos, and a quiet win on product velocity." Set expectations for the next 40 minutes.',
  'metrics': 'Walk the scorecard left-to-right. Pause on New Logos — this is the one miss. Pre-empt the question: we traded logo count for deal size; explain in segments.',
  'revenue-chart': 'Point to the inflection after Q2 — that is the Workflow Engine tailwind. Underline how compounding expansion is masking a thinner new-logo top.',
  'risks': 'Do not rush the risks slide. Explicitly ask the room what is missing from this list. Silence here is dangerous.',
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
