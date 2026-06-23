import React from 'react';
import InspectorBody from './InspectorBody.jsx';

const LABELS = { design: 'Design', props: 'Props', data: 'Data', notes: 'Notes', anim: 'Anim' };

export default function FloatingInspector(props) {
  return (
    <div style={{ position: 'fixed', right: 16, top: 120, width: 300, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-2)', zIndex: 40, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 200px)' }}>
      <InspectorBody labels={LABELS} {...props} />
    </div>
  );
}
