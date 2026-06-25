import { TRANSITION_TYPES } from './deckUtils.js';

// The slide-transition types the presenter can play — the gate's vocabulary
// (`TRANSITION_TYPES`) minus 'none' (an instant cut). Derived, not re-listed, so a
// new gate type is playable by default — but its `present-<type>` keyframe must be
// added to `styles/main.css` ('morph' is approximated there as a scale-in).
const PLAYABLE = new Set([...TRANSITION_TYPES].filter((t) => t !== 'none'));

// Map a slide's `{ type, duration }` transition to the CSS `animation` shorthand
// the presenter applies to the entering slide, or '' for none/missing/malformed
// (an instant cut). Defensive on `duration` — a raw server/MCP write can bypass
// the patch gate, so don't trust the shape here either.
export function transitionAnim(transition) {
  const t = transition;
  if (!t || !PLAYABLE.has(t.type) || !(Number.isFinite(t.duration) && t.duration > 0)) return '';
  return `present-${t.type} ${t.duration}ms ease both`;
}
