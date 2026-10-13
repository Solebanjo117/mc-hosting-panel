import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { STATUS_LABEL } from './api.js';

export function Status({ state }) {
  return (
    <span className="status">
      <i className={`dot ${state}`} aria-hidden="true" />
      {STATUS_LABEL[state] || state}
    </span>
  );
}

export function Progress({ value }) {
  const indeterminate = value == null;
  return (
    <div className={`progress${indeterminate ? ' indeterminate' : ''}`} role="progressbar" aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}>
      <i style={{ width: `${indeterminate ? 30 : Math.round(value * 100)}%` }} />
    </div>
  );
}

export function Modal({ title, children, onClose, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row">
          <h2 className="grow">{title}</h2>
          {onClose && (
            <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random();
    setItems((list) => [...list, { id, message, kind }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Ejecuta una acción async mostrando el error como aviso. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn, success) => {
      setBusy(true);
      try {
        const r = await fn();
        if (success) toast(success);
        return r;
      } catch (err) {
        toast(err.message, 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );
  return [run, busy];
}

export function Confirm({ title, message, confirmLabel, danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">{message}</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancelar</button>
        <button
          className={danger ? 'btn-stop' : 'btn-go'}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm();
            setBusy(false);
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function CopyButton({ text, label = 'Copiar' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn-sm btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Copiado' : label}
    </button>
  );
}

/**
 * Cara del jugador (de mc-heads.net). Si no carga (sin internet o nombre de Bedrock),
 * se muestra un cuadro con la inicial.
 */
export function PlayerHead({ name, uuid, size = 24, body = false, className = '', title }) {
  const [failed, setFailed] = useState(false);
  const who = uuid || name || '';
  if (failed || !who) {
    return (
      <span className={`head-fallback ${className}`} style={{ width: size, height: body ? size * 2 : size, fontSize: Math.max(9, size * 0.5) }} title={title || name} aria-hidden="true">
        {(name || '?').replace(/^[.*]/, '')[0]?.toUpperCase() || '?'}
      </span>
    );
  }
  return (
    <img
      className={className}
      src={`https://mc-heads.net/${body ? 'body' : 'avatar'}/${encodeURIComponent(who)}/${size}`}
      width={body ? undefined : size}
      height={body ? size * 2 : size}
      alt={title ? '' : ''}
      title={title || name}
      style={{ imageRendering: 'pixelated', borderRadius: body ? 0 : 3 }}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
