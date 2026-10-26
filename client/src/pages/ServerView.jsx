import { useEffect, useRef } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { api, TYPE_LABEL } from '../api.js';
import { useLive, serverState } from '../live.jsx';
import { ServerIcon } from './Home.jsx';
import { Progress, Status, useAction, usePageTitle } from '../ui.jsx';
import ConsoleTab from './server/ConsoleTab.jsx';
import SettingsTab from './server/SettingsTab.jsx';
import FilesTab from './server/FilesTab.jsx';
import PlayersTab from './server/PlayersTab.jsx';
import ContentTab from './server/ContentTab.jsx';
import BackupsTab from './server/BackupsTab.jsx';
import NetworkTab from './server/NetworkTab.jsx';
import BedrockTab from './server/BedrockTab.jsx';
import MetricsTab from './server/MetricsTab.jsx';
import WorldsTab from './server/WorldsTab.jsx';
import SchedulesTab from './server/SchedulesTab.jsx';
import LogsTab from './server/LogsTab.jsx';
import SecurityTab from './server/SecurityTab.jsx';
import MapTab from './server/MapTab.jsx';
import ActivityTab from './server/ActivityTab.jsx';

const CONTENT_LABEL = { paper: 'Plugins', vanilla: 'Datapacks' };

/**
 * Pestañas agrupadas: 7 secciones arriba y, dentro de cada una, sus partes.
 * Las rutas no cambian, así que los enlaces viejos siguen funcionando.
 */
function sections(contentLabel) {
  return [
    { id: 'consola', label: 'Consola', items: [{ path: '', label: 'Consola' }] },
    {
      id: 'jugadores',
      label: 'Jugadores',
      items: [
        { path: 'jugadores', label: 'Lista y permisos' },
        { path: 'actividad', label: 'Actividad y ranking' },
      ],
    },
    {
      id: 'contenido',
      label: contentLabel,
      // Los datapacks funcionan en cualquier servidor; en Vanilla son lo único que hay.
      items: contentLabel === 'Datapacks' ? [{ path: 'contenido', label: 'Datapacks' }] : [{ path: 'contenido', label: contentLabel }, { path: 'datapacks', label: 'Datapacks' }],
    },
    {
      id: 'mundo',
      label: 'Mundo',
      items: [
        { path: 'mundos', label: 'Mundos' },
        { path: 'mapa', label: 'Mapa' },
        { path: 'respaldos', label: 'Respaldos' },
        { path: 'archivos', label: 'Archivos' },
      ],
    },
    {
      id: 'conexion',
      label: 'Conexión',
      items: [
        { path: 'conexion', label: 'Internet y dominio' },
        { path: 'bedrock', label: 'Bedrock (celular y consolas)' },
      ],
    },
    {
      id: 'estado',
      label: 'Estado',
      items: [
        { path: 'seguridad', label: 'Revisión' },
        { path: 'rendimiento', label: 'Rendimiento' },
        { path: 'logs', label: 'Logs' },
      ],
    },
    {
      id: 'ajustes',
      label: 'Ajustes',
      items: [
        { path: 'ajustes', label: 'General' },
        { path: 'tareas', label: 'Tareas programadas' },
      ],
    },
  ];
}

export default function ServerView() {
  const { id } = useParams();
  const { servers, runtime, installs, loaded } = useLive();
  const server = servers.find((s) => s.id === id);
  const rt = runtime[id];
  const state = serverState(server, rt);
  const [run, busy] = useAction();
  const location = useLocation();
  usePageTitle(server?.name);

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
        <ServerIcon server={server} size={64} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ overflowWrap: 'anywhere' }}>{server.name}</h1>
          <div className="server-meta">
            <Status state={state} />
            <span>
              {TYPE_LABEL[server.type]} {server.mcVersion}
              {server.loaderVersion && server.type !== 'vanilla' ? ` (${server.type === 'paper' ? 'build ' : ''}${server.loaderVersion})` : ''}
            </span>
            <span>Puerto {server.port}</span>
            {server.bedrock?.enabled && <span>Bedrock UDP {server.bedrock.port}</span>}
            {server.playit?.enabled && <span>Túnel playit.gg</span>}
            {server.modpack && <span>Modpack {server.modpack.name}</span>}
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

      <ServerNav base={base} groups={sections(contentLabel)} pathname={location.pathname} />

      <Routes>
        <Route index element={<ConsoleTab server={server} runtime={rt} state={state} />} />
        <Route path="contenido" element={<ContentTab server={server} label={contentLabel} />} />
        <Route path="datapacks" element={<ContentTab key="datapacks" server={server} label="Datapacks" kind="datapack" />} />
        <Route path="jugadores" element={<PlayersTab server={server} runtime={rt} />} />
        <Route path="archivos" element={<FilesTab server={server} state={state} />} />
        <Route path="respaldos" element={<BackupsTab server={server} state={state} />} />
        <Route path="conexion" element={<NetworkTab server={server} state={state} />} />
        <Route path="mundos" element={<WorldsTab server={server} state={state} />} />
        <Route path="actividad" element={<ActivityTab server={server} state={state} />} />
        <Route path="mapa" element={<MapTab server={server} state={state} />} />
        <Route path="tareas" element={<SchedulesTab server={server} />} />
        <Route path="rendimiento" element={<MetricsTab server={server} runtime={rt} />} />
        <Route path="logs" element={<LogsTab server={server} />} />
        <Route path="seguridad" element={<SecurityTab server={server} />} />
        <Route path="bedrock" element={<BedrockTab server={server} state={state} />} />
        <Route path="ajustes" element={<SettingsTab server={server} state={state} />} />
      </Routes>
    </div>
  );
}

function ServerNav({ base, groups, pathname }) {
  const sub = pathname.slice(base.length).replace(/^\//, '').split('/')[0];
  const current = groups.find((g) => g.items.some((i) => i.path === sub)) || groups[0];
  const navRef = useRef(null);
  // En el celular las secciones se desplazan de lado: deja visible la que está abierta.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector('.tab.active');
    if (nav && active) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  }, [current.id]);
  return (
    <>
      <nav className="tabs" aria-label="Secciones del servidor" ref={navRef}>
        {groups.map((g) => (
          <Link key={g.id} to={g.items[0].path ? `${base}/${g.items[0].path}` : base} className={`tab${g === current ? ' active' : ''}`} aria-current={g === current ? 'page' : undefined}>
            {g.label}
          </Link>
        ))}
      </nav>
      {current.items.length > 1 && (
        <nav className="subtabs" aria-label={current.label}>
          {current.items.map((i) => (
            <NavLink key={i.path} to={`${base}/${i.path}`} className={({ isActive }) => `subtab${isActive ? ' active' : ''}`}>
              {i.label}
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
}
