import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { LiveProvider, useLive, serverState } from './live.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import CreateServer from './pages/CreateServer.jsx';
import ImportModpack from './pages/ImportModpack.jsx';
import ServerView from './pages/ServerView.jsx';
import Guide from './pages/Guide.jsx';
import PanelSettings from './pages/PanelSettings.jsx';
import { GrassBlock } from './ui.jsx';

export default function App() {
  const [auth, setAuth] = useState(null);

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

  if (!auth) {
    return (
      <div className="loading" aria-busy="true">
        <GrassBlock />
        <p className="small">Abriendo el panel…</p>
      </div>
    );
  }
  if (!auth.authenticated) return <Login setup={auth.setupRequired} onDone={check} />;

  return (
    <LiveProvider>
      <Shell username={auth.username} onLogout={check} />
    </LiveProvider>
  );
}

function Shell({ username, onLogout }) {
  const { servers, runtime, connected } = useLive();
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
              <NavLink to="/nuevo" className="btn btn-sm btn-ghost" title="Crear servidor">
                + Nuevo
              </NavLink>
            </div>
            {servers.length === 0 && <p className="faint small" style={{ padding: '0 0.5rem' }}>Todavía no hay servidores.</p>}
            {servers.map((s) => (
              <NavLink key={s.id} to={`/servidor/${s.id}`} className="side-link">
                <i className={`dot ${serverState(s, runtime[s.id])}`} aria-hidden="true" />
                <span className="name">{s.name}</span>
                {runtime[s.id]?.players?.length ? (
                  <span className="faint small tabular" title={`${runtime[s.id].players.length} jugando`}>
                    {runtime[s.id].players.length}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </div>
        </div>

        <div className="side-foot">
          <NavLink to="/guia" className="side-link">
            Guía para abrir puertos
          </NavLink>
          <NavLink to="/ajustes" className="side-link">
            Ajustes del panel
          </NavLink>
          <button
            className="side-link btn-ghost"
            style={{ justifyContent: 'flex-start', fontWeight: 400 }}
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' });
              onLogout();
            }}
          >
            Cerrar sesión ({username})
          </button>
          {!connected && <p className="small" style={{ color: 'var(--gold)', padding: '0.3rem 0.55rem' }}>Reconectando con el panel…</p>}
        </div>
      </aside>

      <main className="main" id="contenido" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/nuevo" element={<CreateServer />} />
          <Route path="/nuevo/modpack" element={<ImportModpack />} />
          <Route path="/servidor/:id/*" element={<ServerView />} />
          <Route path="/guia" element={<Guide />} />
          <Route path="/ajustes" element={<PanelSettings />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
    </div>
  );
}
