import React from 'react';
import DesignPanel from './DesignPanel.jsx';
import PropsPanel from './PropsPanel.jsx';
import AnimPanel from './AnimPanel.jsx';
import DataPanel from './DataPanel.jsx';

// The tab strip + panel switch shared by the docked (InspectorPane) and
// floating (FloatingInspector) shells — one place to wire a new tab. `labels`
// supplies the per-shell button copy; its key order is the tab order.
export default function InspectorBody({ labels, tab, setTab, selection, setSelection, count, extras, slide, onApplyPatch }) {
  return (
    <>
      <div className="inspector-tabs">
        {Object.keys(labels).map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {labels[t]}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {tab === 'design' && <DesignPanel />}
        {tab === 'props' && <PropsPanel selected={selection} setSelected={setSelection} count={count} />}
        {tab === 'data' && <DataPanel slide={slide} onApply={onApplyPatch} />}
        {tab === 'anim' && <AnimPanel />}
        {extras}
      </div>
    </>
  );
}
