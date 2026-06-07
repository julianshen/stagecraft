import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';

const SHAPE_TOOLS = [
  { id: 'shape', icon: 'shape', label: 'Rectangle' },
  { id: 'rounded', icon: 'rounded-rect', label: 'Rounded' },
  { id: 'circle', icon: 'circle', label: 'Ellipse' },
  { id: 'triangle', icon: 'triangle', label: 'Triangle' },
  { id: 'diamond', icon: 'diamond', label: 'Diamond' },
  { id: 'pentagon', icon: 'pentagon', label: 'Pentagon' },
  { id: 'hexagon', icon: 'hexagon', label: 'Hexagon' },
  { id: 'star', icon: 'star', label: 'Star' },
  { id: 'line', icon: 'line', label: 'Line' },
  { id: 'arrow', icon: 'arrow-shape', label: 'Arrow' },
];
const SHAPE_IDS = SHAPE_TOOLS.map(s => s.id);

export default function ShapeMenu({ tool, setTool }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const active = SHAPE_IDS.includes(tool);
  const current = SHAPE_TOOLS.find(s => s.id === tool) || SHAPE_TOOLS[0];
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className={`iconbtn shape-trigger${active ? ' active' : ''}`}
        title="Shapes"
        onClick={() => { setTool(current.id); setOpen(v => !v); }}
      >
        <Icon name={current.icon} size={14} />
        <span className="shape-caret"><Icon name="chevron-down" size={8} /></span>
      </button>
      {open && (
        <div className="shape-pop">
          <div className="tsp-label">Shapes</div>
          <div className="shape-grid">
            {SHAPE_TOOLS.map(s => (
              <button
                key={s.id}
                className={`shape-cell${tool === s.id ? ' on' : ''}`}
                title={s.label}
                onClick={() => { setTool(s.id); setOpen(false); }}
              >
                <Icon name={s.icon} size={16} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
