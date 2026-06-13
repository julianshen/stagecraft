import { useState } from 'react';
import { pointerToPct } from '../../lib/laser.js';
import LaserPointer from './LaserPointer.jsx';

// Owns the laser's pointer-tracking state so a mouse move re-renders only the
// dot — NOT the whole presenter and its (un-memoized) <Slide>, which would
// otherwise reconcile the entire slide tree on every pointermove. Mounts a
// transparent capture layer over the slide only while the laser is enabled.
export default function LaserLayer({ enabled }) {
  const [pos, setPos] = useState(null);
  if (!enabled) return null;
  return (
    <div
      className="laser-layer"
      onPointerMove={(e) => setPos(pointerToPct(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY))}
      onPointerLeave={() => setPos(null)}
    >
      <LaserPointer enabled pos={pos} />
    </div>
  );
}
