import React from 'react';
import DesignPanel from './DesignPanel.jsx';
import PropsPanel from './PropsPanel.jsx';
import AnimPanel from './AnimPanel.jsx';
import DataPanel from './DataPanel.jsx';

const TAB_LABELS = { design: 'Design', props: 'Props', data: 'Data', anim: 'Anim' };

export default function FloatingInspector({ tab, setTab, selection, setSelection, count, extras, slide, onApplyPatch }) {
  return (
    <div style={{ position: 'fixed', right: 16, top: 120, width: 300, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-2)', zIndex: 40, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 200px)' }}>
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
    </div>
  );
}
