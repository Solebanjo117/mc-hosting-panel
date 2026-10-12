import { useEffect, useState } from 'react';
import { api } from '../api.js';
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

const DNS_PROVIDERS = [
  { id: null, label: 'Ninguno' },
  { id: 'desec', label: 'deSEC (gratis)' },
  { id: 'duckdns', label: 'DuckDNS (gratis)' },
  { id: 'cloudflare', label: 'Cloudflare (tu dominio)' },
];

export function DnsSettings() {
  const [s, setS] = useState(null);
  const [provider, setProvider] = useState(null);
  const [form, setForm] = useState({ token: '', domain: '', zone: '', zoneId: '' });
  const [run, busy] = useAction();

  useEffect(() => {
    api('/integrations/dns')
      .then((d) => {
        setS(d);
        setProvider(d.provider);
        setForm({ token: '', domain: d.desec.domain, zone: d.cloudflare.zone, zoneId: d.cloudflare.zoneId });
      })
      .catch(() => {});
  }, []);

  if (!s) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const saved = provider && s[provider]?.hasToken;
  const tokenField = (placeholder, help) => (
    <label className="field">
      <span>Token</span>
      <input
        type="password"
        autoComplete="off"
        value={form.token}
        onChange={(e) => set('token', e.target.value)}
        placeholder={saved ? `Guardado (${s[provider].tokenHint}); escribe otro para cambiarlo` : placeholder}
      />
      <span>{help}</span>
    </label>
  );
  const save = () =>
    run(async () => {
      const r = await api('/integrations/dns', {
        method: 'PUT',
        body: { provider, token: form.token || undefined, domain: form.domain, zone: form.zone, zoneId: form.zoneId },
      });
      setS(r);
      set('token', '');
    }, provider ? 'Listo. Ahora elige el nombre de cada servidor en su pestaña Conexión.' : 'Dominio desactivado');

  return (
    <section className="panel stack">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Dominio para tus servidores
        </h2>
        {s.provider && <span className="chip">{s.providerName}</span>}
      </div>
      <p className="muted small" style={{ maxWidth: '75ch' }}>
        Un nombre fácil como <span className="mono">smp.tunombre.dedyn.io</span> en lugar de una IP o la dirección de playit. Funciona con la IP de tu casa
        (puertos abiertos) y con los túneles de playit.gg; el panel mantiene los registros al día. El nombre de cada servidor se elige en su pestaña{' '}
        <strong>Conexión</strong>.
      </p>
      <div className="segmented" role="radiogroup" aria-label="Servicio de dominio">
        {DNS_PROVIDERS.map((p) => (
          <button key={p.id || 'none'} type="button" className={provider === p.id ? 'on' : ''} onClick={() => setProvider(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      {provider === 'desec' && (
        <>
          <p className="small" style={{ maxWidth: '75ch' }}>
            <strong>Recomendado.</strong> Gratis y permite registros SRV, así tus amigos de Java entran solo con el nombre, sin puerto, aunque uses playit.
          </p>
          <ol className="small stack" style={{ gap: '0.3rem', margin: 0, paddingLeft: '1.2rem', maxWidth: '75ch' }}>
            <li>
              Entra a{' '}
              <a href="https://desec.io/signup" target="_blank" rel="noreferrer">
                desec.io/signup
              </a>
              , escribe tu correo y marca la opción de dominio gratis para DynDNS: eliges un nombre como <span className="mono">tunombre.dedyn.io</span>.
            </li>
            <li>Confirma el correo que te llega y entra a tu cuenta.</li>
            <li>
              Ve a <strong>Token Management</strong>, pulsa <strong>+</strong>, crea un token y cópialo (solo se muestra una vez).
            </li>
          </ol>
          <div className="grid-2">
            <label className="field">
              <span>Tu dominio de deSEC</span>
              <input value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="tunombre.dedyn.io" />
            </label>
            {tokenField('Token de deSEC', 'El panel lo usa solo para crear los registros de tus servidores.')}
          </div>
        </>
      )}

      {provider === 'duckdns' && (
        <>
          <p className="small" style={{ maxWidth: '75ch' }}>
            Gratis y muy fácil, pero solo guarda IPs: con playit tus amigos de Java tienen que escribir el puerto (por ejemplo{' '}
            <span className="mono">miserver.duckdns.org:41234</span>). Crea uno o más subdominios en{' '}
            <a href="https://www.duckdns.org" target="_blank" rel="noreferrer">
              duckdns.org
            </a>{' '}
            (inicias sesión con Google, GitHub u otra cuenta) y copia tu token.
          </p>
          <div className="grid-2">{tokenField('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'Está arriba en la página de DuckDNS después de iniciar sesión.')}</div>
        </>
      )}

      {provider === 'cloudflare' && (
        <>
          <p className="small" style={{ maxWidth: '75ch' }}>
            Para un dominio tuyo (por ejemplo <span className="mono">midominio.com</span>) que ya está en Cloudflare. Crea el token en{' '}
            <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">
              My Profile → API Tokens
            </a>{' '}
            con la plantilla <strong>Edit zone DNS</strong> y elige tu dominio. Los registros se crean sin la nube naranja (el proxy de Cloudflare no
            funciona con Minecraft).
          </p>
          <div className="grid-2">
            <label className="field">
              <span>Tu dominio</span>
              <input value={form.zone} onChange={(e) => set('zone', e.target.value)} placeholder="midominio.com" />
            </label>
            {tokenField('Token de Cloudflare', 'Solo necesita permiso para editar el DNS de ese dominio.')}
            <label className="field">
              <span>Zone ID (opcional)</span>
              <input value={form.zoneId} onChange={(e) => set('zoneId', e.target.value)} placeholder="Solo si el panel no encuentra tu dominio" />
            </label>
          </div>
        </>
      )}

      {provider === null && s.provider && <p className="muted small">Al guardar, el panel deja de actualizar el dominio. Los registros de deSEC y Cloudflare se borran.</p>}

      <div className="row">
        <button
          className="btn-go"
          disabled={busy || (provider !== null && !saved && !form.token) || (provider === s.provider && provider === null)}
          onClick={save}
        >
          {busy ? 'Comprobando…' : provider ? 'Guardar y comprobar' : 'Guardar'}
        </button>
      </div>
    </section>
  );
}
