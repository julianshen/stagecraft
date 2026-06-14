import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { FieldRow, InputGroup, Seg } from '../../ui/Primitives.jsx';
import { toHex } from '../../../lib/color.js';

export default function PropsPanel({ selected, setSelected, count = 0 }) {
  if (count > 1) return <div className="pane-section" style={{ color: 'var(--ink-4)', fontSize: 12 }}>{count} elements selected — drag to move them together, or align via the toolbar.</div>;
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
        <FieldRow label="ANGLE">
          <InputGroup icoLeft="°" value={selected.rot ?? 0} onChange={v => setSelected({ ...selected, rot: +v || 0 })} unit="deg" />
        </FieldRow>
        <FieldRow label="OPACITY">
          <InputGroup value={selected.opacity ?? 100} onChange={v => setSelected({ ...selected, opacity: Math.max(0, Math.min(100, +v || 0)) })} unit="%" />
        </FieldRow>
      </div>

      {selected.type === 'text' && (
        <div className="pane-section">
          <h4>Content</h4>
          <textarea
            className="props-content"
            rows={3}
            value={selected.content ?? ''}
            onChange={e => setSelected({ ...selected, content: e.target.value })}
            style={{ width: '100%', resize: 'vertical', font: 'inherit', fontSize: 12, padding: 6, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }}
          />
        </div>
      )}

      <div className="pane-section">
        <h4>Fill</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <input
            type="color"
            aria-label="Fill color"
            value={toHex(selected.fill)}
            onChange={e => setSelected({ ...selected, fill: e.target.value })}
            style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--line)', borderRadius: 4, background: 'none' }}
          />
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12 }}>{toHex(selected.fill)}</div>
        </div>
      </div>
      {selected.type === 'text' && (
        <div className="pane-section">
          <h4>Type</h4>
          <FieldRow label="FAMILY">
            <div className="input-group">
              <select aria-label="Font family" value={selected.fontFamily ?? 'Inter'} onChange={e => setSelected({ ...selected, fontFamily: e.target.value })}>
                {['Inter', 'Georgia', 'JetBrains Mono', 'Courier New', 'Arial'].map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <Icon name="chevron-down" size={11} />
            </div>
          </FieldRow>
          <FieldRow label="SIZE"><InputGroup value={selected.fontSize ?? 48} onChange={v => setSelected({ ...selected, fontSize: Math.max(1, +v || 48) })} unit="px" /></FieldRow>
          <FieldRow label="ALIGN">
            <Seg value={selected.align ?? 'left'} onChange={a => setSelected({ ...selected, align: a })}
              options={[{ v: 'left', ico: 'align-left', title: 'Align left' }, { v: 'center', ico: 'align-center', title: 'Align center' }, { v: 'right', ico: 'align-right', title: 'Align right' }]} />
          </FieldRow>
          <FieldRow label="STYLE">
            <div className="seg">
              {[['bold', 'Bold'], ['italic', 'Italic'], ['underline', 'Underline']].map(([k, label]) => (
                <button key={k} className={selected[k] ? 'active' : ''} aria-label={label} onClick={() => setSelected({ ...selected, [k]: !selected[k] })}>
                  <Icon name={k} size={12} />
                </button>
              ))}
            </div>
          </FieldRow>
        </div>
      )}
    </>
  );
}
