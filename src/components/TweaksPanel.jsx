import { useState, useEffect } from 'react';
import Icon from './ui/Icon.jsx';
import { IconButton } from './ui/Primitives.jsx';
import { ACCENTS } from '../data/deck.js';

export const TWEAK_DEFAULTS = {
  theme:   'light',
  accent:  'indigo',
  layout:  'default',
  density: 'default',
};

export default function TweaksPanel({ state, setState }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onMsg(e) {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === '__activate_edit_mode')   setOpen(true);
      if (e.data.type === '__deactivate_edit_mode') setOpen(false);
    }
    window.addEventListener('message', onMsg);
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch {}
    return () => window.removeEventListener('message', onMsg);
  }, []);

  function update(patch) {
    const next = { ...state, ...patch };
    setState(next);
    try { window.parent.postMessage({ type: '__edit_mode_set_keys', edits: patch }, '*'); } catch {}
  }

  if (!open) return null;

  return (
    <div className="tweaks-panel">
      <h5>
        Tweaks
        <IconButton name="x" onClick={() => setOpen(false)}/>
      </h5>
      <div className="row">
        <span className="lbl">Theme</span>
        <div className="seg" style={{ width: 110 }}>
          <button className={state.theme === 'light' ? 'active' : ''} onClick={() => update({ theme: 'light' })}>
            <Icon name="sun" size={12}/>
          </button>
          <button className={state.theme === 'dark' ? 'active' : ''} onClick={() => update({ theme: 'dark' })}>
            <Icon name="moon" size={12}/>
          </button>
        </div>
      </div>
      <div className="row">
        <span className="lbl">Accent</span>
        <div className="accents">
          {Object.entries(ACCENTS).map(([k, v]) => (
            <div
              key={k}
              className={`accent-dot${state.accent === k ? ' active' : ''}`}
              style={{ background: `oklch(0.62 ${v.chroma} ${v.hue})` }}
              title={v.name}
              onClick={() => update({ accent: k })}
            />
          ))}
        </div>
      </div>
      <div className="row">
        <span className="lbl">Layout</span>
        <div className="seg" style={{ width: 160 }}>
          <button className={state.layout === 'default'   ? 'active' : ''} onClick={() => update({ layout: 'default' })}   title="Thumbs + inspector">3-col</button>
          <button className={state.layout === 'left-only' ? 'active' : ''} onClick={() => update({ layout: 'left-only' })} title="Hide inspector">2-col</button>
          <button className={state.layout === 'floating'  ? 'active' : ''} onClick={() => update({ layout: 'floating' })}  title="Floating">Float</button>
        </div>
      </div>
      <div className="row">
        <span className="lbl">Density</span>
        <div className="seg" style={{ width: 160 }}>
          <button className={state.density === 'compact' ? 'active' : ''} onClick={() => update({ density: 'compact' })}>XS</button>
          <button className={state.density === 'default' ? 'active' : ''} onClick={() => update({ density: 'default' })}>M</button>
          <button className={state.density === 'cozy'    ? 'active' : ''} onClick={() => update({ density: 'cozy' })}>L</button>
        </div>
      </div>
    </div>
  );
}
