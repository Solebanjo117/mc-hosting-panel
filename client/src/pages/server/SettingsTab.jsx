import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useLive } from '../../live.jsx';
import { Confirm, Modal, useAction } from '../../ui.jsx';

// Ajustes de server.properties que la gente cambia más seguido.
const COMMON = [
  { key: 'motd', label: 'Mensaje en la lista de servidores', type: 'text', hint: 'Usa § y un código para colores, p. ej. §a verde.' },
  { key: 'max-players', label: 'Máximo de jugadores', type: 'number' },
  { key: 'gamemode', label: 'Modo de juego', type: 'select', options: [['survival', 'Supervivencia'], ['creative', 'Creativo'], ['adventure', 'Aventura'], ['spectator', 'Espectador']] },
  { key: 'difficulty', label: 'Dificultad', type: 'select', options: [['peaceful', 'Pacífico'], ['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil']] },
  { key: 'pvp', label: 'PvP entre jugadores', type: 'bool' },
  { key: 'white-list', label: 'Lista blanca (solo jugadores aprobados)', type: 'bool' },
  { key: 'online-mode', label: 'Verificar cuentas de Minecraft (online-mode)', type: 'bool', hint: 'Desactívalo solo si sabes lo que haces: cualquiera podría entrar con cualquier nombre.' },
  { key: 'hardcore', label: 'Hardcore', type: 'bool' },
  { key: 'allow-flight', label: 'Permitir volar (necesario para algunos mods)', type: 'bool' },
  { key: 'spawn-protection', label: 'Radio de protección del spawn', type: 'number' },
  { key: 'view-distance', label: 'Distancia de visión (chunks)', type: 'number', hint: 'Bajarla mejora el rendimiento. 8–10 es un buen valor.' },
  { key: 'simulation-distance', label: 'Distancia de simulación (chunks)', type: 'number' },
  { key: 'level-seed', label: 'Semilla del mundo', type: 'text', hint: 'Solo aplica al generar un mundo nuevo.' },
  { key: 'level-name', label: 'Carpeta del mundo', type: 'text' },
  { key: 'enable-command-block', label: 'Bloques de comandos', type: 'bool' },
];

