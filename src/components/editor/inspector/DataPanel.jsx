import React from 'react';
import ChartDataEditor from './ChartDataEditor.jsx';
import RoadmapLanesEditor from './RoadmapLanesEditor.jsx';

// The inspector's Data tab: in-app authoring for the data-driven layouts.
// Edits flow through the same validated patch path the Co-pilot uses
// (onApply → onApplyAIPatch → sanitizeSlidePatch), so the gate is shared.
export default function DataPanel({ slide, onApply }) {
  const hint = (text) => (
    <div className="pane-section" style={{ color: 'var(--ink-4)', fontSize: 12 }}>{text}</div>
  );
  if (!slide) return hint('Select a slide.');
  // key by slide id so switching slides remounts the editors with fresh state
  if (slide.layout === 'chart') return <ChartDataEditor key={slide.id} slide={slide} onApply={onApply} />;
  if (slide.layout === 'roadmap') return <RoadmapLanesEditor key={slide.id} slide={slide} onApply={onApply} />;
  return hint('Data editing applies to chart and roadmap slides — select one on the canvas.');
}
