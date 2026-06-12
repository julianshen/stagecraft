import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { roadmapModel, ROADMAP_STATES, ROADMAP_LABELS } from '../../../lib/roadmapSpec.js';

// Inspector editor for a roadmap slide's lanes. Renders the same normalized
// model the canvas and the PPTX export draw (roadmapModel — including its demo
// fallback, so a data-less starter roadmap materializes as editable lanes),
// and commits every edit as a full `{ lanes }` patch through the patch gate.

const num = (v) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : 0);

const cellInput = { minWidth: 0, height: 24, fontSize: 11, padding: '0 6px', border: '1px solid var(--line)', borderRadius: 3, background: 'var(--bg)', color: 'var(--ink)' };

export default function RoadmapLanesEditor({ slide, onApply }) {
  const { lanes } = roadmapModel(slide);

  // Strip the model down to exactly the persisted lane shape the gate accepts.
  const commit = (ls) => onApply({
    lanes: ls.map((l) => ({ name: l.name, items: l.items.map(({ t, d, lbl, state }) => ({ t, d, lbl, state })) })),
  });

  const patchLane = (li, fn) => commit(lanes.map((l, i) => (i === li ? fn(l) : l)));
  const patchItem = (li, ii, patch) =>
    patchLane(li, (l) => ({ ...l, items: l.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) }));

  return (
    <div className="pane-section">
      <h4>Roadmap lanes</h4>
      {lanes.map((lane, li) => (
        <div key={li} style={{ border: '1px solid var(--line)', borderRadius: 4, padding: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <input value={lane.name} title="Lane name" style={{ ...cellInput, flex: 1 }}
              onChange={(e) => patchLane(li, (l) => ({ ...l, name: e.target.value }))} />
            <button className="iconbtn" title="Remove lane" disabled={lanes.length <= 1}
              onClick={() => commit(lanes.filter((_, i) => i !== li))}><Icon name="x" size={10} /></button>
          </div>
          {lane.items.map((it, ii) => (
            <div key={ii} style={{ display: 'grid', gridTemplateColumns: '1fr 44px 44px 86px 20px', gap: 4, alignItems: 'center', marginBottom: 4 }}>
              <input value={it.lbl} title="Milestone label" style={cellInput}
                onChange={(e) => patchItem(li, ii, { lbl: e.target.value })} />
              <input type="number" value={it.t} title="Start month" style={cellInput}
                onChange={(e) => patchItem(li, ii, { t: num(e.target.value) })} />
              <input type="number" value={it.d} title="Duration (months)" style={cellInput}
                onChange={(e) => patchItem(li, ii, { d: num(e.target.value) })} />
              <select value={it.state} title="State" style={cellInput}
                onChange={(e) => patchItem(li, ii, { state: e.target.value })}>
                {ROADMAP_STATES.map((s) => <option key={s} value={s}>{ROADMAP_LABELS[s]}</option>)}
              </select>
              <button className="iconbtn" title="Remove milestone"
                onClick={() => patchLane(li, (l) => ({ ...l, items: l.items.filter((_, j) => j !== ii) }))}><Icon name="x" size={10} /></button>
            </div>
          ))}
          <button className="btn outline" style={{ height: 24, fontSize: 11 }}
            onClick={() => patchLane(li, (l) => ({ ...l, items: [...l.items, { t: 0, d: 2, lbl: 'New milestone', state: 'planned' }] }))}>
            Add milestone
          </button>
        </div>
      ))}
      <button className="btn outline" style={{ height: 26, fontSize: 11 }}
        onClick={() => commit([...lanes, { name: `Lane ${lanes.length + 1}`, items: [] }])}>
        Add lane
      </button>
    </div>
  );
}
