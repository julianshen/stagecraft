import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import SoonTag from './SoonTag.jsx';

// ---------------- Avatar ----------------
export function Avatar({ name, color, size = 22, initials }) {
  const i = initials || (name ? name.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase() : '?');
  return (
    <div className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}>
      {i}
    </div>
  );
}

// ---------------- Button / IconButton ----------------
// `soon` marks a visible-but-unbuilt control (honest UI) on both buttons:
// disabled and dimmed via `.is-soon`; a Button also shows the Soon pill, an
// IconButton (no room for it) says so in its tooltip.
export function Button({ children, variant = 'ghost', size, icon, kbd, style, className, soon = false, disabled, ...rest }) {
  const cls = `btn ${variant}${size === 'lg' ? ' lg' : ''}${soon ? ' is-soon' : ''}${className ? ` ${className}` : ''}`;
  return (
    <button className={cls} style={style} disabled={disabled || soon} {...rest}>
      {icon && <Icon name={icon} size={14} />}
      {children}
      {soon && <SoonTag/>}
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
}

export function IconButton({ name, active, title, size = 14, onClick, style, disabled, soon = false }) {
  return (
    <button
      className={`iconbtn${active ? ' active' : ''}${soon ? ' is-soon' : ''}`}
      onClick={onClick}
      title={soon ? `${title} — coming soon` : title}
      style={style}
      disabled={disabled || soon}
    >
      <Icon name={name} size={size} />
    </button>
  );
}

// ---------------- Field / Input ----------------
export function FieldRow({ label, children }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function InputGroup({ icoLeft, unit, value, onChange, placeholder, disabled, ariaLabel, onBlur }) {
  return (
    <div className="input-group">
      {icoLeft && <span className="ico">{icoLeft}</span>}
      <input value={value} onChange={e => onChange && onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

// ---------------- Segmented ----------------
export function Seg({ value, onChange, options, disabled = false }) {
  return (
    <div className={`seg${disabled ? ' is-soon' : ''}`}>
      {options.map(o => (
        <button key={o.v} className={value === o.v ? 'active' : ''} disabled={disabled} onClick={() => !disabled && onChange(o.v)} title={o.title || o.l}>
          {o.ico ? <Icon name={o.ico} size={13} /> : o.l}
        </button>
      ))}
    </div>
  );
}

// ---------------- scalable slide wrapper ----------------
export function ScaledSlide({ children, fit = 'contain', className = '', style }) {
  const ref = useRef(null);
  const innerRef = useRef(null);
  useEffect(() => {
    function tick() {
      const el = ref.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const sx = width / 1920;
      const sy = height / 1080;
      const s = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
      if (innerRef.current) {
        innerRef.current.style.transform = `scale(${s})`;
      }
    }
    tick();
    const ro = new ResizeObserver(tick);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [fit]);
  return (
    <div ref={ref} className={className} style={{ ...style, position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={innerRef} style={{ position: 'absolute', top: 0, left: 0, width: 1920, height: 1080, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  );
}

// ---------------- Tooltip-ish title menu ----------------
export function Menu({ items, style, onClose }) {
  return (
    <div className="ctx" style={style} onClick={e => e.stopPropagation()}>
      {items.map((it, i) =>
        it === '-' ? <div className="ctx-sep" key={i} /> :
        it.header ? <div className="ctx-head" key={i}>{it.header}</div> :
        <div key={i} className="ctx-item" onClick={() => { it.onClick && it.onClick(); onClose && onClose(); }}>
          {it.icon && <span className="ico"><Icon name={it.icon} size={13} /></span>}
          <span className="lbl">{it.label}</span>
          {it.kbd && <span className="kbd">{it.kbd}</span>}
        </div>
      )}
    </div>
  );
}
