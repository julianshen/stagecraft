import React from 'react';
import Icon from '../../ui/Icon.jsx';

// Deep-frozen (array + each option) like the other shared constant tables
// (SHAPES, CHART_SERIES_HEX, …) so a consumer can't mutate the shared vocabulary.
export const LAYOUT_OPTIONS = Object.freeze([
  { id: 'cover', icon: 'frame', label: 'Cover' },
  { id: 'agenda', icon: 'list', label: 'Agenda' },
  { id: 'divider', icon: 'flag', label: 'Section' },
  { id: 'kpi', icon: 'bolt', label: 'KPI grid' },
  { id: 'chart', icon: 'chart-bar', label: 'Chart' },
  { id: 'split', icon: 'columns', label: 'Split' },
  { id: 'table', icon: 'table', label: 'Table' },
  { id: 'text', icon: 'text', label: 'Text' },
  { id: 'list', icon: 'list', label: 'List' },
  { id: 'roadmap', icon: 'timeline', label: 'Roadmap' },
  { id: 'risks', icon: 'flag', label: 'Risks' },
  { id: 'thanks', icon: 'frame', label: 'Closing' },
].map(Object.freeze));

// id → display label, derived from LAYOUT_OPTIONS so the two can't drift. The toolbar
// menu's trigger button reads it (`LAYOUT_LABELS[current]`); the grid cards use .label.
export const LAYOUT_LABELS = Object.freeze(Object.fromEntries(LAYOUT_OPTIONS.map(o => [o.id, o.label])));

// The shared per-slide layout picker: a grid of layout cards. Rendered both in the
// toolbar Layout menu (inside its popover chrome) and the Design inspector panel, so
// the two entry points to onChangeLayout can't drift — markup, styling (.layout-grid /
// .layout-opt), and the LAYOUT_OPTIONS vocabulary are all single-sourced here. The
// active card mirrors `current`; `aria-label` names each card ("Chart layout") so it
// reads distinctly from same-named controls elsewhere (e.g. the Components rail chips).
export function LayoutGrid({ current, onPick }) {
  return (
    <div className="layout-grid">
      {LAYOUT_OPTIONS.map(o => (
        <button
          key={o.id}
          type="button"
          className={`layout-opt${current === o.id ? ' on' : ''}`}
          aria-label={`${o.label} layout`}
          onClick={() => onPick?.(o.id)}
        >
          <Icon name={o.icon} size={15} />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
