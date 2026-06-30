// Shared presentational primitives. Pages compose these for visual consistency.

export function Card({ title, count, action, children, flush }) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card__head">
          <div className="row" style={{ gap: 8 }}>
            {title && <h3>{title}</h3>}
            {count != null && <span className="count">{count}</span>}
          </div>
          {action}
        </div>
      )}
      <div className={flush ? 'card__body card__body--flush' : 'card__body'}>{children}</div>
    </section>
  );
}

const BAND_LABEL = { green: 'Green', yellow: 'Yellow', red: 'Red' };

export function StatusBadge({ status, label }) {
  const cls = status === 'green' ? 'green' : status === 'yellow' ? 'yellow' : 'red';
  return (
    <span className={`badge badge--${cls}`}>
      <span className="dot" />
      {label || BAND_LABEL[status] || status}
    </span>
  );
}

export function RiskBadge({ risk }) {
  if (!risk) return <span className="badge badge--neutral">—</span>;
  return <StatusBadge status={risk.band} label={`${BAND_LABEL[risk.band]} · ${risk.score}`} />;
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Empty({ icon = '∅', children }) {
  return (
    <div className="empty">
      <span className="icon">{icon}</span>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && (
        <label>
          {label} {hint && <span className="hint">{hint}</span>}
        </label>
      )}
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, maxWidth }) {
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        style={maxWidth ? { maxWidth } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h3>{title}</h3>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}
