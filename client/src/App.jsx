import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { LiveProvider, useLive, serverState } from './live.jsx';
import Login from './pages/Login.jsx';
import PublicStatus from './pages/PublicStatus.jsx';
import Home from './pages/Home.jsx';
import ServerView from './pages/ServerView.jsx';
import { Electric, ELECTRIC_STATES, GrassBlock, PageLoading } from './ui.jsx';
import { STATUS_LABEL } from './api.js';
import { useAppearance } from './appearance.js';
import Backdrops from './Backdrops.jsx';
import { AuthProvider, ROLE_LABEL, useAuth } from './auth.jsx';
import Widget, { openWidget } from './pages/Widget.jsx';

// Las páginas que no se abren al entrar se descargan la primera vez que se visitan.
const CreateServer = lazy(() => import('./pages/CreateServer.jsx'));
const ImportModpack = lazy(() => import('./pages/ImportModpack.jsx'));
const Guide = lazy(() => import('./pages/Guide.jsx'));
const PanelSettings = lazy(() => import('./pages/PanelSettings.jsx'));
const Appearance = lazy(() => import('./pages/Appearance.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));

export default function App() {
  const [auth, setAuth] = useState(null);
  const location = useLocation();
  const isPublic = /^\/estado\//.test(location.pathname);
  const isWidget = location.pathname === '/widget';

  const check = () =>
    api('/auth/status')
      .then(setAuth)
      .catch(() => setAuth({ setupRequired: false, authenticated: false }));

  useEffect(() => {
    check();
    const lost = () => setAuth((a) => ({ ...a, authenticated: false }));
    window.addEventListener('auth-lost', lost);
    return () => window.removeEventListener('auth-lost', lost);
  }, []);

  if (isPublic) {
    return (
      <Routes>
        <Route path="/estado/:id" element={<PublicStatus />} />
      </Routes>
    );
  }
  if (!auth) {
    return (
      <div className="loading" aria-busy="true">
        <GrassBlock />
        <p className="small">Abriendo el panel…</p>
      </div>
    );
  }
  if (!auth.authenticated) return <Login setup={auth.setupRequired} onDone={check} />;

  if (isWidget) {
    return (
      <AuthProvider value={auth}>
        <LiveProvider>
          <Widget />
        </LiveProvider>
      </AuthProvider>
    );
  }
  return (
    <AuthProvider value={auth}>
      <LiveProvider>
        <Shell username={auth.username} onLogout={check} />
      </LiveProvider>
    </AuthProvider>
  );
}

function Shell({ username, onLogout }) {
  const { servers, runtime, connected } = useLive();
  const { electric } = useAppearance();
  const { isOwner, role } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  // En el celular, Esc cierra el menú.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="shell">
      <Backdrops servers={servers} />
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="mobile-bar">
        <button className="btn-ghost" onClick={() => setOpen(true)} aria-label="Abrir menú" aria-expanded={open}>
          ☰
        </button>
        <span className="brand" style={{ padding: 0 }}>
          <GrassBlock />
          MC Hosting Panel
        </span>
      </header>

      {open && <button type="button" className="side-backdrop" onClick={() => setOpen(false)} aria-label="Cerrar menú" />}

      <aside className={`sidebar${open ? ' open' : ''}`}>
        <NavLink to="/" className="brand" end>
          <GrassBlock />
          MC Hosting Panel
        </NavLink>

        <div className="side-scroll">
          <div className="side-section">
            <div className="side-title">
              <span>Servidores</span>
              {isOwner && (
                <NavLink to="/nuevo" className="btn btn-sm btn-ghost" title="Crear servidor">
                  + Nuevo
                </NavLink>
              )}
            </div>
            {servers.length === 0 && (
              <p className="faint small" style={{ padding: '0 0.5rem' }}>
                {isOwner ? 'Todavía no hay servidores.' : 'No tienes servidores asignados.'}
              </p>
            )}
            {servers.map((s) => {
              const st = serverState(s, runtime[s.id]);
              // El estado se ve en el borde eléctrico (color según el estado); apagado no lleva nada.
              return (
                <NavLink key={s.id} to={`/servidor/${s.id}`} className="side-link">
                  {electric ? (
                    <>
                      {ELECTRIC_STATES.has(st) && <Electric state={st} small />}
                      <span className="sr-only">{STATUS_LABEL[st] || st}: </span>
                    </>
                  ) : (
                    <i className={`dot ${st}`} aria-hidden="true" title={STATUS_LABEL[st] || st} />
                  )}
                  <span className="name">{s.name}</span>
                  {runtime[s.id]?.players?.length ? (
                    <span className="faint small tabular" title={`${runtime[s.id].players.length} jugando`}>
                      {runtime[s.id].players.length}
                    </span>
                  ) : null}
                </NavLink>
              );
            })}
          </div>
        </div>

        <div className="side-foot">
          <NavLink to="/rendimiento" className="side-link">
            Rendimiento general
          </NavLink>
          <NavLink to="/guia" className="side-link">
            Guías (puertos, Linux)
          </NavLink>
          {isOwner && (
            <NavLink to="/ajustes" className="side-link">
              Ajustes del panel
            </NavLink>
          )}
          {isOwner && (
            <NavLink to="/apariencia" className="side-link">
              Perfil y apariencia
            </NavLink>
          )}
          <button className="side-link btn-ghost" style={{ justifyContent: 'flex-start', fontWeight: 400 }} onClick={() => openWidget()} title="Una ventana pequeña siempre encima con tus servidores">
            Abrir widget flotante
          </button>
          <button
            className="side-link btn-ghost"
            style={{ justifyContent: 'flex-start', fontWeight: 400 }}
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' });
              onLogout();
            }}
          >
            Cerrar sesión ({username}
            {role && role !== 'owner' ? `, ${ROLE_LABEL[role].toLowerCase()}` : ''})
          </button>
          {!connected && (
            <p className="small" style={{ color: 'var(--gold)', padding: '0.3rem 0.55rem' }}>
              Reconectando con el panel…
            </p>
          )}
        </div>
      </aside>

      <main className="main" id="contenido" tabIndex={-1}>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/rendimiento" element={<Dashboard />} />
            <Route path="/nuevo" element={isOwner ? <CreateServer /> : <Navigate to="/" replace />} />
            <Route path="/nuevo/modpack" element={isOwner ? <ImportModpack /> : <Navigate to="/" replace />} />
            <Route path="/servidor/:id/*" element={<ServerView />} />
            <Route path="/guia" element={<Guide />} />
            <Route path="/guia/:doc" element={<Guide />} />
            <Route path="/ajustes" element={isOwner ? <PanelSettings /> : <Navigate to="/" replace />} />
            <Route path="/apariencia" element={isOwner ? <Appearance username={username} /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
