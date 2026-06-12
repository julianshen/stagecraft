import React from 'react';
import { Button, IconButton } from '../../ui/Primitives.jsx';
import NumberCell from './NumberCell.jsx';
import { roadmapModel, ROADMAP_STATES, ROADMAP_LABELS } from '../../../lib/roadmapSpec.js';

// Inspector editor for a roadmap slide's lanes. Renders the same normalized
// model the canvas and the PPTX export draw (roadmapModel — including its demo
// fallback, so a data-less starter roadmap materializes as editable lanes).
// Every edit commits the WHOLE model ({ lanes, months, todayIndex }): a
// lanes-only patch would flip roadmapModel off its demo fallback and silently
// drop the TODAY marker / month axis the user was looking at.
// Honest trade-off: committing the normalized view persists its normalization —
// out-of-range t/d are clamped and non-{t,d,lbl,state} item extras are dropped
// on the first edit, exactly as the canvas/export resolve them.

export default function RoadmapLanesEditor({ slide, onApply }) {
  const { lanes, months, todayIndex } = roadmapModel(slide);

  const commit = (ls) => onApply({ lanes: ls, months, todayIndex });
  const patchLane = (li, fn) => commit(lanes.map((l, i) => (i === li ? fn(l) : l)));
  const patchItem = (li, ii, patch) =>
    patchLane(li, (l) => ({ ...l, items: l.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) }));

  return (
    <div className="pane-section">
      <h4>Roadmap lanes</h4>
      {lanes.map((lane, li) => (
        <div key={li} style={{ border: '1px solid var(--line)', borderRadius: 4, padding: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <input className="cell-input" value={lane.name} title="Lane name" style={{ flex: 1 }}
              onChange={(e) => patchLane(li, (l) => ({ ...l, name: e.target.value }))} />
            <IconButton name="x" size={10} title="Remove lane" disabled={lanes.length <= 1}
              onClick={() => commit(lanes.filter((_, i) => i !== li))} />
          </div>
          {lane.items.map((it, ii) => (
            <div key={ii} style={{ display: 'grid', gridTemplateColumns: '1fr 44px 44px 86px 20px', gap: 4, alignItems: 'center', marginBottom: 4 }}>
              <input className="cell-input" value={it.lbl} title="Milestone label"
                onChange={(e) => patchItem(li, ii, { lbl: e.target.value })} />
              <NumberCell value={it.t} title="Start month" onCommit={(n) => patchItem(li, ii, { t: n })} />
              <NumberCell value={it.d} title="Duration (months)" onCommit={(n) => patchItem(li, ii, { d: n })} />
              <select className="cell-input" value={it.state} title="State"
                onChange={(e) => patchItem(li, ii, { state: e.target.value })}>
                {ROADMAP_STATES.map((s) => <option key={s} value={s}>{ROADMAP_LABELS[s]}</option>)}
              </select>
              <IconButton name="x" size={10} title="Remove milestone"
                onClick={() => patchLane(li, (l) => ({ ...l, items: l.items.filter((_, j) => j !== ii) }))} />
            </div>
          ))}
          <Button variant="outline" style={{ height: 26, fontSize: 11 }}
            onClick={() => patchLane(li, (l) => ({ ...l, items: [...l.items, { t: 0, d: 2, lbl: 'New milestone', state: 'planned' }] }))}>
            Add milestone
          </Button>
        </div>
      ))}
      <Button variant="outline" style={{ height: 26, fontSize: 11 }}
        onClick={() => commit([...lanes, { name: `Lane ${lanes.length + 1}`, items: [] }])}>
        Add lane
      </Button>
    </div>
  );
}
