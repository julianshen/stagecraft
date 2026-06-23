import React from 'react';
import DesignPanel from './DesignPanel.jsx';
import PropsPanel from './PropsPanel.jsx';
import AnimPanel from './AnimPanel.jsx';
import DataPanel from './DataPanel.jsx';
import NotesPanel from './NotesPanel.jsx';

// The tab strip + panel switch shared by the docked (InspectorPane) and
// floating (FloatingInspector) shells. `labels` supplies the per-shell button
// copy and its key order is the tab order — so a new tab is wired here (the
// panel switch) plus a label entry in each shell.
export default function InspectorBody({ labels, tab, setTab, selection, setSelection, count, extras, slide, onApplyPatch, deck, onChangeTheme, onChangeLayout, onAddComponent }) {
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
        {tab === 'design' && <DesignPanel deck={deck} current={slide?.layout} onChangeLayout={onChangeLayout} onChangeTheme={onChangeTheme} onAddComponent={onAddComponent} />}
        {tab === 'props' && <PropsPanel selected={selection} setSelected={setSelection} count={count} />}
        {tab === 'data' && <DataPanel slide={slide} onApply={onApplyPatch} />}
        {tab === 'notes' && <NotesPanel slide={slide} onApply={onApplyPatch} />}
        {tab === 'anim' && <AnimPanel />}
        {extras}
      </div>
    </>
  );
}
