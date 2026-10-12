import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useLive } from '../../live.jsx';
import { CopyButton, useAction, useToast } from '../../ui.jsx';

export default function BedrockTab({ server, state }) {
  const { refresh, runtime } = useLive();
  const xbox = runtime[server.id]?.xbox;
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [port, setPort] = useState('');
  const [floodgate, setFloodgate] = useState(true);
  const [working, setWorking] = useState('');
  const [run, busy] = useAction();
  const toast = useToast();
  const on = ['running', 'starting', 'stopping'].includes(state);

  const load = useCallback(
    () =>
      api(`/servers/${server.id}/bedrock`)
        .then((i) => {
          setInfo(i);
          setPort(String(i.port));
          setFloodgate(i.floodgate);
        })
        .catch((err) => setError(err.message)),
    [server.id]
  );
  useEffect(() => {
    load();
  }, [load]);

  function report(result, verb) {
    const ok = result.installed.filter((i) => !i.error);
    const failed = result.installed.filter((i) => i.error);
    toast(`${verb}: ${ok.map((i) => `${i.title} ${i.version || ''}`.trim()).join(', ')}`);
    for (const f of failed) toast(f.error, 'error');
    if (result.restartRequired) toast('Reinicia el servidor para que Bedrock empiece a funcionar.');
  }

  async function enable() {
    setWorking('enable');
    try {
      const r = await api(`/servers/${server.id}/bedrock/enable`, { method: 'POST', body: { port: Number(port), floodgate } });
      report(r, 'Instalado');
      await Promise.all([load(), refresh()]);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setWorking('');
    }
  }

  if (server.installState !== 'ready') return <p className="muted">Podrás activar Bedrock cuando termine la instalación del servidor.</p>;
  if (error) return <div className="error-box">{error}</div>;
  if (!info) return <p className="muted">Revisando compatibilidad…</p>;

  const intro = (
    <p className="muted" style={{ maxWidth: '70ch' }}>
      Con Geyser, los jugadores de Minecraft Bedrock (celular, tablet, Windows 10/11, Xbox, PlayStation y Switch) entran a este mismo servidor junto
      con los de Java. Bedrock usa su propio puerto, por <strong>UDP</strong>.
    </p>
  );

  if (!info.supported) {
    return (
      <div className="stack" style={{ maxWidth: 820 }}>
        {intro}
        <div className="note">{info.reason}</div>
      </div>
    );
  }

  const enabled = info.enabled;

  return (
    <div className="stack" style={{ gap: '1.5rem', maxWidth: 900 }}>
      {intro}
      {info.compatibilityError && (
        <div className="error-box">No se pudo revisar la compatibilidad en Modrinth: {info.compatibilityError}</div>
      )}

      <section className="panel stack">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            {enabled ? 'Bedrock está activado' : 'Activar Bedrock'}
          </h2>
          {enabled && <span className="chip">UDP {info.port}</span>}
        </div>

        <div className="grid-2">
          <label className="field">
            <span>Puerto Bedrock (UDP)</span>
            <input type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
            <span>El que escriben los jugadores de Bedrock. El normal es 19132.</span>
          </label>
          <label className="check" style={{ alignSelf: 'center' }}>
            <input type="checkbox" checked={floodgate} onChange={(e) => setFloodgate(e.target.checked)} />
            <span>
              Permitir jugadores sin cuenta de Java (Floodgate)
              <span className="faint" style={{ display: 'block' }}>
                Sin Floodgate, cada jugador de Bedrock tiene que iniciar sesión con una cuenta de Minecraft Java.
              </span>
            </span>
          </label>
        </div>

        <ul className="muted small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
          <li>Se instala Geyser{floodgate ? ' y Floodgate' : ''} desde Modrinth y GeyserMC.</li>
          {server.type === 'fabric' && <li>También Fabric API, que Geyser necesita en Fabric.</li>}
          {info.viaVersion && (
            <li>
              Y ViaVersion: Geyser habla la versión de Java más reciente ({info.latestRelease}) y tu servidor está en {server.mcVersion}.
            </li>
          )}
          <li>Los jugadores de Bedrock aparecen con un punto al inicio del nombre, por ejemplo “.Steve”.</li>
        </ul>

        <div className="row">
          <button className="btn-go" disabled={busy || working !== ''} onClick={enable}>
            {working === 'enable' ? 'Instalando…' : enabled ? 'Guardar cambios' : 'Activar Bedrock'}
          </button>
          {enabled && (
            <>
              <button
                disabled={busy || working !== ''}
                onClick={async () => {
                  setWorking('update');
                  await run(async () => report(await api(`/servers/${server.id}/bedrock/update`, { method: 'POST' }), 'Actualizado'));
                  await load();
                  setWorking('');
                }}
              >
                {working === 'update' ? 'Actualizando…' : 'Actualizar Geyser'}
              </button>
              <button
                className="btn-stop"
                disabled={busy || working !== ''}
                onClick={() =>
                  run(async () => {
                    const r = await api(`/servers/${server.id}/bedrock/disable`, { method: 'POST' });
                    await Promise.all([load(), refresh()]);
                    if (r.restartRequired) toast('Reinicia el servidor para terminar de desactivar Bedrock.');
                  }, 'Bedrock desactivado')
                }
              >
                Desactivar
              </button>
            </>
          )}
          {on && <span className="muted small">Los cambios se aplican al reiniciar el servidor.</span>}
        </div>
      </section>

      {enabled && (
        <>
          <section className="panel">
            <h2>Instalado para Bedrock</h2>
            {info.items.length === 0 ? (
              <p className="muted small">No se encontraron los archivos. Pulsa “Actualizar Geyser” para reinstalarlos.</p>
            ) : (
              <table className="table">
                <tbody>
                  {info.items.map((i) => (
                    <tr key={i.filename}>
                      <td>{i.title}</td>
                      <td className="muted">{i.versionName}</td>
                      <td className="muted mono small">{i.filename}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {info.configPort && Number(info.configPort) !== Number(info.port) && (
              <p className="note" style={{ marginTop: '0.8rem' }}>
                La configuración de Geyser todavía dice el puerto {info.configPort}. Se corrige sola la próxima vez que enciendas el servidor.
              </p>
            )}
          </section>

          <section className="panel stack" style={{ gap: '0.6rem' }}>
            <h2 style={{ margin: 0 }}>Cómo entran los jugadores de Bedrock</h2>
            <p className="muted small">
              En Minecraft Bedrock: Jugar, pestaña Servidores, Agregar servidor. Escriben la dirección y el puerto {info.port}. Para jugar fuera de tu
              casa abre el puerto <strong>{info.port} UDP</strong> en el firewall y en el router; las direcciones y la prueba están en{' '}
              <Link to={`/servidor/${server.id}/conexion`}>Conexión</Link>.
            </p>
            <p className="muted small">
              Xbox, PlayStation y Switch no dejan agregar servidores propios; para ellos activa la opción de abajo.
            </p>
          </section>

          <Broadcast server={server} info={info} xbox={xbox} on={on} onChange={load} />
        </>
      )}
    </div>
  );
}

function Broadcast({ server, info, xbox, on, onChange }) {
  const [run, busy] = useAction();
  const b = info.broadcast || {};
  const set = (body, msg) =>
    run(async () => {
      const r = await api(`/servers/${server.id}/bedrock/broadcast`, { method: 'POST', body });
      await onChange();
      return r;
    }, msg);

  return (
    <section className="panel stack" style={{ gap: '0.8rem' }}>
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Consolas: Xbox, PlayStation y Switch
        </h2>
        {b.installed && <span className="chip">MCXboxBroadcast</span>}
      </div>
      <p className="muted small" style={{ maxWidth: '75ch' }}>
        MCXboxBroadcast conecta el servidor a una cuenta de Xbox. Tus amigos agregan esa cuenta como amiga y el servidor les aparece en la pestaña
        Amigos de Minecraft, desde cualquier consola. Usa una cuenta de Microsoft secundaria, no la tuya principal: es una herramienta no oficial.
      </p>

      {!b.installed ? (
        <div>
          <button className="btn-go" disabled={busy} onClick={() => set({ enabled: true }, 'MCXboxBroadcast instalado. Reinicia el servidor.')}>
            Activar para consolas
          </button>
        </div>
      ) : (
        <>
          {xbox?.state === 'login' ? (
            <div className="login-code">
              <p>Inicia sesión con la cuenta de Xbox que va a anunciar el servidor:</p>
              <ol className="small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
                <li>
                  Abre{' '}
                  <a href={xbox.url} target="_blank" rel="noreferrer">
                    {xbox.url}
                  </a>
                </li>
                <li>
                  Escribe el código <span className="code-big">{xbox.code}</span> <CopyButton text={xbox.code} />
                </li>
                <li>Entra con la cuenta secundaria. Esta página se actualiza sola cuando termines.</li>
              </ol>
            </div>
          ) : xbox?.state === 'authenticated' || xbox?.state === 'live' || b.gamertag ? (
            <p className="small">
              Anunciando con la cuenta <strong>{xbox?.gamertag || b.gamertag}</strong>
              {xbox?.state === 'live' ? ' (sesión de Xbox activa)' : ''}. Tus amigos deben agregar <strong>{xbox?.gamertag || b.gamertag}</strong> como
              amigo en Xbox; se acepta solo y el servidor aparece en Minecraft, pestaña Amigos.
            </p>
          ) : (
            <p className="muted small">
              {on
                ? 'Esperando a que MCXboxBroadcast arranque… Si no aparece un código en un minuto, reinicia el servidor.'
                : 'Enciende el servidor: la primera vez aparecerá aquí un código para iniciar sesión con Xbox.'}
            </p>
          )}
          <div className="row">
            <button className="btn-stop" disabled={busy} onClick={() => set({ enabled: false }, 'MCXboxBroadcast desactivado')}>
              Desactivar
            </button>
            {b.loggedIn && (
              <button disabled={busy} onClick={() => set({ enabled: false, forgetAccount: true }, 'Cuenta de Xbox olvidada')}>
                Cerrar sesión de Xbox
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
