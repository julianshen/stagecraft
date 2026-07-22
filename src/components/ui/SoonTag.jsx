// SoonTag — a tiny muted pill marking a control that is visible but not yet
// available (honest UI). Dumb/presentational; the consumer handles real
// disabling via `disabled` attrs and the `.is-soon` wrapper class.
// Only the default "Soon" pill is announced as "Coming soon"; a custom label
// (e.g. "Always on" for autosave, which is live, not pending) speaks its own
// text — a hardcoded aria-label would misdescribe it.
export default function SoonTag({ label = 'Soon' }) {
  return (
    <span className="soon-tag" aria-label={label === 'Soon' ? 'Coming soon' : undefined}>{label}</span>
  );
}
