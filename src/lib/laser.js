// Presenter laser geometry. The slide is drawn into a container whose on-screen
// size varies with the viewport (ScaledSlide), so the laser dot is positioned in
// PERCENT of that container rather than absolute px — the same fraction lands on
// the same point at any scale. Pure so it can be unit-tested without layout.

const clampPct = (n) => Math.max(0, Math.min(100, n));

// Map a pointer (clientX/clientY) to a { x, y } percentage within `rect`,
// clamped to [0,100]. Returns null when there's no area to map onto (no rect, or
// a zero width/height — e.g. before first layout), so callers can hide the dot.
export function pointerToPct(rect, clientX, clientY) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: clampPct(((clientX - rect.left) / rect.width) * 100),
    y: clampPct(((clientY - rect.top) / rect.height) * 100),
  };
}
