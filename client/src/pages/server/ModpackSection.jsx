import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDate } from '../../api.js';
import { useLive, serverState } from '../../live.jsx';
import { CopyButton, Modal, useAction } from '../../ui.jsx';

const SITE_LABEL = { modrinth: 'Modrinth', curseforge: 'CurseForge' };
const LOADER_LABEL = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge' };

/**
 * Arriba de la pestaña Mods: el modpack del servidor (versión, actualizar) y el archivo
 * que se les manda a los jugadores para que tengan los mismos mods.
 */
export default function ModpackSection({ server }) {
  const { runtime } = useLive();
  const running = ['starting', 'running', 'stopping'].includes(serverState(server, runtime[server.id]));
  const [data, setData] = useState(null);
  const load = useCallback(() => api(`/servers/${server.id}/modpack`).then(setData), [server.id]);
  useEffect(() => {
    load().catch(() => {});
  }, [load, server.installState]);

  if (!data || !data.mods) return null;
  return (
    <div className="stack" style={{ gap: '1rem' }}>
      {data.modpack && <ModpackCard server={server} data={data} running={running} onChanged={load} />}
      <PlayersCard server={server} data={data} />
    </div>
  );
}

function ModpackCard({ server, data, running, onChanged }) {
  const mp = data.modpack;
  const [confirm, setConfirm] = useState(null); // versión elegida o { file }
  const [showOthers, setShowOthers] = useState(false);
  const fileRef = useRef(null);
  const compatible = data.updates.filter((u) => u.compatible);
  // El botón principal ofrece la última versión estable; las beta quedan en "otras versiones".
  const latest = compatible.find((u) => u.type === 'release');

  return (
    <section className="panel stack" style={{ gap: '0.75rem' }} aria-label="Modpack">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <div className="grow">
          <div className="faint small">Modpack</div>
          <h2 style={{ margin: 0 }}>
            {mp.name} {mp.version && <span className="muted" style={{ fontWeight: 400 }}>{mp.version}</span>}
          </h2>
          <div className="muted small">
            {mp.site ? `De ${SITE_LABEL[mp.site]}` : `Archivo ${mp.format === 'curseforge' ? 'de CurseForge' : '.mrpack'} subido`}
            {mp.appliedAt && ` · instalado ${formatDate(mp.appliedAt)}`}
            {mp.page && (
              <>
                {' · '}
                <a href={mp.page} target="_blank" rel="noreferrer">
                  Ver página
                </a>
              </>
            )}
          </div>
        </div>
        {latest && (
          <button className="btn-go" disabled={running || mp.pending} onClick={() => setConfirm(latest)}>
            Actualizar a {latest.number}
          </button>
        )}
      </div>

      {mp.pending && <p className="note" style={{ margin: 0 }}>Instalando la versión del modpack…</p>}
      {latest && running && <p className="note" style={{ margin: 0 }}>Hay una versión nueva. Apaga el servidor para actualizar.</p>}
      {!latest && mp.site && !data.updatesError && (
        <p className="small" style={{ margin: 0, color: 'var(--prismarine)' }}>
          {data.updates.length ? 'Tienes la versión estable más reciente.' : 'Tienes la versión más reciente.'}
        </p>
      )}
      {data.updatesError && <p className="faint small" style={{ margin: 0 }}>No se pudo buscar versiones nuevas: {data.updatesError}</p>}

      {data.updates.length > (latest ? 1 : 0) ? (
        <div>
          <button className="link-btn" style={{ fontSize: 'var(--step--1)', fontWeight: 500, color: 'var(--prismarine)' }} onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}>
            {showOthers
              ? 'Ocultar otras versiones'
              : data.updates.length === 1
                ? `Ver la versión ${data.updates[0].type === 'release' ? 'más nueva' : 'de prueba más nueva'}`
                : `Ver las ${data.updates.length} versiones más nuevas`}
          </button>
          {showOthers && (
            <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
              <table className="table">
                <tbody>
                  {data.updates.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.number} {u.type !== 'release' && <span className="faint">({u.type})</span>}
                      </td>
                      <td className="muted">Minecraft {u.gameVersions.join(', ')}</td>
                      <td className="muted">{formatDate(u.date)}</td>
                      <td className="actions">
                        {u.compatible ? (
                          <button className="btn-sm" disabled={running || mp.pending} onClick={() => setConfirm(u)}>
                            Usar esta
                          </button>
                        ) : (
                          <span className="faint small">Usa {u.loaders.map((l) => LOADER_LABEL[l] || l).join(', ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <div className="row small">
        <span className="muted grow">¿Descargaste otra versión del modpack? Súbela aquí.</span>
        <button className="btn-sm" disabled={running || mp.pending} onClick={() => fileRef.current.click()}>
          Subir otra versión
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".mrpack,.zip"
          hidden
          onChange={(e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (file) setConfirm({ file });
          }}
        />
      </div>

      {mp.clientOnly.length > 0 && (
        <details className="small">
          <summary className="muted">
            {mp.clientOnly.length === 1 ? '1 mod se omitió en el servidor porque solo sirve' : `${mp.clientOnly.length} mods se omitieron en el servidor porque solo sirven`} en
            el juego
          </summary>
          <p className="faint" style={{ margin: '0.4rem 0' }}>
            Gráficos, minimapas, menús… El servidor fallaría con ellos. Tus jugadores sí los reciben en el archivo de abajo.
          </p>
          <p className="mono faint" style={{ margin: 0, fontSize: 11 }}>
            {mp.clientOnly.join(', ')}
          </p>
        </details>
      )}
      {mp.failed.length > 0 && (
        <div className="error-box">
          <strong>
            {mp.failed.length} {mp.failed.length === 1 ? 'archivo no se pudo' : 'archivos no se pudieron'} descargar.
          </strong>{' '}
          Bájalos tú y súbelos en <Link to={`/servidor/${server.id}/archivos`}>Archivos</Link>:
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
            {mp.failed.map((f) => (
              <li key={f} style={{ wordBreak: 'break-word' }}>
                <Linkified text={f} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirm && <UpdateConfirm server={server} mp={mp} choice={confirm} onClose={() => setConfirm(null)} onDone={onChanged} />}
    </section>
  );
}

/** Convierte las direcciones https:// del texto en enlaces. */
function Linkified({ text }) {
  return text.split(/(https:\/\/[^\s]+?)(?=[\s,)]|\.?\s|\.?$)/).map((part, i) =>
    /^https:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    )
  );
}

function UpdateConfirm({ server, mp, choice, onClose, onDone }) {
  const [run, busy] = useAction();
  const isFile = Boolean(choice.file);
  const changesMc = !isFile && choice.gameVersions?.length && !choice.gameVersions.includes(server.mcVersion);
  return (
    <Modal title={isFile ? `Instalar ${choice.file.name}` : `Actualizar ${mp.name} a ${choice.number}`} onClose={busy ? undefined : onClose}>
      <ul className="muted small" style={{ margin: 0, paddingLeft: '1.1rem', lineHeight: 1.6 }}>
        <li>Primero se hace un respaldo completo del servidor (pestaña Respaldos).</li>
        <li>Se reemplazan los mods y la configuración del modpack.</li>
        <li>Tu mundo y los mods que agregaste tú se quedan.</li>
        <li>Tus jugadores también tienen que actualizar: mándales el archivo nuevo de abajo.</li>
      </ul>
      {changesMc && (
        <p className="note">
          Esta versión es para Minecraft {choice.gameVersions.join(', ')} (tu servidor está en {server.mcVersion}). El mundo se convierte al encender y no se
          puede abrir en la versión anterior; para volver atrás tendrías que restaurar el respaldo.
        </p>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button
          className="btn-go"
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (isFile) {
                const form = new FormData();
                form.append('file', choice.file);
                await api(`/servers/${server.id}/modpack/update`, { method: 'POST', form });
              } else {
                await api(`/servers/${server.id}/modpack/update`, { method: 'POST', body: { versionId: choice.id } });
              }
              onClose();
              await onDone();
            }, 'Respaldo listo. Instalando la nueva versión del modpack…')
          }
        >
          {busy ? 'Haciendo respaldo…' : 'Respaldar y actualizar'}
        </button>
      </div>
    </Modal>
  );
}

function PlayersCard({ server, data }) {
  const mp = data.modpack;
  const format = mp?.format === 'curseforge' ? 'curseforge' : 'mrpack';
  const ready = server.installState === 'ready' && !mp?.pending;
  return (
    <section className="panel stack" style={{ gap: '0.75rem' }} aria-label="Para tus jugadores">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <h2 style={{ margin: 0 }}>Para tus jugadores</h2>
          <p className="muted small" style={{ margin: '0.25rem 0 0', maxWidth: '62ch' }}>
            Para entrar necesitan los mismos mods. Descarga este archivo y mándaselo por WhatsApp o Discord: trae {mp ? 'el modpack completo' : 'los mods del servidor'}
            {mp ? ', los mods que agregaste' : ''} y tu servidor ya agregado en Multijugador.
          </p>
        </div>
        {ready ? (
          <a className="btn btn-go" href={`/api/servers/${server.id}/modpack/players`} download>
            Descargar para jugadores
          </a>
        ) : (
          <button className="btn-go" disabled>
            Descargar para jugadores
          </button>
        )}
      </div>

      <ol className="muted small" style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.7 }}>
        {format === 'curseforge' ? (
          <>
            <li>
              Instalan{' '}
              <a href="https://www.curseforge.com/download/app" target="_blank" rel="noreferrer">
                CurseForge App
              </a>{' '}
              o{' '}
              <a href="https://prismlauncher.org/" target="_blank" rel="noreferrer">
                Prism Launcher
              </a>{' '}
              (gratis).
            </li>
            <li>En CurseForge App: Minecraft → Crear perfil personalizado → Importar → eligen el .zip. En Prism: Agregar instancia → Importar.</li>
          </>
        ) : (
          <>
            <li>
              Instalan{' '}
              <a href="https://modrinth.com/app" target="_blank" rel="noreferrer">
                Modrinth App
              </a>{' '}
              o{' '}
              <a href="https://prismlauncher.org/" target="_blank" rel="noreferrer">
                Prism Launcher
              </a>{' '}
              (gratis).
            </li>
            <li>Arrastran el archivo .mrpack a la app (o: Crear instancia → Importar desde archivo). Se descargan solos todos los mods.</li>
          </>
        )}
        <li>Abren esa instancia, van a Multijugador y tu servidor ya está en la lista.</li>
      </ol>

      {data.address ? (
        <div className="row small">
          <span className="muted">Dirección que va incluida:</span>
          <span className="mono">{data.address}</span>
          <CopyButton text={data.address} />
        </div>
      ) : (
        <p className="note" style={{ margin: 0 }}>
          No se pudo saber la dirección de tu servidor; tus amigos tendrán que agregarla a mano en Multijugador (la ves en Conexión).
        </p>
      )}
      {mp?.page && (
        <p className="faint small" style={{ margin: 0 }}>
          También pueden instalar {mp.name} {mp.version} desde{' '}
          <a href={mp.page} target="_blank" rel="noreferrer">
            su página
          </a>
          , pero así no tendrían los mods que agregaste ni el servidor en la lista.
        </p>
      )}
    </section>
  );
}
