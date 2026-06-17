import Icon from './Icon.jsx';

// Presentational toast stack. State lives in useToasts(); this just renders the
// queue as a polite live region (so screen readers announce new toasts) with a
// dismiss button per row. `tone` drives only the styling class.
export default function Toaster({ toasts = [], onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone || 'info'}`}>
          <span className="toast-msg">{t.message}</span>
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => onDismiss?.(t.id)}>
            <Icon name="x" />
          </button>
        </div>
      ))}
    </div>
  );
}
