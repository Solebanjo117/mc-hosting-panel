import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useLive } from '../live.jsx';
import { Confirm, useAction, useToast } from '../ui.jsx';
import { askPermission, canInstall, notifyPrefs, notifySupported, onInstallChange, promptInstall, setNotifyPrefs } from '../notify.js';

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
  { id: 'desec', label: 'deSEC (gratis)' },
  { id: 'duckdns', label: 'DuckDNS (gratis)' },
  { id: 'cloudflare', label: 'Cloudflare (tu dominio)' },
];

export function DnsSettings() {
  const [s, setS] = useState(null);
  const [provider, setProvider] = useState(null);
  const [form, setForm] = useState({ token: '', domain: '', zone: '', zoneId: '' });
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [run, busy] = useAction();
  const toast = useToast();

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
    }, 'Listo. Ahora elige el nombre de cada servidor en su pestaña Conexión.');
  const unlink = async () => {
    try {
      const r = await api('/integrations/dns/unlink', { method: 'POST' });
      setS(r);
      setProvider(null);
      setForm({ token: '', domain: '', zone: '', zoneId: '' });
      if (r.warnings?.length) toast(`Desvinculado, pero no se pudieron borrar algunos registros: ${r.warnings.join('; ')}`, 'error');
      else toast('Dominio desvinculado');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const currentName = s.provider === 'duckdns' ? 'DuckDNS' : s.zone;

  return (
    <section className="panel stack">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Dominio para tus servidores
        </h2>
        {s.provider && <span className="chip">{s.providerName}</span>}
      </div>
      {s.provider && (
        <div className="row">
          <span className="small grow">
            Vinculado con <strong>{s.providerName}</strong>
            {s.provider !== 'duckdns' && s.zone ? (
              <>
                {' '}
                (<span className="mono">{s.zone}</span>)
              </>
            ) : null}
            .
          </span>
          <button className="btn-stop btn-sm" disabled={busy} onClick={() => setConfirmUnlink(true)}>
            Desvincular dominio
          </button>
        </div>
      )}
      <p className="muted small" style={{ maxWidth: '75ch' }}>
        Un nombre fácil como <span className="mono">smp.tudominio.com</span> en lugar de una IP o la dirección de playit. Funciona con la IP de tu casa
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
            Gratis y permite registros SRV: tus amigos de Java entran solo con el nombre, sin puerto, y funciona con el túnel de playit.
          </p>
          <ol className="small stack" style={{ gap: '0.3rem', margin: 0, paddingLeft: '1.2rem', maxWidth: '75ch' }}>
            <li>
              Crea tu cuenta en{' '}
              <a href="https://desec.io/signup" target="_blank" rel="noreferrer">
                desec.io/signup
              </a>{' '}
              y confirma el correo.
            </li>
            <li>
              Agrega tu dominio con el <strong>+</strong>. Los dominios gratis <span className="mono">.dedyn.io</span> a veces están suspendidos; puedes usar
              uno gratis de{' '}
              <a href="https://domain.digitalplat.org" target="_blank" rel="noreferrer">
                DigitalPlat
              </a>{' '}
              (<span className="mono">tunombre.dpdns.org</span>) y en DigitalPlat poner los nameservers <span className="mono">ns1.desec.io</span> y{' '}
              <span className="mono">ns2.desec.org</span>.
            </li>
            <li>
              Ve a <strong>Token Management</strong>, pulsa <strong>+</strong>, crea un token y cópialo (solo se muestra una vez). No edites los registros NS
              del dominio.
            </li>
          </ol>
          <div className="grid-2">
            <label className="field">
              <span>Tu dominio de deSEC</span>
              <input value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="tunombre.dpdns.org" />
            </label>
            {tokenField('Token de deSEC', 'El panel lo usa solo para crear los registros de tus servidores.')}
          </div>
        </>
      )}

      {provider === 'duckdns' && (
        <>
          <p className="small" style={{ maxWidth: '75ch' }}>
            Gratis y muy fácil, pero solo guarda IPs. Sirve con la IP de tu casa (puertos abiertos). Con el túnel de playit solo funciona para Bedrock:
            playit no deja entrar a Java con otro nombre, y DuckDNS no tiene registros SRV para redirigir. Crea uno o más subdominios en{' '}
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
            Para un dominio tuyo que ya está en Cloudflare: comprado (por ejemplo <span className="mono">midominio.com</span>) o gratis de{' '}
            <a href="https://domain.digitalplat.org" target="_blank" rel="noreferrer">
              DigitalPlat
            </a>{' '}
            (<span className="mono">tunombre.dpdns.org</span>, con los nameservers que te da Cloudflare). Crea el token en{' '}
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

      {provider && (
        <div className="row">
          <button className="btn-go" disabled={busy || (!saved && !form.token)} onClick={save}>
            {busy ? 'Comprobando…' : s.provider && s.provider !== provider ? `Cambiar a ${DNS_PROVIDERS.find((p) => p.id === provider).label}` : 'Guardar y comprobar'}
          </button>
          {s.provider && s.provider !== provider && (
            <span className="faint small">Al cambiar, el panel borra los registros que creó en {s.providerName} y los crea en el nuevo.</span>
          )}
        </div>
      )}
      {confirmUnlink && (
        <Confirm
          title="Desvincular dominio"
          message={`El panel borra los registros que creó en ${currentName}${
            s.provider === 'duckdns' ? ' (DuckDNS no deja borrarlos; se quedan con la última IP)' : ''
          }, quita el dominio de todos los servidores y olvida el token. El dominio sigue siendo tuyo en ${s.providerName}; puedes volver a vincularlo cuando quieras.`}
          confirmLabel="Desvincular"
          danger
          onClose={() => setConfirmUnlink(false)}
          onConfirm={unlink}
        />
      )}
    </section>
  );
}

/** Notificaciones de este navegador e instalar el panel como app. */
export function AppSettings() {
  const [prefs, setPrefs] = useState(notifyPrefs);
  const [perm, setPerm] = useState(() => (notifySupported() ? Notification.permission : 'unsupported'));
  const [installable, setInstallable] = useState(canInstall);
  const toast = useToast();
  useEffect(() => onInstallChange(setInstallable), []);
  const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;

  const update = (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setNotifyPrefs(next);
  };

  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Notificaciones y app</h2>
      {perm === 'unsupported' ? (
        <p className="muted small" style={{ maxWidth: '75ch' }}>
          Este navegador no permite notificaciones aquí. Los navegadores solo las dan en páginas seguras: abre el panel como{' '}
          <span className="mono">http://localhost:{location.port || 80}</span> en esta PC, o por HTTPS (por ejemplo con <span className="mono">tailscale serve</span>)
          desde el celular.
        </p>
      ) : (
        <>
          <p className="muted small" style={{ maxWidth: '75ch' }}>
            Avisos del sistema cuando no estás viendo el panel. Se configuran por navegador: actívalos en cada equipo donde los quieras.
          </p>
          <label className="row small" style={{ gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={prefs.enabled && perm === 'granted'}
              onChange={async (e) => {
                if (!e.target.checked) return update({ enabled: false });
                const p = await askPermission();
                setPerm(p);
                if (p === 'granted') {
                  update({ enabled: true });
                  toast('Notificaciones activadas');
                } else toast('El navegador bloqueó las notificaciones. Permítelas en el candado de la barra de direcciones.', 'error');
              }}
            />
            Activar notificaciones en este navegador
          </label>
          {prefs.enabled && perm === 'granted' && (
            <div className="stack" style={{ gap: '0.3rem', paddingLeft: '1.6rem' }}>
              <label className="row small" style={{ gap: '0.5rem' }}>
                <input type="checkbox" checked={prefs.joins} onChange={(e) => update({ joins: e.target.checked })} />
                Cuando alguien entra a un servidor
              </label>
              <label className="row small" style={{ gap: '0.5rem' }}>
                <input type="checkbox" checked={prefs.crash} onChange={(e) => update({ crash: e.target.checked })} />
                Cuando un servidor se cae
              </label>
            </div>
          )}
          {perm === 'denied' && <p className="note small">Bloqueaste las notificaciones para esta página. Permítelas desde el candado de la barra de direcciones.</p>}
        </>
      )}
      <div className="row">
        {standalone ? (
          <span className="muted small">Estás usando el panel como app.</span>
        ) : installable ? (
          <button onClick={() => promptInstall()}>Instalar el panel como app</button>
        ) : (
          <span className="faint small" style={{ maxWidth: '75ch' }}>
            Para tenerlo como app: en Chrome o Edge, menú ⋮ → <strong>Instalar MC Hosting Panel</strong> (o “Agregar a pantalla de inicio” en el celular). En
            iPhone: Safari → Compartir → <strong>Agregar a inicio</strong>.
          </span>
        )}
      </div>
    </section>
  );
}
