import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { FieldRow, InputGroup, Seg } from '../../ui/Primitives.jsx';
import { toHex } from '../../../lib/color.js';
import { isStrokeableShape, isFillableShape } from '../../../lib/shapes.js';
import { DEFAULT_SHADOW, DEFAULT_GRADIENT } from '../../../lib/elements.js';
import { requiresFill } from '../../../lib/deckUtils.js';

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

      {requiresFill(selected.type) && (
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
      )}
      {/* Gradient fill (any shape) overrides the solid fill: a toggle seeds the
          default; the two stops + angle edit it. The export approximates it with
          the midpoint blend (pptxgen has no shape gradient). */}
      {isFillableShape(selected.type) && (
      <div className="pane-section">
        <h4>Gradient</h4>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'var(--f-mono)', padding: '4px 0' }}>
          {/* Gate on presence (not isRenderableGradient): a malformed persisted
              gradient (gate-bypassing write) stays shown so the user can fix it,
              rather than toggling-on overwriting their other valid stop with the
              default. The canvas/export still paint the solid fill until it's
              renderable; the inputs below fall back so none mount as undefined. */}
          <input type="checkbox" aria-label="Gradient" checked={!!selected.gradient}
            onChange={e => setSelected({ ...selected, gradient: e.target.checked ? DEFAULT_GRADIENT : undefined })} />
          Gradient fill
        </label>
        {selected.gradient && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
            <input type="color" aria-label="Gradient from" value={toHex(selected.gradient.from)}
              onChange={e => setSelected({ ...selected, gradient: { ...selected.gradient, from: e.target.value } })}
              style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--line)', borderRadius: 4, background: 'none' }} />
            <input type="color" aria-label="Gradient to" value={toHex(selected.gradient.to)}
              onChange={e => setSelected({ ...selected, gradient: { ...selected.gradient, to: e.target.value } })}
              style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--line)', borderRadius: 4, background: 'none' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 2, fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
              °
              <input type="number" aria-label="Gradient angle" value={selected.gradient.angle ?? ''}
                onChange={e => setSelected({ ...selected, gradient: { ...selected.gradient, angle: +e.target.value || 0 } })}
                style={{ width: 44, height: 28, padding: '0 4px', border: '1px solid var(--line)', borderRadius: 4, background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'var(--f-mono)', fontSize: 12 }} />
            </label>
          </div>
        )}
      </div>
      )}
      {/* A path is stroked, not filled — its colour/width live in stroke/strokeWidth,
          so it reuses this Stroke section (box shapes show it as an optional outline). */}
      {(isStrokeableShape(selected.type) || selected.type === 'path') && (
      <div className="pane-section">
        <h4>Stroke</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          {/* The outline needs BOTH a colour and a positive width to render, so
              setting either seeds the other: picking a colour seeds a 1px width,
              and a positive width seeds black — otherwise a single edit shows nothing. */}
          <input
            type="color"
            aria-label="Stroke color"
            value={toHex(selected.stroke || '#000000')}
            onChange={e => setSelected({ ...selected, stroke: e.target.value, strokeWidth: selected.strokeWidth || 1 })}
            style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--line)', borderRadius: 4, background: 'none' }}
          />
          <input
            type="number"
            aria-label="Stroke width"
            min={0}
            value={selected.strokeWidth ?? 0}
            onChange={e => {
              const strokeWidth = Math.max(0, +e.target.value || 0);
              setSelected({ ...selected, strokeWidth, stroke: strokeWidth > 0 ? (selected.stroke || '#000000') : selected.stroke });
            }}
            style={{ width: 56, height: 28, padding: '0 6px', border: '1px solid var(--line)', borderRadius: 4, background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'var(--f-mono)', fontSize: 12 }}
          />
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink-4)' }}>px</span>
        </div>
      </div>
      )}
      {/* Drop shadow applies to any element (the CSS filter follows the shape). A
          toggle seeds the default; the colour/blur/offset edit the shadow object. */}
      <div className="pane-section">
        <h4>Shadow</h4>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'var(--f-mono)', padding: '4px 0' }}>
          <input type="checkbox" aria-label="Shadow" checked={!!selected.shadow}
            onChange={e => setSelected({ ...selected, shadow: e.target.checked ? DEFAULT_SHADOW : undefined })} />
          Drop shadow
        </label>
        {selected.shadow && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
            <input type="color" aria-label="Shadow color" value={toHex(selected.shadow.color)}
              onChange={e => setSelected({ ...selected, shadow: { ...selected.shadow, color: e.target.value } })}
              style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--line)', borderRadius: 4, background: 'none' }} />
            {[['blur', 'Shadow blur', 'B'], ['x', 'Shadow X', 'X'], ['y', 'Shadow Y', 'Y']].map(([k, label, ico]) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 2, fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
                {ico}
                <input type="number" aria-label={label} min={k === 'blur' ? 0 : undefined} value={selected.shadow[k]}
                  onChange={e => { const n = k === 'blur' ? Math.max(0, +e.target.value || 0) : (+e.target.value || 0); setSelected({ ...selected, shadow: { ...selected.shadow, [k]: n } }); }}
                  style={{ width: 44, height: 28, padding: '0 4px', border: '1px solid var(--line)', borderRadius: 4, background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'var(--f-mono)', fontSize: 12 }} />
              </label>
            ))}
          </div>
        )}
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
