import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, uptime } from '../../api.js';
import { useLive } from '../../live.jsx';
import { Confirm, CopyButton, PlayerHead, useToast } from '../../ui.jsx';
import { parseConsole, segStyle } from '../../mcText.js';
import { Findings } from './LogsTab.jsx';
import QuickCommands, { RunCommand } from './QuickCommands.jsx';

const FILTERS = [
  { id: 'all', label: 'Todo' },
  { id: 'chat', label: 'Chat' },
  { id: 'problems', label: 'Avisos y errores' },
  { id: 'cmd', label: 'Comandos' },
];
const plain = (line) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/§[0-9a-fk-or]/gi, '');
const isChat = (l) => /<[A-Za-z0-9_.]{2,17}> |\[Not Secure\] |\[Server\]|joined the game|left the game/.test(l);
const isProblem = (l) => /(WARN|ERROR|FATAL|Exception|SEVERE)/.test(l);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function lineClass(line) {
  if (line.startsWith('> ')) return 'l-cmd';
  if (/\[Panel\]/.test(line)) return 'l-panel';
  if (/(ERROR|FATAL|Exception|SEVERE)/.test(line)) return 'l-error';
  if (/WARN/.test(line)) return 'l-warn';
  if (/joined the game|left the game/.test(line)) return 'l-join';
  return '';
}

