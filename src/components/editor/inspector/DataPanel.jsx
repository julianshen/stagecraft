import React from 'react';
import ChartDataEditor from './ChartDataEditor.jsx';
import RoadmapLanesEditor from './RoadmapLanesEditor.jsx';
import ListItemsEditor, { ITEM_LAYOUTS } from './ListItemsEditor.jsx';
import TableDataEditor from './TableDataEditor.jsx';

// The inspector's Data tab: in-app authoring for the data-driven layouts.
// Edits flow through the same validated patch path the Co-pilot uses
// (onApply → onApplyAIPatch → sanitizeSlidePatch), so the gate is shared.
export default function DataPanel({ slide, onApply }) {
  const hint = (text) => (
    <div className="pane-section" style={{ color: 'var(--ink-4)', fontSize: 12 }}>{text}</div>
  );
  if (!onApply) return hint('Data editing is unavailable here.');
  if (!slide) return hint('Select a slide.');
  // key by slide id so a focused input doesn't carry over to the next slide
  if (slide.layout === 'chart') return <ChartDataEditor key={slide.id} slide={slide} onApply={onApply} />;
  if (slide.layout === 'roadmap') return <RoadmapLanesEditor key={slide.id} slide={slide} onApply={onApply} />;
  if (ITEM_LAYOUTS.includes(slide.layout)) return <ListItemsEditor key={slide.id} slide={slide} onApply={onApply} />;
  if (slide.layout === 'table') return <TableDataEditor key={slide.id} slide={slide} onApply={onApply} />;
  return hint('Data editing applies to chart, roadmap, agenda, list, KPI, split, and table slides — select one on the canvas.');
}
