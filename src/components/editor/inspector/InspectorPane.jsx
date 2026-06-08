import React from 'react';
import DesignPanel from './DesignPanel.jsx';
import PropsPanel from './PropsPanel.jsx';
import AnimPanel from './AnimPanel.jsx';

export default function InspectorPane({ tab, setTab, selection, setSelection, count, extras }) {
  return (
    <aside className="rightpane">
      <div className="inspector-tabs">
        {['design', 'props', 'anim'].map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'design' ? 'Design' : t === 'props' ? 'Properties' : 'Animate'}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {tab === 'design' && <DesignPanel />}
        {tab === 'props' && <PropsPanel selected={selection} setSelected={setSelection} count={count} />}
        {tab === 'anim' && <AnimPanel />}
        {extras}
      </div>
    </aside>
  );
}
