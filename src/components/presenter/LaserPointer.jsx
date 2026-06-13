// The laser dot follows the presenter's pointer. `pos` is a { x, y } percentage
// within the slide container (see lib/laser.js); null means the pointer is off
// the slide, so nothing is drawn. Centred on the point via a translate so the
// glow sits under the cursor rather than down-right of it.
export default function LaserPointer({ enabled, pos }) {
  if (!enabled || !pos) return null;
  return (
    <div
      className="laser-dot"
      style={{
        position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`,
        transform: 'translate(-50%, -50%)',
        width: 20, height: 20, borderRadius: '50%', pointerEvents: 'none',
        background: 'oklch(0.7 0.25 25)',
        boxShadow: '0 0 30px oklch(0.7 0.25 25 / 0.6)',
      }}
    />
  );
}