export default function ConsoleTab({ server, runtime, state }) {
  const { subscribeConsole } = useLive();
  const toast = useToast();
  const [lines, setLines] = useState([]);
  const [cmd, setCmd] = useState('');
  const [history, setHistory] = useState([]);
  const [hIndex, setHIndex] = useState(-1);
  const [lanIp, setLanIp] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState(null); // { name, x, y }
  const [giveFor, setGiveFor] = useState(null); // { cmd, player }
  const [kick, setKick] = useState(null);
  const outRef = useRef(null);
  const stick = useRef(true);
  const [, tick] = useState(0);

  useEffect(() => subscribeConsole(server.id, (l) => setLines(l)), [server.id, subscribeConsole]);
  useEffect(() => {
    api('/system/network')
      .then((n) => setLanIp(n.localIps.find((i) => !i.virtual)?.address || n.localIps[0]?.address))
      .catch(() => {});
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    const el = outRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const running = state === 'running' || state === 'starting';

  async function send(command) {
    const c = command.trim();
    if (!c) return;
    try {
      await api(`/servers/${server.id}/command`, { method: 'POST', body: { command: c } });
      setHistory((h) => [c, ...h.filter((x) => x !== c)].slice(0, 50));
      setHIndex(-1);
      setCmd('');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function onKey(e) {
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const i = Math.min(hIndex + 1, history.length - 1);
      setHIndex(i);
      setCmd(history[i]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const i = hIndex - 1;
      setHIndex(Math.max(-1, i));
      setCmd(i < 0 ? '' : history[i]);
    }
  }

  // Nombres que se pueden tocar: los conectados y los que aparecen entrando o saliendo.
  const known = useMemo(() => {
    const set = new Set(runtime?.players || []);
    for (const l of lines.slice(-600)) {
      const m = plain(l).match(/: ([A-Za-z0-9_.]{2,17}) (joined|left) the game/);
      if (m) set.add(m[1]);
    }
    return [...set].sort((a, b) => b.length - a.length);
  }, [lines, runtime?.players]);
  const nameRe = useMemo(() => (known.length ? new RegExp(`\\b(${known.map(escapeRe).join('|')})\\b`, 'g') : null), [known]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((l) => {
      const p = plain(l);
      if (filter === 'chat' && !isChat(p)) return false;
      if (filter === 'problems' && !isProblem(p)) return false;
      if (filter === 'cmd' && !p.startsWith('> ')) return false;
      return !q || p.toLowerCase().includes(q);
    });
  }, [lines, filter, search]);

  const renderText = (text, key) => {
    if (!nameRe) return text;
    const parts = text.split(nameRe);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <button
          key={`${key}-${i}`}
          type="button"
          className="player-link"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ name: part, x: r.left, y: r.bottom + 4 });
          }}
        >
          {part}
        </button>
      ) : (
        <Fragment key={`${key}-${i}`}>{part}</Fragment>
      )
    );
  };

  async function openGive(name) {
    setMenu(null);
    try {
      const { commands } = await api('/system/quick-commands');
      const cmd = commands.find((c) => /^give\s/.test(c.template) && c.params.some((p) => p.type === 'player'));
      if (cmd) setGiveFor({ cmd, player: name });
      else toast('No hay un comando rápido de "give". Agrégalo con Editar en Comandos rápidos.', 'error');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const stats = runtime?.stats;
  const memPct = stats ? Math.min(100, (stats.memoryMb / server.memoryMb) * 100) : 0;
  const players = runtime?.players || [];

  const crash = state === 'crashed' ? runtime?.lastCrash : null;

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      {crash && (
        <section className="panel" style={{ borderColor: 'rgba(224,80,63,0.5)' }}>
          <h2>El servidor se cerró con un error</h2>
          {crash.findings.length ? (
            <Findings findings={crash.findings} />
          ) : (
            <p className="muted small">
              No reconocimos la causa. Revisa las últimas líneas de la consola o el reporte en <Link to={`/servidor/${server.id}/logs`}>Logs</Link>.
            </p>
          )}
        </section>
      )}
    <div className="console-layout">
      <section className="terminal" aria-label="Consola del servidor">
        <div className="terminal-bar">
          <div className="terminal-filters" role="radiogroup" aria-label="Mostrar">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <input className="terminal-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…" aria-label="Buscar en la consola" />
        </div>
        <div
          className="terminal-out"
          ref={outRef}
          tabIndex={0}
          role="log"
          aria-label="Salida de la consola"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {lines.length === 0 && (
            <span className="faint">
              {server.installState === 'ready' ? 'La consola aparecerá aquí cuando enciendas el servidor.' : 'Esperando a que termine la instalación.'}
            </span>
          )}
          {lines.length > 0 && shown.length === 0 && <span className="faint">Ninguna línea coincide con el filtro.</span>}
          {shown.map((l, i) => (
            <div key={i} className={lineClass(plain(l))}>
              {parseConsole(l).map((seg, j) => (
                <span key={j} style={segStyle(seg)}>
                  {renderText(seg.text, `${i}-${j}`)}
                </span>
              ))}
            </div>
          ))}
        </div>
        <form
          className="terminal-in"
          onSubmit={(e) => {
            e.preventDefault();
            send(cmd);
          }}
        >
          <span aria-hidden="true">&gt;</span>
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={onKey}
            placeholder={running ? 'Escribe un comando (sin /) y presiona Enter' : 'Enciende el servidor para enviar comandos'}
            disabled={!running}
            aria-label="Comando"
            spellCheck={false}
            autoComplete="off"
          />
        </form>
      </section>

      <aside className="stack" style={{ alignContent: 'start' }}>
        <dl className="stat-list" style={{ margin: 0 }}>
          <div className="stat">
            <dt>Jugadores</dt>
            <dd>
              {state === 'running' ? `${players.length} en línea` : '—'}
              {players.length > 0 && (
                <span className="row" style={{ gap: '0.3rem', marginTop: '0.4rem' }}>
                  {players.map((p) => (
                    <span key={p} className="chip">
                      {p}
                    </span>
                  ))}
                </span>
              )}
            </dd>
          </div>
          <div className="stat">
            <dt>TPS</dt>
            <dd>{runtime?.tps != null ? `${runtime.tps}` : '—'}</dd>
          </div>
          <div className="stat">
            <dt>Memoria</dt>
            <dd>
              {stats ? `${(stats.memoryMb / 1024).toFixed(1)} / ${(server.memoryMb / 1024).toFixed(1)} GB` : '—'}
              <span className="meter" role="presentation">
                <i style={{ width: `${memPct}%` }} />
              </span>
            </dd>
          </div>
          <div className="stat">
            <dt>CPU</dt>
            <dd>{stats ? `${stats.cpu}%` : '—'}</dd>
          </div>
          <div className="stat">
            <dt>Tiempo encendido</dt>
            <dd>{runtime?.startedAt ? uptime(runtime.startedAt) : '—'}</dd>
          </div>
          <div className="stat">
            <dt>Dirección en tu casa</dt>
            <dd>
              {lanIp && (
                <span className="address">
                  <span>
                    {lanIp}:{server.port}
                  </span>
                  <CopyButton text={`${lanIp}:${server.port}`} />
                </span>
              )}
              {lanIp && server.bedrock?.enabled && (
                <span className="small muted stat-note">
                  Bedrock: {lanIp}, puerto {server.bedrock.port}
                </span>
              )}
              <span className="small muted stat-note">
                Para amigos fuera de tu red, revisa <Link to={`/servidor/${server.id}/conexion`}>Conexión</Link>.
              </span>
            </dd>
          </div>
        </dl>

        <QuickCommands server={server} running={state === 'running'} players={players} onSend={send} />
      </aside>
    </div>
      {menu && (
        <PlayerMenu
          menu={menu}
          running={state === 'running'}
          online={players.includes(menu.name)}
          onClose={() => setMenu(null)}
          onGive={() => openGive(menu.name)}
          onSend={(c) => {
            setMenu(null);
            send(c);
          }}
          onKick={() => {
            setKick(menu.name);
            setMenu(null);
          }}
        />
      )}
      {giveFor && <RunCommand server={server} cmd={giveFor.cmd} player={giveFor.player} players={players} onClose={() => setGiveFor(null)} onSend={send} />}
      {kick && (
        <Confirm
          title={`Expulsar a ${kick}`}
          message="Lo saca del servidor; puede volver a entrar. Para que no vuelva, usa la pestaña Jugadores (banear)."
          confirmLabel="Expulsar"
          danger
          onClose={() => setKick(null)}
          onConfirm={() => send(`kick ${kick}`)}
        />
      )}
    </div>
  );
}

