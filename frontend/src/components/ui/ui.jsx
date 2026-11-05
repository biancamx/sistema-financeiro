import { useEffect, useId, useRef } from 'react';
import { money } from '../../lib/format.js';

export function Button({ variant = 'default', size, className = '', ...p }) {
  return <button type="button" className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`} {...p} />;
}

export function Field({ label, hint, error, children }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      {children(id)}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Select({ value, onChange, options, placeholder, id, ...rest }) {
  return (
    <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Modal({ open, title, children, footer, wide, className = '', onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''} ${className}`}
      aria-label={title}
      onCancel={(event) => event.preventDefault()}
    >
      {open && (
        <div className="modal-body">
          <header className="modal-head">
            <h2>{title}</h2>
            {onClose && (
              <button type="button" className="modal-close" aria-label="Fechar modal" onClick={onClose}>
                ×
              </button>
            )}
          </header>
          <div className="modal-content">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export const Spinner = ({ label = 'Carregando…' }) => (
  <div className="spinner" role="status"><span className="spinner-dot" />{label}</div>
);

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state state-error">
      <strong>Não foi possível carregar</strong>
      <p>{error?.message}</p>
      {onRetry && <Button onClick={onRetry}>Tentar de novo</Button>}
    </div>
  );
}

export const EmptyState = ({ title, children }) => (
  <div className="state">
    <strong>{title}</strong>
    {children && <p>{children}</p>}
  </div>
);

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export const Card = ({ title, aside, children, className = '' }) => (
  <section className={`card ${className}`}>
    {(title || aside) && (
      <header className="card-head">
        {title && <h2>{title}</h2>}
        {aside}
      </header>
    )}
    {children}
  </section>
);

export const Money = ({ value, tone, strong }) => (
  <span className={`money ${tone ? `money-${tone}` : ''} ${strong ? 'money-strong' : ''} ${Number(value) < 0 ? 'money-neg' : ''}`}>{money(value)}</span>
);

export function Bar({ value, max, tone = 'primary' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="bar" role="presentation">
      <div className={`bar-fill bar-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function useConfirm() {
  return (msg) => window.confirm(msg);
}
