import { useState, useRef } from 'react';
import { pointerToPct } from '../../lib/laser.js';
import LaserPointer from './LaserPointer.jsx';

// Owns the laser's pointer-tracking state so a mouse move re-renders only the
// dot — NOT the whole presenter and its (un-memoized) <Slide>, which would
// otherwise reconcile the entire slide tree on every pointermove. Mounts a
// transparent capture layer over the slide only while the laser is enabled.
export default function LaserLayer({ enabled }) {
  const [pos, setPos] = useState(null);
  // The layer's box is fixed for the duration of a hover, so measure it once on
  // enter and reuse it — reading getBoundingClientRect on every move would force
  // a synchronous layout (the dot's position write dirties layout, so the next
  // read reflows: classic read-after-write thrashing at pointer-move rate).
  const rectRef = useRef(null);
  if (!enabled) return null;
  return (
    <div
      className="laser-layer"
      onPointerEnter={(e) => { rectRef.current = e.currentTarget.getBoundingClientRect(); }}
      onPointerMove={(e) => {
        const rect = rectRef.current || e.currentTarget.getBoundingClientRect();
        setPos(pointerToPct(rect, e.clientX, e.clientY));
      }}
      onPointerLeave={() => { rectRef.current = null; setPos(null); }}
    >
      <LaserPointer enabled pos={pos} />
    </div>
  );
}
