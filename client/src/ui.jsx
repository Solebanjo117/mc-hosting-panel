import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { STATUS_LABEL } from './api.js';

/** La marca del panel: un bloque de pasto en isométrico dibujado con CSS. */
export function GrassBlock({ className = '', size }) {
  return (
    <span className={`block ${className}`} style={size ? { '--s': `${size}px` } : undefined} aria-hidden="true">
      <i className="left" />
      <i className="right" />
      <i className="top" />
    </span>
  );
}

/** Borde eléctrico: chispas del color de la lámpara alrededor de algo encendido. */
export const ELECTRIC_STATES = new Set(['running', 'starting', 'stopping', 'crashed', 'error', 'installing']);

export function Electric({ state = 'running', small = false }) {
  return (
    <span className={`electric st-${state}${small ? ' small' : ''}`} aria-hidden="true">
      <i className="e-main" />
      <i className="e-glow1" />
      <i className="e-glow2" />
    </span>
  );
}

/** Lo que se ve el instante en que una página o pestaña se descarga por primera vez. */
export function PageLoading({ inline = false }) {
  return (
    <div className={inline ? 'page-loading' : 'page page-loading'} aria-busy="true">
      <span className="faint small">Cargando…</span>
    </div>
  );
}

/** Pone el título de la pestaña del navegador: «Página – MC Hosting Panel». */
export function usePageTitle(title) {
  useEffect(() => {
    const before = document.title;
    document.title = title ? `${title} – MC Hosting Panel` : 'MC Hosting Panel';
    return () => {
      document.title = before;
    };
  }, [title]);
}

export function Status({ state }) {
  return (
    <span className="status">
      <i className={`dot ${state}`} aria-hidden="true" />
      {STATUS_LABEL[state] || state}
    </span>
  );
}

export function Progress({ value, label = 'Progreso' }) {
  const indeterminate = value == null;
  return (
    <div
      className={`progress${indeterminate ? ' indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}
    >
      <i style={{ width: `${indeterminate ? 30 : Math.round(value * 100)}%` }} />
    </div>
  );
}

export function Modal({ title, children, onClose, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // El foco entra al diálogo (al primer campo o botón) y al cerrarlo vuelve a donde estaba.
  useEffect(() => {
    const opener = document.activeElement;
    const first = ref.current?.querySelector('input, select, textarea, button:not([aria-label="Cerrar"])');
    (first || ref.current)?.focus({ preventScroll: true });
    return () => opener?.focus?.({ preventScroll: true });
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
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
  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (message, kind = 'ok') => {
      const id = Math.random();
      setItems((list) => [...list, { id, message, kind }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : kind === 'achievement' ? 8000 : 3500);
    },
    [dismiss]
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <button key={t.id} type="button" className={`toast ${t.kind}`} onClick={() => dismiss(t.id)} title="Cerrar aviso">
            {t.message}
          </button>
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
      {typeof message === 'string' ? <p className="muted">{message}</p> : <div className="muted">{message}</div>}
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
