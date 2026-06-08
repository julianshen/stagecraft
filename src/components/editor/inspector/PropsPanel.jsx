import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { FieldRow, InputGroup, Seg } from '../../ui/Primitives.jsx';

export default function PropsPanel({ selected, setSelected }) {
  if (!selected) return <div className="pane-section" style={{ color: 'var(--ink-4)', fontSize: 12 }}>Select an element.</div>;
  return (
    <>
      <div className="pane-section">
        <h4>{selected.label || (selected.type ? `${selected.type[0].toUpperCase()}${selected.type.slice(1)} element` : 'Element')}</h4>
        <FieldRow label="POS">
          <div className="double-input">
            <InputGroup icoLeft="X" value={selected.x} onChange={v => setSelected({ ...selected, x: +v || 0 })} unit="px" />
            <InputGroup icoLeft="Y" value={selected.y} onChange={v => setSelected({ ...selected, y: +v || 0 })} unit="px" />
          </div>
        </FieldRow>
        <FieldRow label="SIZE">
          <div className="double-input">
            <InputGroup icoLeft="W" value={selected.w} onChange={v => setSelected({ ...selected, w: +v || 0 })} unit="px" />
            <InputGroup icoLeft="H" value={selected.h} onChange={v => setSelected({ ...selected, h: +v || 0 })} unit="px" />
          </div>
        </FieldRow>
        <FieldRow label="ANGLE"><InputGroup icoLeft="°" value="0" unit="deg" /></FieldRow>
        <FieldRow label="OPACITY"><InputGroup value="100" unit="%" /></FieldRow>
      </div>
      <div className="pane-section">
        <h4>Type</h4>
        <FieldRow label="FAMILY"><div className="input-group"><input value="Inter" readOnly /><Icon name="chevron-down" size={11} /></div></FieldRow>
        <FieldRow label="STYLE"><div className="double-input"><div className="input-group"><input value="Semibold" readOnly /></div><InputGroup value="96" unit="px" /></div></FieldRow>
        <FieldRow label="ALIGN"><Seg value="left" onChange={() => { }} options={[{ v: 'left', ico: 'align-left' }, { v: 'center', ico: 'align-center' }, { v: 'right', ico: 'align-right' }]} /></FieldRow>
        <FieldRow label="STYLE"><div className="seg"><button className="active"><Icon name="bold" size={12} /></button><button><Icon name="italic" size={12} /></button><button><Icon name="underline" size={12} /></button></div></FieldRow>
      </div>
      <div className="pane-section">
        <h4>Fill</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <div style={{ width: 24, height: 24, borderRadius: 4, background: 'var(--ink)', border: '1px solid var(--line)' }} />
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12 }}>#15171C</div>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-4)' }}>100%</span>
        </div>
      </div>
    </>
  );
}
