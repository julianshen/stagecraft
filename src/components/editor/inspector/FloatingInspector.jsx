import React from 'react';
import DesignPanel from './DesignPanel.jsx';
import PropsPanel from './PropsPanel.jsx';
import AnimPanel from './AnimPanel.jsx';

export default function FloatingInspector({ tab, setTab, selection, setSelection, extras }) {
  return (
    <div style={{ position: 'fixed', right: 16, top: 120, width: 300, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-2)', zIndex: 40, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 200px)' }}>
      <div className="inspector-tabs">
        {['design', 'props', 'anim'].map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'design' ? 'Design' : t === 'props' ? 'Props' : 'Anim'}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {tab === 'design' && <DesignPanel />}
        {tab === 'props' && <PropsPanel selected={selection} setSelected={setSelection} />}
        {tab === 'anim' && <AnimPanel />}
        {extras}
      </div>
    </div>
  );
}
