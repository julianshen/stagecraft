import React from 'react';
import InspectorBody from './InspectorBody.jsx';

const LABELS = Object.freeze({ design: 'Design', props: 'Properties', data: 'Data', notes: 'Notes', anim: 'Animate' });

export default function InspectorPane(props) {
  return (
    <aside className="rightpane">
      <InspectorBody labels={LABELS} {...props} />
    </aside>
  );
}