export default function SettingsTab({ server, state }) {
  const navigate = useNavigate();
  const { refresh } = useLive();
  const [props, setProps] = useState(null);
  const [original, setOriginal] = useState(null);
  const [raw, setRaw] = useState(false);
  const [form, setForm] = useState({
    name: server.name,
    memoryGb: server.memoryMb / 1024,
    port: server.port,
    autoStart: server.autoStart,
    autoRestart: server.autoRestart,
    jvmArgs: server.jvmArgs || '',
    javaPath: server.javaPath || '',
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [versionModal, setVersionModal] = useState(false);
  const [cloneName, setCloneName] = useState(`${server.name} (copia)`.slice(0, 40));
  const [run, busy] = useAction();
  const on = ['running', 'starting', 'stopping'].includes(state);

  useEffect(() => {
    api(`/servers/${server.id}/properties`).then((p) => {
      setProps(p);
      setOriginal(p);
    });
  }, [server.id]);

  const changed = useMemo(() => {
    if (!props || !original) return {};
    return Object.fromEntries(Object.entries(props).filter(([k, v]) => original[k] !== v));
  }, [props, original]);

  const set = (k, v) => setProps((p) => ({ ...p, [k]: String(v) }));

  return (
    <div className="stack" style={{ gap: '1.75rem', maxWidth: 920 }}>
      <section className="panel stack">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            Juego (server.properties)
          </h2>
          <button className="btn-sm btn-ghost" onClick={() => setRaw(!raw)}>
            {raw ? 'Ver ajustes comunes' : 'Ver todas las opciones'}
          </button>
        </div>
        {!props ? (
          <p className="muted">Cargando…</p>
        ) : raw ? (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {Object.keys(props)
                  .sort()
                  .map((k) => (
                    <tr key={k}>
                      <td className="mono" style={{ width: '40%' }}>
                        {k}
                      </td>
                      <td>
                        <input value={props[k]} onChange={(e) => set(k, e.target.value)} aria-label={k} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid-2">
            {COMMON.map((f) => (
              <PropField key={f.key} field={f} value={props[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        )}
        <div className="row">
          <button
            className="btn-go"
            disabled={busy || !Object.keys(changed).length}
            onClick={() =>
              run(async () => {
                const r = await api(`/servers/${server.id}/properties`, { method: 'PUT', body: changed });
                setProps(r.properties);
                setOriginal(r.properties);
                await refresh();
              }, on ? 'Guardado. Reinicia el servidor para aplicar los cambios.' : 'Ajustes guardados')
            }
          >
            Guardar ajustes del juego
          </button>
          {Object.keys(changed).length > 0 && <span className="muted small">{Object.keys(changed).length} cambio(s) sin guardar</span>}
        </div>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Servidor</h2>
        <div className="grid-2">
          <label className="field">
            <span>Nombre</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} />
          </label>
          <label className="field">
            <span>Memoria RAM (GB)</span>
            <input type="number" min={0.5} step={0.5} value={form.memoryGb} onChange={(e) => setForm({ ...form, memoryGb: Number(e.target.value) })} />
            <span>Se aplica al reiniciar.</span>
          </label>
          <label className="field">
            <span>Puerto</span>
            <input type="number" min={1024} max={65535} value={form.port} disabled={on} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
            <span>{on ? 'Apaga el servidor para cambiarlo.' : 'Recuerda cambiarlo también en el router.'}</span>
          </label>
          <label className="field">
            <span>Ruta de Java (opcional)</span>
            <input value={form.javaPath} onChange={(e) => setForm({ ...form, javaPath: e.target.value })} placeholder={`Automático (Java ${server.javaMajor || ''})`} />
            <span>Déjalo vacío para que el panel use el Java correcto.</span>
          </label>
        </div>
        <label className="field">
          <span>Argumentos extra de Java (avanzado)</span>
          <input className="mono" value={form.jvmArgs} onChange={(e) => setForm({ ...form, jvmArgs: e.target.value })} placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=200" />
        </label>
        <label className="check">
          <input type="checkbox" checked={form.autoStart} onChange={(e) => setForm({ ...form, autoStart: e.target.checked })} />
          <span>Encender automáticamente cuando se abra el panel</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.autoRestart} onChange={(e) => setForm({ ...form, autoRestart: e.target.checked })} />
          <span>Reiniciar si se cierra por un error (hasta 3 intentos seguidos)</span>
        </label>
        <div>
          <button
            className="btn-go"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  api(`/servers/${server.id}`, {
                    method: 'PATCH',
                    body: { ...form, memoryMb: Math.round(form.memoryGb * 1024), memoryGb: undefined },
                  }).then(refresh),
                'Cambios guardados'
              )
            }
          >
            Guardar cambios
          </button>
        </div>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Clonar servidor</h2>
        <p className="muted small">
          Crea una copia exacta (mundos, mods, plugins y configuración) con otro nombre y puerto. Úsala para probar mods o una versión nueva sin
          arriesgar el original. Se puede clonar con el servidor encendido.
        </p>
        <div className="row">
          <input style={{ maxWidth: 320 }} value={cloneName} onChange={(e) => setCloneName(e.target.value)} maxLength={40} aria-label="Nombre de la copia" />
          <button
            disabled={busy || !cloneName.trim()}
            onClick={() =>
              run(async () => {
                const c = await api(`/servers/${server.id}/clone`, { method: 'POST', body: { name: cloneName } });
                await refresh();
                navigate(`/servidor/${c.id}`);
              }, 'Servidor clonado')
            }
          >
            Clonar
          </button>
        </div>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Versión</h2>
        <p className="muted small">
          Cambia de versión o reinstala el servidor. Tus mundos, configuración, mods y plugins se conservan, pero haz un respaldo antes: bajar de
          versión puede dañar el mundo y los mods deben coincidir con la nueva versión.
        </p>
        <div>
          <button disabled={on || busy} onClick={() => setVersionModal(true)}>
            Cambiar versión o reinstalar
          </button>
        </div>
      </section>

      <section className="panel stack" style={{ borderColor: 'rgba(224,80,63,0.45)' }}>
        <h2 style={{ margin: 0 }}>Eliminar servidor</h2>
        <p className="muted small">Borra la carpeta del servidor, sus mundos y respaldos de esta PC.</p>
        <div>
          <button className="btn-stop" disabled={on} onClick={() => setConfirmDelete(true)}>
            Eliminar “{server.name}”
          </button>
        </div>
      </section>

      {versionModal && <VersionModal server={server} onClose={() => setVersionModal(false)} />}
      {confirmDelete && (
        <Confirm
          title={`Eliminar ${server.name}`}
          message="Se borrarán el servidor, sus mundos y todos sus respaldos. No se puede deshacer."
          confirmLabel="Eliminar para siempre"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() =>
            run(async () => {
              await api(`/servers/${server.id}`, { method: 'DELETE' });
              await refresh();
              navigate('/');
            }, 'Servidor eliminado')
          }
        />
      )}
    </div>
  );
}

function PropField({ field, value = '', onChange }) {
  if (field.type === 'bool') {
    return (
      <label className="check" style={{ alignSelf: 'center' }}>
        <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />
        <span>
          {field.label}
          {field.hint && <span className="faint" style={{ display: 'block' }}>{field.hint}</span>}
        </span>
      </label>
    );
  }
  return (
    <label className="field">
      <span>{field.label}</span>
      {field.type === 'select' ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {!value && <option value="">Predeterminado</option>}
          {field.options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
          {value && !field.options.some(([v]) => v === value) && <option value={value}>{value}</option>}
        </select>
      ) : (
        <input type={field.type} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.hint && <span>{field.hint}</span>}
    </label>
  );
}

function VersionModal({ server, onClose }) {
  const [versions, setVersions] = useState(null);
  const [mc, setMc] = useState(server.mcVersion);
  const [loader, setLoader] = useState(server.loaderVersion || '');
  const [run, busy] = useAction();
  const needsLoader = server.type === 'forge' || server.type === 'neoforge';

  useEffect(() => {
    api(`/system/versions/${server.type}`).then(setVersions);
  }, [server.type]);

  const loaders = versions?.find((v) => v.id === mc)?.loaders || [];
  useEffect(() => {
    if (needsLoader && loaders.length && !loaders.some((l) => l.version === loader)) setLoader(loaders[0].version);
  }, [loaders, loader, needsLoader]);

  return (
    <Modal title="Cambiar versión" onClose={onClose}>
      <label className="field">
        <span>Versión de Minecraft</span>
        <select value={mc} onChange={(e) => setMc(e.target.value)} disabled={!versions}>
          {versions?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.id}
              {v.id === server.mcVersion ? ' (actual)' : ''}
            </option>
          ))}
        </select>
      </label>
      {needsLoader && (
        <label className="field">
          <span>Versión de {server.type === 'forge' ? 'Forge' : 'NeoForge'}</span>
          <select value={loader} onChange={(e) => setLoader(e.target.value)}>
            {loaders.map((l) => (
              <option key={l.version} value={l.version}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancelar</button>
        <button
          className="btn-go"
          disabled={busy || !versions}
          onClick={() =>
            run(
              () => api(`/servers/${server.id}/reinstall`, { method: 'POST', body: { mcVersion: mc, loaderVersion: needsLoader ? loader : null } }),
              'Instalación iniciada'
            ).then(onClose)
          }
        >
          {mc === server.mcVersion ? 'Reinstalar' : `Cambiar a ${mc}`}
        </button>
      </div>
    </Modal>
  );
}
