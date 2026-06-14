import { useState, useRef, useEffect } from 'react';
import Icon from '../ui/Icon.jsx';
import { toHex } from '../../lib/color.js';

const SIZE_STEP = 2;

// A floating formatting bar for inline-edited template text. It tracks document
// focus: when any [data-fmt-key] field is focused it floats above it (fixed
// viewport coords, so the canvas transform/scroll don't offset it) offering
// B/I/U, a size stepper, and a colour picker. Edits route through `onFormat`
// (which the Editor turns into a validated `fmt` patch). The bar self-manages
// from the DOM rather than a "selected field" state so it stays decoupled from
// the shared renderer — only the focused field's path-key and rect matter.
export default function FormatToolbar({ currentSlide, onFormat }) {
  // { key, rect, fontSize } for the focused field, or null when none is.
  const [active, setActive] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const onIn = (e) => {
      const key = e.target?.dataset?.fmtKey;
      if (!key) return; // focus landed on a non-field (incl. the toolbar itself)
      const fontSize = parseInt(window.getComputedStyle(e.target).fontSize, 10) || null;
      setActive({ key, rect: e.target.getBoundingClientRect(), fontSize });
    };
    // Hide when focus genuinely leaves the field — but not when it moves into the
    // toolbar (e.g. the colour input), which would otherwise unmount it mid-pick.
    const onOut = (e) => {
      if (ref.current && e.relatedTarget && ref.current.contains(e.relatedTarget)) return;
      setActive(null);
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  if (!active) return null;
  const fmt = currentSlide?.fmt?.[active.key] || {};
  const size = fmt.fontSize ?? active.fontSize; // null when the field has no computed size
  // Keep the contentEditable field focused: a mousedown on a button steals focus
  // (committing the edit and hiding this bar) unless we prevent it. The colour
  // input is exempt — it needs the native focus to open the picker, and the
  // focusout guard above keeps the bar alive while it's focused.
  const keep = (e) => e.preventDefault();
  const toggle = (prop) => onFormat(active.key, prop, !fmt[prop]);
  const step = (delta) => { if (size != null) onFormat(active.key, 'fontSize', Math.max(1, size + delta)); };

  return (
    <div
      ref={ref}
      className="format-toolbar"
      style={{ position: 'fixed', top: Math.max(4, (active.rect?.top || 0) - 44), left: active.rect?.left || 0, zIndex: 50 }}
    >
      <div className="seg">
        {[['bold', 'Bold'], ['italic', 'Italic'], ['underline', 'Underline']].map(([k, label]) => (
          <button key={k} className={fmt[k] ? 'active' : ''} aria-label={label} onMouseDown={keep} onClick={() => toggle(k)}>
            <Icon name={k} size={12} />
          </button>
        ))}
      </div>
      <button aria-label="Decrease size" onMouseDown={keep} onClick={() => step(-SIZE_STEP)}><Icon name="minus" size={12} /></button>
      <span className="fmt-size">{size ?? '—'}</span>
      <button aria-label="Increase size" onMouseDown={keep} onClick={() => step(SIZE_STEP)}><Icon name="plus" size={12} /></button>
      <input type="color" aria-label="Text color" value={toHex(fmt.color)} onInput={(e) => onFormat(active.key, 'color', e.target.value)} />
    </div>
  );
}
