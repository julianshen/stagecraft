import { useState, useEffect } from 'react';
import { SAMPLE_DECK } from '../../data/deck.js';
import SlideEditor from './SlideEditor.jsx';
import { Slide } from '../slides/SlideRenderer.jsx';

let slideSeq = 0;

function newId(kind) {
  slideSeq += 1;
  return `${kind}-${Date.now()}-${slideSeq}`;
}

export default function Editor({ accent, layoutVariant, density, onPresent, onOpenExport, onOpenHome }) {
  const [deck, setDeck] = useState(() => JSON.parse(JSON.stringify(SAMPLE_DECK)));
  const [curId, setCurId] = useState(() => {
    const flat = [];
    SAMPLE_DECK.sections.forEach(sec => sec.slides.forEach(sid => flat.push(sid)));
    return flat[3] || flat[0] || null;
  });

  // Sync deck state to the Vite MCP server
  useEffect(() => {
    fetch('/api/deck', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deck),
    }).catch(() => {}); // silently ignore if server isn't running
  }, [deck]);

  function pushSlide(slide) {
    setDeck(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.slides.push(slide);
      next.sections[next.sections.length - 1].slides.push(slide.id);
      return next;
    });
    setCurId(slide.id);
  }

  function addTable(rows = 3, cols = 3) {
    const columns = Array.from({ length: cols }, (_, i) => `Column ${String.fromCharCode(65 + i)}`);
    const body = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => (c === 0 ? `Row ${r + 1}` : '—'))
    );
    pushSlide({ id: newId('table'), layout: 'table', title: 'New table', columns, rows: body });
  }

  function addChart(type = 'line') {
    const titleByType = { line: 'Trend', bar: 'Comparison', area: 'Cumulative', donut: 'Composition', pie: 'Composition' };
    pushSlide({ id: newId('chart'), layout: 'chart', chartType: type, title: titleByType[type] || 'New chart' });
  }

  function changeLayout(layout) {
    if (!curId) return;
    setDeck(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const s = next.slides.find(x => x.id === curId);
      if (s) s.layout = layout;
      return next;
    });
  }

  function changeTheme(theme) {
    setDeck(prev => ({ ...JSON.parse(JSON.stringify(prev)), theme }));
  }

  function addText(style = 'heading') {
    const blocks = {
      heading:    { layout: 'text', title: 'New heading', body: '' },
      subheading: { layout: 'text', title: 'Subheading', body: 'Add supporting copy beneath the subheading.' },
      body:       { layout: 'text', title: '', body: 'Add your body text here. Keep it to a single idea so the slide stays readable from the back of the room.' },
    };
    pushSlide({ id: newId('text'), ...(blocks[style] || blocks.heading) });
  }

  function addComponent(id) {
    if (id === 'table') return addTable();
    if (id === 'chart') return addChart('line');
    const sid = newId(id);
    const blocks = {
      agenda: { layout: 'agenda', title: 'Agenda', items: [
        { n: '01', t: 'First section',  d: 'What this part covers' },
        { n: '02', t: 'Second section', d: 'What this part covers' },
        { n: '03', t: 'Third section',  d: 'What this part covers' },
        { n: '04', t: 'Fourth section', d: 'What this part covers' },
      ]},
      text:   { layout: 'text', title: 'Section title', body: 'Add your supporting paragraph here.' },
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
      roadmap: { layout: 'roadmap', title: 'Roadmap' },
      risks:   { layout: 'risks', title: 'Top risks', items: [
        { sev: 'high', t: 'First risk',  d: 'Describe the exposure and magnitude' },
        { sev: 'med',  t: 'Second risk', d: 'Describe the exposure and magnitude' },
        { sev: 'low',  t: 'Third risk',  d: 'Describe the exposure and magnitude' },
      ]},
    };
    const block = blocks[id] || { layout: 'text', title: 'New slide', body: '' };
    pushSlide({ id: sid, ...block });
  }

  function deleteSlide(slideId) {
    setDeck(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.slides = next.slides.filter(s => s.id !== slideId);
      next.sections = next.sections.map(sec => ({
        ...sec,
        slides: sec.slides.filter(sid => sid !== slideId),
      }));
      return next;
    });
    // Move cursor if we deleted the current slide
    if (curId === slideId) {
      const flat = [];
      deck.sections.forEach(sec => sec.slides.forEach(sid => flat.push(sid)));
      const idx = flat.indexOf(slideId);
      const next = flat[idx + 1] || flat[idx - 1] || flat[0];
      if (next && next !== slideId) setCurId(next);
    }
  }

  return (
    <SlideEditor
      deck={deck}
      currentSlideId={curId || undefined}
      onCurrentSlideChange={setCurId}
      renderSlide={(slide, ctx) => (
        <Slide
          slide={slide}
          deck={ctx.deck}
          sectionName={ctx.sectionName}
          num={ctx.num}
          total={ctx.total}
        />
      )}
      layoutVariant={layoutVariant}
      theme={{ accent, density }}
      callbacks={{
        onPresent,
        onExport: onOpenExport,
        onAddTable: addTable,
        onAddChart: addChart,
        onAddComponent: addComponent,
        onAddText: addText,
        onChangeLayout: changeLayout,
        onChangeTheme: changeTheme,
        onNewSlide: () => addComponent('text'),
        onDeleteSlide: deleteSlide,
        onDuplicateSlide: () => {},
      }}
    />
  );
}
