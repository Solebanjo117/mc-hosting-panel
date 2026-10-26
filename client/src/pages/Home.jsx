import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, TYPE_LABEL } from '../api.js';
import { useLive, serverState } from '../live.jsx';
import { Electric, ELECTRIC_STATES, PlayerHead, Status, useAction, usePageTitle } from '../ui.jsx';

const HEALTH = {
  ok: { label: 'Todo bien', cls: 'ok' },
  info: { label: 'Todo bien', cls: 'ok' },
  warn: { label: 'Revisar', cls: 'warn' },
  bad: { label: 'Problema', cls: 'bad' },
};

export default function Home() {
  const { servers, runtime, loaded } = useLive();
  const [info, setInfo] = useState(null);
  const [dash, setDash] = useState({});
  usePageTitle('Tus servidores');

  useEffect(() => {
    api('/system/info').then(setInfo).catch(() => {});
    const load = () =>
      api('/system/dashboard')
        .then((d) => setDash(Object.fromEntries(d.servers.map((s) => [s.id, s]))))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const online = servers.filter((s) => runtime[s.id]?.status === 'running');
  const players = online.reduce((n, s) => n + (runtime[s.id]?.players?.length || 0), 0);
  const reservedMb = online.reduce((n, s) => n + Number(s.memoryMb || 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Tus servidores</h1>
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

      {servers.length > 0 && (
        <dl className="summary" aria-label="Resumen">
          <div>
            <dt>Encendidos</dt>
            <dd>
              {online.length} de {servers.length}
            </dd>
          </div>
          <div>
            <dt>Jugando ahora</dt>
            <dd>{players}</dd>
          </div>
          {info && (
            <div className="summary-ram">
              <dt>RAM reservada</dt>
              <dd>
                {(reservedMb / 1024).toFixed(1).replace('.0', '')} de {Math.round(info.system.totalMemMb / 1024)} GB
                <span className="meter" role="presentation">
                  <i style={{ width: `${Math.min(100, (reservedMb / info.system.totalMemMb) * 100)}%` }} />
                </span>
              </dd>
            </div>
          )}
          {info && (
            <div className="summary-pc">
              <dt>Esta PC</dt>
              <dd title={info.system.cpuModel}>{info.system.cores} núcleos</dd>
            </div>
          )}
        </dl>
      )}

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
        <ul className="rack" aria-label="Servidores">
          {servers.map((s) => (
            <ServerCard key={s.id} server={s} rt={runtime[s.id]} dash={dash[s.id]} />
          ))}
        </ul>
      )}

      <div className="note" style={{ marginTop: '2rem', maxWidth: '75ch' }}>
        Para que tus amigos entren desde fuera de tu casa abre el puerto en tu router o crea un túnel de playit.gg en la pestaña Conexión.{' '}
        <Link to="/guia">Ver la guía paso a paso</Link>.
      </div>
    </div>
  );
}

export function ServerIcon({ server, size = 48 }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [server.iconAt]);
  if (failed) {
    return (
      <span className="server-icon placeholder" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden="true">
        {server.name.trim()[0]?.toUpperCase() || '?'}
      </span>
    );
  }
  return (
    <img
      className="server-icon"
      src={`/api/servers/${server.id}/icon?v=${server.iconAt || 0}`}
      width={size}
      height={size}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function ServerCard({ server, rt, dash }) {
  const state = serverState(server, rt);
  const on = ['starting', 'running', 'stopping'].includes(state);
  const players = rt?.players || [];
  const [run, busy] = useAction();
  const h = dash?.health && HEALTH[dash.health.level];
  const issues = dash?.health ? dash.health.counts.bad + dash.health.counts.warn : 0;
  const base = `/servidor/${server.id}`;
  const memPct = dash?.spark?.mem?.map((v) => (v == null || !dash.spark.memoryLimitMb ? null : Math.round((v / dash.spark.memoryLimitMb) * 100)));

  return (
    <li className={`rack-slot${on ? ' is-on' : ''}`}>
      {ELECTRIC_STATES.has(state) && <Electric state={state} />}
      <div className="rack-id">
        <ServerIcon server={server} size={48} />
        <div style={{ minWidth: 0 }}>
          <Link to={base} className="rack-name nameplate">
            {server.name}
          </Link>
          <div className="rack-meta">
            {state === 'running' ? <span className="sr-only">Encendido</span> : <Status state={state} />}
            <span className="muted small">
              {TYPE_LABEL[server.type]} {server.mcVersion}, puerto {server.port}
            </span>
          </div>
        </div>
      </div>

      <div className="rack-players">
        {state === 'running' ? (
          players.length ? (
            <>
              <div className="heads">
                {players.slice(0, 6).map((p) => (
                  <PlayerHead key={p} name={p} size={28} title={p} />
                ))}
                {players.length > 6 && <span className="heads-more">+{players.length - 6}</span>}
              </div>
              <span className="small">
                {players.length} jugando
              </span>
            </>
          ) : (
            <span className="small faint">Nadie conectado</span>
          )
        ) : (
          on && <span className="small faint">Arrancando…</span>
        )}
      </div>

      <div className="sparks">
        <Spark label="Jugadores" values={dash?.spark?.players} format={(v) => `${v}`} color="var(--prismarine)" min={0} />
        <Spark label="RAM" values={memPct} format={(v) => `${v}%`} color="var(--lapis)" min={0} max={100} />
        <Spark label="TPS" values={dash?.spark?.tps} format={(v) => `${v}`} color="var(--lamp)" min={0} max={20} />
      </div>

      <div className="rack-actions">
        {h ? (
          <Link to={`${base}/seguridad`} className={`health-chip ${h.cls}`} title={dash.health.top.map((c) => c.title).join('\n')}>
            <i aria-hidden="true" />
            {issues ? `${issues} ${issues === 1 ? 'aviso' : 'avisos'}` : h.label}
          </Link>
        ) : (
          <span />
        )}
        <div className="row" style={{ gap: '0.4rem' }}>
          {server.installState === 'ready' &&
            (on ? (
              <button className="btn-sm" disabled={busy || state === 'stopping'} onClick={() => run(() => api(`/servers/${server.id}/stop`, { method: 'POST' }))}>
                Apagar
              </button>
            ) : (
              <button className="btn-sm btn-go" disabled={busy} onClick={() => run(() => api(`/servers/${server.id}/start`, { method: 'POST' }))}>
                Encender
              </button>
            ))}
          <Link to={base} className="btn btn-sm">
            Abrir
          </Link>
        </div>
      </div>
    </li>
  );
}

/** Mini gráfica de la última hora con lectura al pasar el mouse. */
function Spark({ label, values, format, color, min = 0, max }) {
  const [hover, setHover] = useState(null);
  const list = values || [];
  const nums = list.filter((v) => v != null);
  const last = [...list].reverse().find((v) => v != null);
  const hi = max ?? Math.max(1, ...nums);
  const lo = min;
  const W = 120;
  const H = 32;
  const x = (i) => (list.length > 1 ? (i / (list.length - 1)) * W : 0);
  const y = (v) => H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4);
  // Los huecos (servidor apagado) cortan la línea.
  let d = '';
  list.forEach((v, i) => {
    if (v == null) return;
    d += `${i === 0 || list[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  const shown = hover != null && list[hover] != null ? list[hover] : last;
  const minutesAgo = hover != null && list.length ? Math.round(((list.length - 1 - hover) / (list.length - 1 || 1)) * 60) : null;

  return (
    <div className="spark">
      <div className="spark-head">
        <span className="faint small">{label}</span>
        <span className="small">
          {shown != null ? format(shown) : '—'}
          {minutesAgo ? <span className="faint">, hace {minutesAgo} min</span> : null}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} en la última hora${last != null ? `: ahora ${format(last)}` : ''}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (list.length - 1)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1="0" x2={W} y1={H - 2} y2={H - 2} className="spark-base" />
        {d ? <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /> : null}
        {hover != null && list[hover] != null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} className="spark-cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}
