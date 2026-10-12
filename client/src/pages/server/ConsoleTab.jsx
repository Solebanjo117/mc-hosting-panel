import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, uptime } from '../../api.js';
import { useLive } from '../../live.jsx';
import { CopyButton, useToast } from '../../ui.jsx';
import { Findings } from './LogsTab.jsx';

// Quita códigos de color ANSI y de Minecraft (§a, §l…).
const clean = (line) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/§[0-9a-fk-or]/gi, '');

function lineClass(line) {
  if (line.startsWith('> ')) return 'l-cmd';
  if (/\[Panel\]/.test(line)) return 'l-panel';
  if (/(ERROR|FATAL|Exception|SEVERE)/.test(line)) return 'l-error';
  if (/WARN/.test(line)) return 'l-warn';
  if (/joined the game|left the game/.test(line)) return 'l-join';
  return '';
}

const QUICK = [
  { label: 'Guardar mundo', cmd: 'save-all' },
  { label: 'Hacer de día', cmd: 'time set day' },
  { label: 'Quitar lluvia', cmd: 'weather clear' },
  { label: 'Lista de jugadores', cmd: 'list' },
];

export default function ConsoleTab({ server, runtime, state }) {
  const { subscribeConsole } = useLive();
  const toast = useToast();
  const [lines, setLines] = useState([]);
  const [cmd, setCmd] = useState('');
  const [history, setHistory] = useState([]);
  const [hIndex, setHIndex] = useState(-1);
  const [lanIp, setLanIp] = useState(null);
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
        <div
          className="terminal-out"
          ref={outRef}
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
          {lines.map((l, i) => (
            <div key={i} className={lineClass(l)}>
              {clean(l)}
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
            <dd>{state === 'running' ? `${players.length} en línea` : '—'}</dd>
            {players.length > 0 && (
              <div className="row" style={{ gap: '0.3rem', marginTop: '0.4rem' }}>
                {players.map((p) => (
                  <span key={p} className="chip">
                    {p}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="stat">
            <dt>TPS</dt>
            <dd>{runtime?.tps != null ? `${runtime.tps}` : '—'}</dd>
          </div>
          <div className="stat">
            <dt>Memoria</dt>
            <dd>{stats ? `${(stats.memoryMb / 1024).toFixed(1)} / ${(server.memoryMb / 1024).toFixed(1)} GB` : '—'}</dd>
            <div className="meter">
              <i style={{ width: `${memPct}%` }} />
            </div>
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
            {lanIp && (
              <div className="address">
                <span>
                  {lanIp}:{server.port}
                </span>
                <CopyButton text={`${lanIp}:${server.port}`} />
              </div>
            )}
            {lanIp && server.bedrock?.enabled && (
              <p className="small muted" style={{ marginTop: '0.4rem' }}>
                Bedrock: {lanIp}, puerto {server.bedrock.port}
              </p>
            )}
            <p className="small muted" style={{ marginTop: '0.4rem' }}>
              Para amigos fuera de tu red, revisa <Link to={`/servidor/${server.id}/conexion`}>Conexión</Link>.
            </p>
          </div>
        </dl>

        <div className="stack" style={{ gap: '0.4rem' }}>
          <h3 className="muted" style={{ fontWeight: 500 }}>
            Comandos rápidos
          </h3>
          <div className="row" style={{ gap: '0.4rem' }}>
            {QUICK.map((q) => (
              <button key={q.cmd} className="btn-sm" disabled={state !== 'running'} onClick={() => send(q.cmd)}>
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
    </div>
  );
}
