import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';

const TSP_MAX_C = 8;
const TSP_MAX_R = 8;

export default function TableSizePicker({ onPick }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState({ r: 0, c: 0 });
  const [dragging, setDragging] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setDragging(false); } }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function commit(r, c) {
    if (r > 0 && c > 0 && onPick) onPick(r, c);
    setOpen(false);
    setDragging(false);
    setHover({ r: 0, c: 0 });
  }

  const label = (hover.c && hover.r) ? `${hover.c} × ${hover.r}` : 'Pick size';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={`btn ghost icon-caret${open ? ' active' : ''}`} title="Add table" style={open ? { background: 'var(--bg-3)', color: 'var(--ink)' } : null} onClick={() => setOpen(v => !v)}>
        <Icon name="table" size={14} /> <Icon name="chevron-down" size={11} style={{ color: 'var(--ink-4)' }} />
      </button>
      {open && (
        <div className="tsp-pop" onMouseLeave={() => !dragging && setHover({ r: 0, c: 0 })}>
          <div className="tsp-label">{label}</div>
          <div
            className="tsp-grid"
            onMouseDown={() => setDragging(true)}
            onMouseUp={() => { if (hover.r && hover.c) commit(hover.r, hover.c); }}
          >
            {Array.from({ length: TSP_MAX_R }).map((_, ri) => (
              Array.from({ length: TSP_MAX_C }).map((_, ci) => {
                const on = ri < hover.r && ci < hover.c;
                return (
                  <div
                    key={`${ri}-${ci}`}
                    className={`tsp-cell${on ? ' on' : ''}`}
                    onMouseEnter={() => setHover({ r: ri + 1, c: ci + 1 })}
                    onClick={() => commit(ri + 1, ci + 1)}
                  />
                );
              })
            ))}
          </div>
          <div className="tsp-hint">Drag or click to size · {TSP_MAX_C}×{TSP_MAX_R} max</div>
        </div>
      )}
    </div>
  );
}
