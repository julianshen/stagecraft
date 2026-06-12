import React from 'react';
import DesignPanel from './DesignPanel.jsx';
import PropsPanel from './PropsPanel.jsx';
import AnimPanel from './AnimPanel.jsx';
import DataPanel from './DataPanel.jsx';

const TAB_LABELS = { design: 'Design', props: 'Properties', data: 'Data', anim: 'Animate' };

export default function InspectorPane({ tab, setTab, selection, setSelection, count, extras, slide, onApplyPatch }) {
  return (
    <aside className="rightpane">
      <div className="inspector-tabs">
        {['design', 'props', 'data', 'anim'].map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
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
    </aside>
  );
}
