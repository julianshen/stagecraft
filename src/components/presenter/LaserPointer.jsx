// The laser dot follows the presenter's pointer. `pos` is a { x, y } percentage
// within the slide container (see lib/laser.js); null means the pointer is off
// the slide, so nothing is drawn. Centred on the point via a translate so the
// glow sits under the cursor rather than down-right of it.
export default function LaserPointer({ enabled, pos }) {
  if (!enabled || !pos) return null;
  // Only the position is dynamic; the dot's look (size, colour, glow) lives in
  // the .laser-dot CSS rule. Centred on the point via translate.
  return (
    <div
      className="laser-dot"
      style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
    />
  );
}
