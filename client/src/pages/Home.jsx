import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, TYPE_LABEL } from '../api.js';
import { useLive, serverState } from '../live.jsx';
import { Status } from '../ui.jsx';

export default function Home() {
  const { servers, runtime, loaded } = useLive();
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api('/system/info').then(setInfo).catch(() => {});
  }, []);

  const online = servers.filter((s) => runtime[s.id]?.status === 'running');
  const players = online.reduce((n, s) => n + (runtime[s.id]?.players?.length || 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Tus servidores</h1>
          {info && (
            <p className="muted" style={{ marginTop: '0.4rem' }}>
              {online.length} de {servers.length} encendidos, {players} {players === 1 ? 'jugador conectado' : 'jugadores conectados'}.
              {' '}Esta PC tiene {Math.round(info.system.totalMemMb / 1024)} GB de RAM y {info.system.cores} núcleos.
            </p>
          )}
        </div>
        <div className="row">
          <Link to="/nuevo/modpack" className="btn">
            Desde un modpack
          </Link>
          <Link to="/nuevo" className="btn btn-go">
            Crear servidor
          </Link>
        </div>
      </div>

      {loaded && servers.length === 0 ? (
        <div className="empty">
          <h2>Crea tu primer servidor</h2>
          <p className="muted" style={{ maxWidth: '60ch' }}>
            Elige el tipo (Vanilla, Paper para plugins, o Fabric/Forge/NeoForge para mods) y la versión. El panel descarga todo, incluido
            Java, y lo deja listo para encender.
          </p>
          <Link to="/nuevo" className="btn btn-go">
            Crear servidor
          </Link>
        </div>
      ) : (
        <div className="server-rows">
          {servers.map((s) => {
            const rt = runtime[s.id];
            return (
              <Link key={s.id} to={`/servidor/${s.id}`} className="server-row">
                <i className={`dot ${serverState(s, rt)}`} aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  <strong>{s.name}</strong>
                  <div className="muted small">
                    {TYPE_LABEL[s.type]} {s.mcVersion}, puerto {s.port}
                  </div>
                </div>
                <span className="muted small">
                  {rt?.status === 'running' ? `${rt.players.length} en línea` : ''}
                </span>
                <Status state={serverState(s, rt)} />
              </Link>
            );
          })}
        </div>
      )}

      <div className="note" style={{ marginTop: '2rem', maxWidth: '75ch' }}>
        Para que tus amigos entren desde fuera de tu casa necesitas abrir el puerto de cada servidor en tu router.{' '}
        <Link to="/guia">Sigue la guía paso a paso</Link>.
      </div>
    </div>
  );
}
