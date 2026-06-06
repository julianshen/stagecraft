import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { FieldRow, InputGroup } from '../../ui/Primitives.jsx';

export default function AnimPanel() {
  return (
    <>
      <div className="pane-section">
        <h4>Transition</h4>
        <FieldRow label="TYPE"><div className="input-group"><input value="Morph" readOnly /><Icon name="chevron-down" size={11} /></div></FieldRow>
        <FieldRow label="DUR"><InputGroup value="480" unit="ms" /></FieldRow>
      </div>
      <div className="pane-section">
        <h4>Builds</h4>
        {[{ t: 'Fade in', o: 'click 1' }, { t: 'Rise 8px', o: 'click 1, +100ms' }, { t: 'Stagger', o: '3 children' }].map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 4, fontSize: 12, marginBottom: 6 }}>
            <Icon name="dot" size={12} style={{ color: 'var(--accent)' }} />
            <span style={{ flex: 1 }}>{it.t}</span>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-4)' }}>{it.o}</span>
          </div>
        ))}
      </div>
    </>
  );
}
