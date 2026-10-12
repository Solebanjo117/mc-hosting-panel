import { NavLink, Route, Routes, useParams } from 'react-router-dom';
import { api, TYPE_LABEL } from '../api.js';
import { useLive, serverState } from '../live.jsx';
import { Progress, Status, useAction } from '../ui.jsx';
import ConsoleTab from './server/ConsoleTab.jsx';
import SettingsTab from './server/SettingsTab.jsx';
import FilesTab from './server/FilesTab.jsx';
import PlayersTab from './server/PlayersTab.jsx';
import ContentTab from './server/ContentTab.jsx';
import BackupsTab from './server/BackupsTab.jsx';
import NetworkTab from './server/NetworkTab.jsx';

const CONTENT_LABEL = { paper: 'Plugins', vanilla: 'Datapacks' };

export default function ServerView() {
  const { id } = useParams();
  const { servers, runtime, installs, loaded } = useLive();
  const server = servers.find((s) => s.id === id);
  const rt = runtime[id];
  const state = serverState(server, rt);
  const [run, busy] = useAction();

  if (!server) {
    return <div className="page">{loaded ? <p className="muted">Este servidor no existe o fue eliminado.</p> : null}</div>;
  }

  const install = installs[id];
  const ready = server.installState === 'ready';
  const on = ['starting', 'running', 'stopping'].includes(state);
  const power = (action, msg) => run(() => api(`/servers/${id}/${action}`, { method: 'POST' }), msg);
  const contentLabel = CONTENT_LABEL[server.type] || 'Mods';
  const base = `/servidor/${id}`;

  return (
    <div className="page">
      <header className="server-head">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ overflowWrap: 'anywhere' }}>{server.name}</h1>
          <div className="server-meta">
            <Status state={state} />
            <span>
              {TYPE_LABEL[server.type]} {server.mcVersion}
              {server.loaderVersion && server.type !== 'vanilla' ? ` (${server.type === 'paper' ? 'build ' : ''}${server.loaderVersion})` : ''}
            </span>
            <span>Puerto {server.port}</span>
            <span>{(server.memoryMb / 1024).toFixed(1).replace('.0', '')} GB de RAM</span>
          </div>
        </div>
        {ready && (
          <div className="row">
            {!on && (
              <button className="btn-go" disabled={busy} onClick={() => power('start')}>
                Encender
              </button>
            )}
            {on && (
              <>
                <button disabled={busy || state === 'stopping'} onClick={() => power('restart', 'Reiniciando servidor')}>
                  Reiniciar
                </button>
                <button className="btn-stop" disabled={busy || state === 'stopping'} onClick={() => power('stop')}>
                  Apagar
                </button>
              </>
            )}
            {state === 'stopping' && (
              <button className="btn-stop" onClick={() => power('kill', 'Proceso terminado')} title="Termina el proceso sin guardar">
                Forzar cierre
              </button>
            )}
          </div>
        )}
      </header>

      {state === 'installing' && (
        <div className="panel stack" style={{ marginBottom: '1.5rem', gap: '0.6rem' }}>
          <h2>Instalando el servidor</h2>
          <p className="muted small">{install?.message || 'Preparando la descarga…'}</p>
          <Progress value={install?.progress ?? null} />
        </div>
      )}

      {state === 'error' && (
        <div className="stack" style={{ marginBottom: '1.5rem', gap: '0.6rem' }}>
          <div className="error-box">La instalación falló: {server.installError}</div>
          <div className="row">
            <button
              className="btn-go"
              disabled={busy}
              onClick={() => run(() => api(`/servers/${id}/reinstall`, { method: 'POST', body: {} }))}
            >
              Reintentar instalación
            </button>
            <span className="muted small">Revisa tu conexión a internet. Si sigue fallando, prueba otra versión en Ajustes.</span>
          </div>
        </div>
      )}

      <nav className="tabs" aria-label="Secciones del servidor">
        <NavLink end to={base} className="tab">
          Consola
        </NavLink>
        <NavLink to={`${base}/contenido`} className="tab">
          {contentLabel}
        </NavLink>
        <NavLink to={`${base}/jugadores`} className="tab">
          Jugadores
        </NavLink>
        <NavLink to={`${base}/archivos`} className="tab">
          Archivos
        </NavLink>
        <NavLink to={`${base}/respaldos`} className="tab">
          Respaldos
        </NavLink>
        <NavLink to={`${base}/conexion`} className="tab">
          Conexión
        </NavLink>
        <NavLink to={`${base}/ajustes`} className="tab">
          Ajustes
        </NavLink>
      </nav>

      <Routes>
        <Route index element={<ConsoleTab server={server} runtime={rt} state={state} />} />
        <Route path="contenido" element={<ContentTab server={server} label={contentLabel} />} />
        <Route path="jugadores" element={<PlayersTab server={server} runtime={rt} />} />
        <Route path="archivos" element={<FilesTab server={server} />} />
        <Route path="respaldos" element={<BackupsTab server={server} state={state} />} />
        <Route path="conexion" element={<NetworkTab server={server} state={state} />} />
        <Route path="ajustes" element={<SettingsTab server={server} state={state} />} />
      </Routes>
    </div>
  );
}
