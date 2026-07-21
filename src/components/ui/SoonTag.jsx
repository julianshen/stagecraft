// SoonTag — a tiny muted pill marking a control that is visible but not yet
// available (honest UI). Dumb/presentational; the consumer handles real
// disabling via `disabled` attrs and the `.is-soon` wrapper class.
export default function SoonTag({ label = 'Soon' }) {
  return (
    <span className="soon-tag" aria-label="Coming soon">{label}</span>
  );
}
