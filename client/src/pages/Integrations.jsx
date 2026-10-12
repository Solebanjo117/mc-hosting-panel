import { useEffect, useState } from 'react';
import { api, formatDate } from '../api.js';
import { useLive } from '../live.jsx';
import { useAction, useToast } from '../ui.jsx';

const AGENT_STATUS = {
  stopped: 'Detenido',
  starting: 'Iniciando…',
  running: 'Conectando…',
  connected: 'Conectado',
  error: 'Se detuvo con error',
};

export function PlayitSettings() {
  const { playit: live } = useLive();
  const [status, setStatus] = useState(null);
  const [showLogs, setShowLogs] = useState(false);
  const [run, busy] = useAction();

  const load = () => api('/integrations/playit').then(setStatus);
  useEffect(() => {
    load().catch(() => {});
  }, []);
  // El estado en vivo llega por WebSocket; los logs solo al pedirlos.
  const s = live ? { ...status, ...live, logs: status?.logs } : status;
  useEffect(() => {
    if (!showLogs) return undefined;
    const t = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [showLogs]);

  if (!s) return null;
  const claim = s.claim;

  return (
    <section className="panel stack">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Túneles de playit.gg
        </h2>
        {s.claimed && (
          <span className="status">
            <i className={`dot ${s.status === 'connected' ? 'running' : s.status === 'error' ? 'crashed' : s.status === 'stopped' ? '' : 'starting'}`} aria-hidden="true" />
            {AGENT_STATUS[s.status] || s.status}
          </span>
        )}
      </div>
      <p className="muted small" style={{ maxWidth: '75ch' }}>
        Para cuando no puedes abrir puertos (CGNAT o módem bloqueado). El panel descarga el programa oficial de playit, lo mantiene encendido y crea
        los túneles de cada servidor desde su pestaña Conexión. Necesitas una cuenta gratuita en playit.gg.
      </p>

      {!s.claimed ? (
        claim && ['waiting', 'visited'].includes(claim.state) ? (
          <div className="login-code">
            <p>
              Abre este enlace, inicia sesión en playit.gg y acepta agregar el agente:{' '}
              <a href={claim.url} target="_blank" rel="noreferrer">
                {claim.url}
              </a>
            </p>
            <p className="muted small">{claim.state === 'visited' ? 'Esperando a que aceptes en playit.gg…' : 'Esperando a que abras el enlace…'}</p>
          </div>
        ) : (
          <div className="stack" style={{ gap: '0.5rem' }}>
            {claim?.state === 'error' && <div className="error-box">{claim.error}</div>}
            <div>
              <button className="btn-go" disabled={busy} onClick={() => run(() => api('/integrations/playit/claim', { method: 'POST' }).then(setStatus))}>
                Vincular con mi cuenta de playit.gg
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => run(() => api('/integrations/playit/enabled', { method: 'POST', body: { enabled: e.target.checked } }).then(setStatus))}
            />
            <span>Mantener el agente encendido (y arrancarlo con el panel)</span>
          </label>
          <span className="grow" />
          <button className="btn-sm btn-ghost" onClick={() => setShowLogs(!showLogs)}>
            {showLogs ? 'Ocultar registro' : 'Ver registro del agente'}
          </button>
          <button className="btn-sm" disabled={busy} onClick={() => run(() => api('/integrations/playit/reinstall', { method: 'POST' }).then(setStatus), 'Agente reinstalado')}>
            Reinstalar agente
          </button>
          <button
            className="btn-sm btn-stop"
            disabled={busy}
            onClick={() =>
              confirm('Se desvincula el panel de tu cuenta de playit y se apagan los túneles. ¿Continuar?') &&
              run(() => api('/integrations/playit/unlink', { method: 'POST' }).then(setStatus), 'playit.gg desvinculado')
            }
          >
            Desvincular
          </button>
        </div>
      )}
      {showLogs && <pre className="logview" style={{ maxHeight: 260 }}>{(status?.logs || []).join('\n') || 'Sin mensajes todavía.'}</pre>}
    </section>
  );
}

export function DuckDnsSettings() {
  const [s, setS] = useState(null);
  const [domains, setDomains] = useState('');
  const [token, setToken] = useState('');
  const [run, busy] = useAction();
  const toast = useToast();

  useEffect(() => {
    api('/integrations/duckdns')
      .then((d) => {
        setS(d);
        setDomains(d.domains.join(', '));
      })
      .catch(() => {});
  }, []);

  if (!s) return null;
  const save = (enabled) =>
    run(async () => {
      const r = await api('/integrations/duckdns', { method: 'PUT', body: { domains, token: token || undefined, enabled } });
      setS(r);
      setToken('');
      if (enabled && r.lastResult && !/Actualizado|Sin cambios/.test(r.lastResult)) toast(r.lastResult, 'error');
      else toast(enabled ? 'DuckDNS activado' : 'Guardado');
    });

  return (
    <section className="panel stack">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Dominio gratis con DuckDNS
        </h2>
        {s.enabled && <span className="chip">Activo</span>}
      </div>
      <p className="muted small" style={{ maxWidth: '75ch' }}>
        Te da una dirección fija como <span className="mono">miserver.duckdns.org</span> aunque tu IP pública cambie. Crea el subdominio en{' '}
        <a href="https://www.duckdns.org" target="_blank" rel="noreferrer">
          duckdns.org
        </a>{' '}
        (inicias sesión con Google, GitHub u otra cuenta) y copia aquí el subdominio y tu token. El panel actualiza la IP cada 5 minutos. Con CGNAT no
        sirve; ahí usa playit.gg.
      </p>
      <div className="grid-2">
        <label className="field">
          <span>Subdominio</span>
          <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="miserver" />
          <span>Sin “.duckdns.org”. Puedes poner varios separados por coma.</span>
        </label>
        <label className="field">
          <span>Token</span>
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={s.hasToken ? `Guardado (${s.tokenHint}); escribe otro para cambiarlo` : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
          />
          <span>Está arriba en la página de DuckDNS después de iniciar sesión.</span>
        </label>
      </div>
      <div className="row">
        <button className="btn-go" disabled={busy || !domains.trim() || (!token && !s.hasToken)} onClick={() => save(true)}>
          {s.enabled ? 'Guardar y actualizar ahora' : 'Activar'}
        </button>
        {s.enabled && (
          <button disabled={busy} onClick={() => save(false)}>
            Desactivar
          </button>
        )}
        {s.lastUpdate && (
          <span className="muted small">
            Última actualización: {formatDate(s.lastUpdate)}, {s.lastResult}
            {s.lastIp ? ` (IP ${s.lastIp})` : ''}.
          </span>
        )}
      </div>
    </section>
  );
}
