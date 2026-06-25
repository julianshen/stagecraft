import React, { useState, useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';
import { FieldRow, InputGroup, Button, IconButton } from '../../ui/Primitives.jsx';
import { TRANSITION_TYPES, BUILD_TYPES } from '../../../lib/deckUtils.js';

const DEFAULT_DURATION = 480; // ms — seeds the DUR field when a slide has no transition yet
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// "fadeIn" → "Fade In" for the build TYPE options (derived, so a new BUILD_TYPE is labelled).
const buildLabel = (t) => cap(t.replace(/([A-Z])/g, ' $1'));

// The slide-transition editor. TYPE + DUR read the live `slide.transition` (else
// a none/480ms default) and commit through the shared patch gate (onApply →
// sanitizeSlidePatch), the same path the Data/Notes panels use. The gate requires
// the WHOLE { type, duration }, so each control commits both halves (one edit can't
// drop the other). Builds (below) are a per-slide list of entrance animations.
export default function AnimPanel({ slide, onApply }) {
  const tr = slide?.transition || {};
  const type = TRANSITION_TYPES.has(tr.type) ? tr.type : 'none';
  const duration = Number.isFinite(tr.duration) && tr.duration > 0 ? tr.duration : DEFAULT_DURATION;
  // The DUR field tolerates incomplete input (a cleared field on the way to a new
  // value) via a local string, committing only a valid >0 number and reverting to
  // the committed value on blur — the NumberCell pattern. (A positive-only commit-
  // on-change input would otherwise snap a cleared field back, leaving it untypeable.)
  const [durRaw, setDurRaw] = useState(String(duration));
  useEffect(() => { setDurRaw(String(duration)); }, [duration]);
  // Commit the WHOLE { type, duration } (the gate requires both); the controls are
  // disabled when there's no slide, so this only fires with a real target.
  const apply = (next) => onApply?.({ transition: { type, duration, ...next } });
  // Builds: a per-slide array of entrance animations. The whole array is committed
  // (the gate replaces it); rows key by index (v1 has no reorder). Filter to
  // renderable entries first — the MCP update_slide / PUT /api/deck paths bypass the
  // gate, so a persisted deck can carry junk (null, a non-object, an unknown type) and
  // rendering it raw would deref b.type and crash the inspector. Same defence
  // isRenderableShadow/Gradient give the canvas; BUILD_TYPES is the shared vocabulary.
  const builds = Array.isArray(slide?.builds)
    ? slide.builds.filter((b) => b && typeof b === 'object' && BUILD_TYPES.has(b.type))
    : [];
  const commitBuilds = (next) => onApply?.({ builds: next });
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
          <InputGroup ariaLabel="Transition duration" unit="ms" value={durRaw} disabled={!slide}
            onChange={(v) => { setDurRaw(v); const n = Number(v); if (Number.isFinite(n) && n > 0) apply({ duration: n }); }}
            onBlur={() => setDurRaw(String(duration))} />
        </FieldRow>
      </div>
      <div className="pane-section">
        <h4>Builds</h4>
        {builds.map((b, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
            <div className="input-group" style={{ flex: 1 }}>
              <select aria-label={`Build ${i + 1} type`} value={b.type} disabled={!slide}
                onChange={(e) => commitBuilds(builds.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                {[...BUILD_TYPES].map((t) => <option key={t} value={t}>{buildLabel(t)}</option>)}
              </select>
              <Icon name="chevron-down" size={11} />
            </div>
            <IconButton name="trash" size={12} title={`Delete build ${i + 1}`} disabled={!slide}
              onClick={() => commitBuilds(builds.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button variant="outline" style={{ height: 26, fontSize: 11 }} disabled={!slide}
          onClick={() => commitBuilds([...builds, { type: 'fadeIn' }])}>Add build</Button>
      </div>
    </>
  );
}
