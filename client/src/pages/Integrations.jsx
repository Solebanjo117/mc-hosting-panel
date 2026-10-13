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
          <div className="stack" style={{ gap: '0.75rem' }}>
            {claim?.state === 'error' && <div className="error-box">{claim.error}</div>}
            <ExistingAgent detected={s.detected || []} onDone={setStatus} />
            <div className="row">
              <button className="btn-go" disabled={busy} onClick={() => run(() => api('/integrations/playit/claim', { method: 'POST' }).then(setStatus))}>
                Vincular con un agente nuevo
              </button>
              <span className="faint small grow">Crea otro agente en tu cuenta de playit.gg. Úsalo solo si no tienes ninguno.</span>
            </div>
          </div>
        )
      ) : (
        <div className="row">
          {s.agentId && (
            <span className="faint small" title={s.agentId}>
              Agente <span className="mono">{s.agentId.slice(0, 8)}</span>
            </span>
          )}
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
              confirm('Se apaga el agente y los túneles de los servidores. La clave se guarda para que puedas volver a usar este mismo agente sin crear otro. ¿Continuar?') &&
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

/** Usar un agente de playit que ya existe (detectado en esta PC o pegando su clave). */
function ExistingAgent({ detected, onDone }) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [run, busy] = useAction();
  const toast = useToast();
  const use = (body) =>
    run(async () => {
      const r = await api('/integrations/playit/use-agent', { method: 'POST', body });
      for (const w of r.warnings || []) toast(w);
      setSecret('');
      onDone(r);
      return r;
    }, 'Listo: el panel usa tu agente de playit');
  return (
    <div className="login-code stack" style={{ gap: '0.6rem' }}>
      <strong>¿Ya tienes un agente de playit?</strong>
      <p className="muted small" style={{ margin: 0 }}>
        Úsalo en vez de crear otro: así no se acumulan agentes en tu cuenta y conservas sus túneles.
      </p>
      {detected.map((d) => (
        <div key={d.id} className="row">
          <span className="grow small">
            {d.label} <span className="mono faint">{d.hint}</span>
          </span>
          <button className="btn-sm btn-go" disabled={busy} onClick={() => use({ source: d.id })}>
            Usar este agente
          </button>
        </div>
      ))}
      {!open ? (
        <div>
          <button className="link-btn" style={{ fontSize: 'var(--step--1)', color: 'var(--prismarine)', fontWeight: 500 }} onClick={() => setOpen(true)}>
            Pegar la clave de un agente
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: '0.5rem' }}>
          <label className="field">
            <span>Clave secreta del agente</span>
            <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder='secret_key = "…" o solo la clave' />
            <span>
              Está en el archivo <span className="mono">playit.toml</span>. Con el programa oficial de Windows: abre <span className="mono">%LOCALAPPDATA%\playit_gg</span>{' '}
              (pégalo en la barra del Explorador), abre playit.toml con el Bloc de notas y copia la línea de secret_key. Si no lo encuentras, en una terminal
              ejecuta <span className="mono">playit secret-path</span>.
            </span>
          </label>
          <div className="row">
            <button className="btn-sm btn-go" disabled={busy || !secret.trim()} onClick={() => use({ secret })}>
              Usar este agente
            </button>
            <button className="btn-sm btn-ghost" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
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

/** Clave de API de CurseForge para buscar e instalar desde ahí. */
export function CurseForgeSettings() {
  const [s, setS] = useState(null);
  const [key, setKey] = useState('');
  const [run, busy] = useAction();
  useEffect(() => {
    api('/integrations/curseforge').then(setS).catch(() => {});
  }, []);
  if (!s) return null;
  const save = (value) =>
    run(async () => {
      setS(await api('/integrations/curseforge', { method: 'PUT', body: { apiKey: value } }));
      setKey('');
    }, value ? 'Clave de CurseForge guardada' : 'CurseForge desactivado');

  return (
    <section className="panel stack">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          CurseForge
        </h2>
        {s.hasKey && <span className="chip">Activo</span>}
      </div>
      <p className="muted small" style={{ maxWidth: '75ch' }}>
        Agrega CurseForge como otra fuente en la pestaña de mods y plugins. CurseForge pide una clave propia (gratis):
      </p>
      <ol className="small stack" style={{ gap: '0.3rem', margin: 0, paddingLeft: '1.2rem', maxWidth: '75ch' }}>
        <li>
          Entra a{' '}
          <a href="https://console.curseforge.com" target="_blank" rel="noreferrer">
            console.curseforge.com
          </a>{' '}
          e inicia sesión con tu cuenta de CurseForge (o crea una).
        </li>
        <li>
          Ve a <strong>API keys</strong> y copia tu clave. Si te pide llenar un formulario, describe el uso como “panel personal para administrar mis servidores de Minecraft”.
        </li>
        <li>Pégala aquí y guarda. El panel comprueba que funcione.</li>
      </ol>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field grow" style={{ maxWidth: 420 }}>
          <span>Clave de API</span>
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={s.hasKey ? `Guardada (${s.hint}); escribe otra para cambiarla` : '$2a$10$…'}
          />
        </label>
        <button className="btn-go" disabled={busy || !key.trim()} onClick={() => save(key)}>
          {busy ? 'Comprobando…' : 'Guardar'}
        </button>
        {s.hasKey && (
          <button className="btn-ghost" disabled={busy} onClick={() => save('')}>
            Quitar
          </button>
        )}
      </div>
      <p className="faint small" style={{ margin: 0 }}>
        Algunos autores no permiten descargar sus mods desde otras apps; en esos casos el panel te da el enlace para bajarlo y subirlo en Archivos.
      </p>
    </section>
  );
}
