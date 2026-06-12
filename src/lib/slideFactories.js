let slideSeq = 0;

export function newId(kind) {
  slideSeq += 1;
  return `${kind}-${Date.now()}-${slideSeq}`;
}

export function createTableSlide(rows = 3, cols = 3) {
  const columns = Array.from({ length: cols }, (_, i) => `Column ${String.fromCharCode(65 + i)}`);
  const body = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (c === 0 ? `Row ${r + 1}` : '—'))
  );
  return { id: newId('table'), layout: 'table', title: 'New table', columns, rows: body };
}

export function createChartSlide(type = 'line') {
  const titleByType = { line: 'Trend', bar: 'Comparison', area: 'Cumulative', donut: 'Composition', pie: 'Composition' };
  return {
    id: newId('chart'),
    layout: 'chart',
    chartType: type,
    title: titleByType[type] || 'New chart',
    sub: 'Replace with your data',
    // Explicit neutral starter data — without it, the shared chartData demo
    // fallback renders (and exports) fabricated series as if they were content.
    chart: { categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'Series A', values: [20, 40, 60, 80] }] },
  };
}

export function createTextSlide(style = 'heading') {
  const blocks = {
    heading:    { layout: 'text', title: 'New heading', body: '' },
    subheading: { layout: 'text', title: 'Subheading', body: 'Add supporting copy beneath the subheading.' },
    body:       { layout: 'text', title: '', body: 'Add your body text here. Keep it to a single idea so the slide stays readable from the back of the room.' },
  };
  return { id: newId('text'), ...(blocks[style] || blocks.heading) };
}

export function createComponentSlide(id) {
  if (id === 'table') return createTableSlide();
  if (id === 'chart') return createChartSlide('line');

  const sid = newId(id);
  const blocks = {
    agenda: { layout: 'agenda', title: 'Agenda', items: [
      { n: '01', t: 'First section',  d: 'What this part covers' },
      { n: '02', t: 'Second section', d: 'What this part covers' },
      { n: '03', t: 'Third section',  d: 'What this part covers' },
      { n: '04', t: 'Fourth section', d: 'What this part covers' },
    ]},
    text:   { layout: 'text', title: 'Section title', body: 'Add your supporting paragraph here — or ask the Co-pilot to draft it.' },
    list:   { layout: 'list', title: 'Key points', items: [
      'First point worth making',
      'Second point worth making',
      'Third point worth making',
    ]},
    quote:   { layout: 'text', title: '"A sharp, quotable line that frames the whole story."', body: '— Attribution, Role' },
    divider: { layout: 'divider', chapter: '00', title: 'New section', bg: 'ink' },
    kpi:     { layout: 'kpi', title: 'Key metrics', note: 'edit values', kpis: [
      { label: 'Metric one',   val: '00',  delta: '+0%',  target: 'vs target', good: true },
      { label: 'Metric two',   val: '00%', delta: 'flat', target: 'vs target', good: null },
      { label: 'Metric three', val: '0.0', delta: '-0',   target: 'vs target', good: false },
    ]},
    cover:   { layout: 'cover', title: 'New deck', subtitle: '' },
    // Explicit neutral lanes — without them, roadmapModel's demo fallback
    // renders (and exports) fabricated product milestones as if real.
    roadmap: { layout: 'roadmap', title: 'Roadmap', lanes: [
      { name: 'Workstream A', items: [
        { t: 0, d: 3, lbl: 'First milestone', state: 'done' },
        { t: 4, d: 4, lbl: 'Next milestone', state: 'inflight' },
      ]},
      { name: 'Workstream B', items: [
        { t: 2, d: 4, lbl: 'Parallel effort', state: 'planned' },
      ]},
    ]},
    split:   { layout: 'split', title: 'One key idea', body: 'Pair a short narrative with the numbers that back it up.', stats: [
      { lbl: 'Stat one', val: '—' },
      { lbl: 'Stat two', val: '—' },
    ]},
    thanks:  { layout: 'thanks', title: 'Thanks', subtitle: 'Questions & discussion' },
    risks:   { layout: 'risks', title: 'Top risks', items: [
      { sev: 'high', t: 'First risk',  d: 'Describe the exposure and magnitude' },
      { sev: 'med',  t: 'Second risk', d: 'Describe the exposure and magnitude' },
      { sev: 'low',  t: 'Third risk',  d: 'Describe the exposure and magnitude' },
    ]},
  };
  const block = blocks[id] || { layout: 'text', title: 'New slide', body: '' };
  return { id: sid, ...block };
}