const GAMEMODE_LABEL = { survival: 'Supervivencia', creative: 'Creativo', spectator: 'Espectador' };

/** Menú que aparece al tocar el nombre de un jugador en la consola. */
function PlayerMenu({ menu, running, online, onClose, onGive, onSend, onKick }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const esc = (e) => e.key === 'Escape' && onClose();
    // Solo se cierra si se mueve la página; la consola puede seguir escribiendo debajo.
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('scroll', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  const x = Math.min(menu.x, window.innerWidth - 230);
  const y = Math.min(menu.y, window.innerHeight - 300);
  const n = menu.name;
  return (
    <div ref={ref} className="player-menu" style={{ left: x, top: y }} role="menu" aria-label={`Acciones para ${n}`}>
      <div className="player-menu-head">
        <PlayerHead name={n} size={24} />
        <strong>{n}</strong>
        <span className="faint small">{online ? 'en línea' : 'desconectado'}</span>
      </div>
      <button type="button" role="menuitem" disabled={!running} onClick={onGive}>
        Dar objeto…
      </button>
      {Object.entries(GAMEMODE_LABEL).map(([mode, label]) => (
        <button key={mode} type="button" role="menuitem" disabled={!running || !online} onClick={() => onSend(`gamemode ${mode} ${n}`)}>
          Modo {label.toLowerCase()}
        </button>
      ))}
      <button type="button" role="menuitem" disabled={!running || !online} onClick={() => onSend(`effect give ${n} minecraft:instant_health 1 10`)}>
        Curar
      </button>
      <button type="button" role="menuitem" disabled={!running} onClick={() => onSend(`op ${n}`)}>
        Hacer operador
      </button>
      <button type="button" role="menuitem" disabled={!running} onClick={() => onSend(`deop ${n}`)}>
        Quitar operador
      </button>
      <button type="button" role="menuitem" className="danger" disabled={!running || !online} onClick={onKick}>
        Expulsar…
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          navigator.clipboard?.writeText(n).catch(() => {});
          onClose();
        }}
      >
        Copiar nombre
      </button>
    </div>
  );
}
