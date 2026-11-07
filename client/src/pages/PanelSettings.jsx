import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Confirm, useAction, usePageTitle, useToast } from '../ui.jsx';
import { AppSettings, CurseForgeSettings, DnsSettings, PlayitSettings } from './Integrations.jsx';
import { formatDate } from '../api.js';
import BackupMirror from './BackupMirror.jsx';
import { useLive } from '../live.jsx';
import { ROLE_LABEL } from '../auth.jsx';

const JAVA_VERSIONS = [
  { major: 8, use: 'Minecraft 1.16.5 y anteriores' },
  { major: 17, use: 'Minecraft 1.17 a 1.20.4' },
  { major: 21, use: 'Minecraft 1.20.5 a 1.21.x' },
  { major: 25, use: 'Minecraft 26.1 en adelante' },
];

export default function PanelSettings() {
  const [info, setInfo] = useState(null);
  const [java, setJava] = useState(null);
  const [panelPort, setPanelPort] = useState('');
  const [pw, setPw] = useState({ current: '', password: '', confirm: '' });
  const [downloading, setDownloading] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();
  usePageTitle('Ajustes del panel');

  const loadJava = () => api('/system/java').then(setJava);
  useEffect(() => {
    api('/system/info').then(setInfo);
    api('/system/network').then((n) => setPanelPort(n.panelPort));
    loadJava();
  }, []);

  const installed = (major) => java?.installed.find((j) => j.major === major);

  return (
    <div className="page stack" style={{ gap: '1.75rem', maxWidth: 860 }}>
      <h1>Ajustes del panel</h1>
      <p className="muted small">
        El tema, el fondo y el movimiento se eligen en <Link to="/apariencia">Perfil y apariencia</Link>.
      </p>

      <PanelUpdate />
      <UsersSection />

      <BackupMirror />
      <PlayitSettings />
      <DnsSettings />
      <CurseForgeSettings />
      <AppSettings />

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Contraseña</h2>
        <form
          className="grid-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw.password !== pw.confirm) return toast('Las contraseñas no coinciden', 'error');
            run(() => api('/auth/password', { method: 'POST', body: { current: pw.current, password: pw.password } }), 'Contraseña cambiada. Las demás sesiones se cerraron.').then(() =>
              setPw({ current: '', password: '', confirm: '' })
            );
          }}
        >
          <label className="field">
            <span>Contraseña actual</span>
            <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
          </label>
          <label className="field">
            <span>Nueva contraseña</span>
            <input type="password" autoComplete="new-password" minLength={8} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} required />
          </label>
          <label className="field">
            <span>Repite la nueva</span>
            <input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn-go" disabled={busy}>
              Cambiar contraseña
            </button>
          </div>
        </form>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Java</h2>
        <p className="muted small">
          El panel descarga solo el Java que necesita cada versión de Minecraft (Eclipse Temurin) y lo guarda en <span className="mono">data\java</span>. Puedes descargarlo por adelantado.
        </p>
        <table className="table">
          <tbody>
            {JAVA_VERSIONS.map((j) => {
              const inst = installed(j.major);
              return (
                <tr key={j.major}>
                  <td style={{ width: 90 }}>Java {j.major}</td>
                  <td className="muted">{j.use}</td>
                  <td className="muted small mono" style={{ overflowWrap: 'anywhere' }}>
                    {inst ? inst.path : ''}
                  </td>
                  <td className="actions">
                    {inst ? (
                      <span className="small" style={{ color: 'var(--prismarine)' }}>
                        Instalado
                      </span>
                    ) : (
                      <button
                        className="btn-sm"
                        disabled={downloading !== null}
                        onClick={async () => {
                          setDownloading(j.major);
                          await run(() => api(`/system/java/${j.major}`, { method: 'POST' }).then(loadJava), `Java ${j.major} listo`);
                          setDownloading(null);
                        }}
                      >
                        {downloading === j.major ? 'Descargando…' : 'Descargar'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <PanelAccess />
      <StartWithWindows />

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Puerto del panel</h2>
        <p className="muted small">Por dónde abres esta página (ahora {panelPort}). No lo abras en tu router: si quieres administrar desde fuera de casa usa Tailscale, como explica la guía.</p>
        <div className="row">
          <input type="number" min={1024} max={65535} value={panelPort} onChange={(e) => setPanelPort(e.target.value)} style={{ width: 140 }} aria-label="Puerto del panel" />
          <button
            disabled={busy}
            onClick={() => run(() => api('/system/settings', { method: 'PUT', body: { panelPort: Number(panelPort) } }), 'Guardado. Cierra y vuelve a abrir el panel para aplicarlo.')}
          >
            Guardar puerto
          </button>
        </div>
      </section>

      {info && (
        <p className="faint small">
          MC Hosting Panel {info.version}, {info.system.cpuModel} ({info.system.cores} núcleos), {Math.round(info.system.totalMemMb / 1024)} GB de RAM, equipo {info.system.hostname}.
        </p>
      )}
    </div>
  );
}

const ACCESS = [
  ['local', 'Solo esta PC', 'Nadie más puede abrir el panel, ni desde tu red.'],
  ['lan', 'Esta PC, tu red y Tailscale (recomendado)', 'Puedes administrar desde el celular en tu Wi-Fi o desde fuera con Tailscale. Desde internet se rechaza.'],
  ['any', 'Cualquiera en internet', 'No recomendado: cualquiera que encuentre el panel puede intentar adivinar tu contraseña.'],
];

function PanelAccess() {
  const [mode, setMode] = useState(null);
  const [log, setLog] = useState([]);
  const [run, busy] = useAction();
  useEffect(() => {
    api('/system/network')
      .then((n) => setMode(n.remoteAccess))
      .catch(() => {});
    api('/auth/log')
      .then(setLog)
      .catch(() => {});
  }, []);
  if (!mode) return null;
  const failed = log.filter((l) => !l.ok).length;
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Quién puede abrir el panel</h2>
      <div className="stack" style={{ gap: '0.6rem' }} role="radiogroup">
        {ACCESS.map(([id, label, hint]) => (
          <label key={id} className="check">
            <input
              type="radio"
              name="access"
              checked={mode === id}
              style={{ width: 18, minHeight: 18, height: 18, margin: '2px 0 0' }}
              onChange={() => run(() => api('/system/settings', { method: 'PUT', body: { remoteAccess: id } }).then(() => setMode(id)), 'Guardado')}
              disabled={busy}
            />
            <span>
              {label}
              <span className="faint" style={{ display: 'block' }}>
                {hint}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div>
        <h3 style={{ marginBottom: '0.4rem' }}>Inicios de sesión recientes</h3>
        {failed > 0 && (
          <p className="note" style={{ marginBottom: '0.5rem' }}>
            {failed} intento(s) fallido(s). Si no fuiste tú, cambia la contraseña.
          </p>
        )}
        {log.length === 0 ? (
          <p className="faint small">Sin registros todavía.</p>
        ) : (
          <table className="table">
            <tbody>
              {log.slice(0, 10).map((l, i) => (
                <tr key={i}>
                  <td className="muted" style={{ width: 190 }}>
                    {formatDate(l.at)}
                  </td>
                  <td className="mono small">{l.ip}</td>
                  <td>
                    {l.reset ? (
                      <span style={{ color: 'var(--gold)' }}>Contraseña restablecida desde la PC del panel</span>
                    ) : l.ok ? (
                      'Correcto'
                    ) : (
                      <span style={{ color: '#f6b0a6' }}>Contraseña incorrecta ({l.username || 'sin usuario'})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

const MODE_HINT = {
  git: 'Se actualiza con git desde GitHub. Tus servidores, mundos y ajustes (carpeta data) no se tocan.',
  installer: 'Se descarga el instalador nuevo y se instala encima. Tus servidores, mundos y ajustes (carpeta data) no se tocan.',
  manual: '',
};
/** Modos en los que el panel puede instalarse la versión nueva él mismo. */
const SELF_UPDATE = ['git', 'installer'];

function PanelUpdate() {
  const [st, setSt] = useState(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [run] = useAction();
  const toast = useToast();
  const timer = useRef();

  const load = () =>
    api('/system/update')
      .then(setSt)
      .catch(() => {});
  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
  }, []);

  // Mientras se actualiza, consulta el avance; cuando el panel se reinicia, espera a que vuelva y recarga.
  useEffect(() => {
    if (!st) return;
    if (st.running) {
      timer.current = setTimeout(load, 1500);
    } else if (st.done && !st.error && restarting) {
      const from = st.current;
      const wait = async () => {
        try {
          const info = await api('/system/info');
          if (info.version !== from || Date.now() - restarting > 60_000) return location.reload();
        } catch {
          /* todavía reiniciando */
        }
        timer.current = setTimeout(wait, 2000);
      };
      timer.current = setTimeout(wait, 3000);
    }
  }, [st, restarting]);

  const check = async () => {
    setChecking(true);
    try {
      const r = await api('/system/update/check', { method: 'POST' });
      setSt(r);
      if (!r.lastCheck.available) toast(r.lastCheck.message || 'Ya tienes la versión más reciente');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setChecking(false);
    }
  };

  if (!st) return null;
  const c = st.lastCheck;
  const updating = st.running || (restarting && !st.error);
  return (
    <section className="panel stack" aria-labelledby="update-title">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="update-title" style={{ margin: 0 }}>
          Actualizar el panel
        </h2>
        <span className="muted small">Versión instalada: {st.current}</span>
      </div>
      {st.mode === 'docker' ? (
        <p className="muted small">
          El panel corre en Docker: se actualiza cambiando la imagen desde el equipo, con <span className="mono">docker compose pull && docker compose up -d</span> (o{' '}
          <span className="mono">docker compose build --pull && docker compose up -d</span> si la construyes tú). El volumen <span className="mono">/data</span> no se toca.
        </p>
      ) : st.mode === 'manual' ? (
        <p className="muted small">
          Esta copia no se instaló con el instalador ni con git, así que no puede actualizarse sola. Descarga la versión nueva y reemplaza los archivos conservando la carpeta{' '}
          <span className="mono">data</span>.
        </p>
      ) : (
        <p className="muted small">{MODE_HINT[st.mode]} Al terminar, los servidores encendidos se apagan con cuidado y el panel se vuelve a abrir solo.</p>
      )}

      {c?.available && !updating && (
        <div className="note stack" style={{ gap: '0.4rem' }}>
          <strong>Hay una versión nueva: {c.latest}</strong>
          {c.changes?.length > 0 && (
            <ul className="small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
              {c.changes.slice(0, 12).map((ch) => (
                <li key={ch.hash}>{ch.subject}</li>
              ))}
              {c.changes.length > 12 && <li className="faint">y {c.changes.length - 12} cambios más</li>}
            </ul>
          )}
          {c.notes && (
            <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {c.notes.slice(0, 800)}
            </p>
          )}
          {c.dirty && (
            <p className="small" style={{ margin: 0 }}>
              Hay archivos del panel modificados a mano: si chocan con la versión nueva, git no actualizará.
            </p>
          )}
        </div>
      )}

      {(st.running || st.log.length > 0) && (
        <div role="status" aria-live="polite" className="stack" style={{ gap: '0.3rem' }}>
          <strong className="small">{st.error ? 'No se pudo actualizar' : st.running ? st.step : restarting ? 'Reiniciando el panel…' : st.step}</strong>
          <pre className="log-box">{st.log.join('\n')}</pre>
        </div>
      )}

      {st.mode !== 'manual' && (
        <div className="row">
          <button onClick={check} disabled={checking || updating}>
            {checking ? 'Buscando…' : 'Buscar actualizaciones'}
          </button>
          {c?.available && SELF_UPDATE.includes(st.mode) && (
            <button className="btn-go" disabled={updating} onClick={() => setConfirm(true)}>
              {updating ? 'Actualizando…' : `Actualizar a ${c.latest}`}
            </button>
          )}
        </div>
      )}
      {c && !c.available && !st.log.length && <p className="faint small">Revisado {formatDate(c.checkedAt)}: ya tienes la versión más reciente.</p>}

      {confirm && (
        <Confirm
          title={`Actualizar a ${c.latest}`}
          message="El panel se reinicia al terminar: los servidores encendidos se apagan con cuidado (guardando el mundo) y vuelven a encenderse cuando el panel termina de reiniciar."
          confirmLabel="Actualizar"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const r = await run(() => api('/system/update', { method: 'POST' }));
            if (r) {
              setSt(r);
              setRestarting(Date.now());
            }
            setConfirm(false);
          }}
        />
      )}
    </section>
  );
}

function StartWithWindows() {
  const [st, setSt] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    api('/system/startup')
      .then(setSt)
      .catch(() => {});
  }, []);
  if (!st?.supported) return null;
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Iniciar con Windows</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={st.enabled}
          disabled={busy}
          onChange={(e) => {
            const enabled = e.target.checked;
            run(() => api('/system/startup', { method: 'PUT', body: { enabled } }).then(setSt), enabled ? 'El panel se abrirá al iniciar sesión' : 'Ya no se abrirá solo');
          }}
        />
        <span>
          Abrir el panel al iniciar sesión en Windows
          <span className="faint" style={{ display: 'block' }}>
            Se abre minimizado, sin el navegador. Marca «Encender automáticamente» en los servidores que quieras encendidos siempre.
          </span>
        </span>
      </label>
    </section>
  );
}

const ROLE_HINT = {
  moderator: 'En sus servidores: consola, jugadores, chat, respaldos, encender y apagar. No ve archivos ni cambia ajustes.',
  viewer: 'En sus servidores solo mira: consola, jugadores, chat, actividad, rendimiento y logs.',
};

/** Cuentas de otras personas (moderadores y observadores) y a qué servidores entran. */
function UsersSection() {
  const { servers } = useLive();
  const [users, setUsers] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | usuario
  const [confirm, setConfirm] = useState(null);
  const [run, busy] = useAction();
  const load = () =>
    api('/auth/users')
      .then(setUsers)
      .catch(() => setUsers([]));
  useEffect(() => {
    load();
  }, []);
  if (!users) return null;
  const nameOf = (id) => servers.find((s) => s.id === id)?.name || 'servidor borrado';

  return (
    <section className="panel stack" aria-labelledby="users-title">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="users-title" style={{ margin: 0 }}>
          Usuarios
        </h2>
        <button className="btn-sm" onClick={() => setEditing('new')} disabled={busy}>
          Invitar a alguien
        </button>
      </div>
      <p className="muted small">
        Cada cuenta entra con su usuario y contraseña y ve solo los servidores que le asignes. <strong>Moderador:</strong> {ROLE_HINT.moderator} <strong>Observador:</strong> {ROLE_HINT.viewer}
      </p>
      {users.length === 0 ? (
        <p className="faint small">Solo tú entras al panel por ahora.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Servidores</th>
                <th>Última entrada</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{ROLE_LABEL[u.role] || u.role}</td>
                  <td className="small">{u.servers === '*' ? 'Todos (también los nuevos)' : u.servers.length ? u.servers.map(nameOf).join(', ') : 'Ninguno'}</td>
                  <td className="muted small">{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Todavía no entra'}</td>
                  <td className="actions">
                    <button className="btn-sm" disabled={busy} onClick={() => setEditing(u)}>
                      Editar
                    </button>{' '}
                    <button className="btn-sm btn-stop" disabled={busy} onClick={() => setConfirm(u)}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          servers={servers}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(body) =>
            run(
              () =>
                api(editing === 'new' ? '/auth/users' : `/auth/users/${editing.id}`, { method: editing === 'new' ? 'POST' : 'PUT', body })
                  .then(() => load())
                  .then(() => setEditing(null)),
              editing === 'new' ? 'Cuenta creada' : 'Cuenta guardada'
            )
          }
        />
      )}
      {confirm && (
        <Confirm
          title={`Quitar a ${confirm.username}`}
          message="Dejará de poder entrar al panel al momento. Sus servidores no se tocan."
          confirmLabel="Quitar"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            run(
              () =>
                api(`/auth/users/${confirm.id}`, { method: 'DELETE' })
                  .then(load)
                  .then(() => setConfirm(null)),
              'Cuenta quitada'
            )
          }
        />
      )}
    </section>
  );
}

function UserForm({ user, servers, busy, onClose, onSave }) {
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(user?.role || 'moderator');
  const [all, setAll] = useState(user ? user.servers === '*' : true);
  const [chosen, setChosen] = useState(new Set(user && user.servers !== '*' ? user.servers : []));
  const toggle = (id) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <form
      className="stack"
      style={{ gap: '0.8rem', borderTop: '1px solid var(--line)', paddingTop: '0.9rem' }}
      onSubmit={(e) => {
        e.preventDefault();
        const body = { username, role, servers: all ? '*' : [...chosen] };
        if (!user || password) body.password = password;
        onSave(body);
      }}
    >
      <h3 style={{ margin: 0 }}>{user ? `Editar a ${user.username}` : 'Nueva cuenta'}</h3>
      <div className="grid-2">
        <label className="field">
          <span>Usuario</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.\-]{3,32}" autoComplete="off" />
        </label>
        <label className="field">
          <span>{user ? 'Nueva contraseña (vacío para dejarla igual)' : 'Contraseña'}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!user} minLength={8} autoComplete="new-password" />
          <span>Mínimo 8 caracteres. Pásasela por un medio seguro; puede cambiarla al entrar.</span>
        </label>
      </div>
      <div className="stack" style={{ gap: '0.4rem' }} role="radiogroup" aria-label="Rol">
        {['moderator', 'viewer'].map((r) => (
          <label key={r} className="check">
            <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} style={{ width: 18, minHeight: 18, height: 18, margin: '2px 0 0' }} />
            <span>
              {ROLE_LABEL[r]}
              <span className="faint" style={{ display: 'block' }}>
                {ROLE_HINT[r]}
              </span>
            </span>
          </label>
        ))}
      </div>
      <fieldset className="stack" style={{ gap: '0.4rem', border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ marginBottom: '0.3rem' }}>
          Servidores a los que entra
        </legend>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          <span>Todos, también los que crees después</span>
        </label>
        {!all &&
          servers.map((s) => (
            <label key={s.id} className="check" style={{ marginLeft: '1.4rem' }}>
              <input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />
              <span>{s.name}</span>
            </label>
          ))}
        {!all && servers.length === 0 && <p className="faint small">Todavía no hay servidores que asignar.</p>}
      </fieldset>
      <div className="row">
        <button className="btn-go" disabled={busy}>
          {user ? 'Guardar' : 'Crear cuenta'}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
