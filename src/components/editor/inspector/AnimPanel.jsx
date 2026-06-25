import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { FieldRow, InputGroup } from '../../ui/Primitives.jsx';
import { TRANSITION_TYPES } from '../../../lib/deckUtils.js';

const DEFAULT_DURATION = 480; // ms — seeds the DUR field when a slide has no transition yet
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The slide-transition editor. TYPE + DUR read the live `slide.transition` (else
// a none/480ms default) and commit through the shared patch gate (onApply →
// sanitizeSlidePatch), the same path the Data/Notes panels use. The gate requires
// the WHOLE { type, duration }, so each control commits both halves (one edit can't
// drop the other). The Builds section below is still a mockup (Transition first).
export default function AnimPanel({ slide, onApply }) {
  const tr = slide?.transition || {};
  const type = TRANSITION_TYPES.has(tr.type) ? tr.type : 'none';
  const duration = Number.isFinite(tr.duration) && tr.duration > 0 ? tr.duration : DEFAULT_DURATION;
  // Commit the WHOLE { type, duration } (the gate requires both); the controls are
  // disabled when there's no slide, so this only fires with a real target.
  const apply = (next) => onApply?.({ transition: { type, duration, ...next } });
  return (
    <>
      <div className="pane-section">
        <h4>Transition</h4>
        <FieldRow label="TYPE">
          <div className="input-group">
            <select aria-label="Transition type" value={type} disabled={!slide}
              onChange={(e) => apply({ type: e.target.value })}>
              {[...TRANSITION_TYPES].map((t) => <option key={t} value={t}>{cap(t)}</option>)}
            </select>
            <Icon name="chevron-down" size={11} />
          </div>
        </FieldRow>
        <FieldRow label="DUR">
          <InputGroup ariaLabel="Transition duration" unit="ms" value={String(duration)} disabled={!slide}
            onChange={(v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) apply({ duration: n }); }} />
        </FieldRow>
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
