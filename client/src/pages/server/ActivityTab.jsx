import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatDate } from '../../api.js';
import { PlayerHead, useAction } from '../../ui.jsx';
import { ItemIcon, useGameList } from './gameData.jsx';
import InventoryEditor from './InventoryEditor.jsx';

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const METRICS = [
  { key: 'playTime', label: 'Tiempo jugado', fmt: (v) => duration(v) },
  { key: 'blocksMined', label: 'Bloques minados', fmt: (v) => num(v) },
  { key: 'distance', label: 'Distancia', fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${num(v)} m`) },
  { key: 'mobKills', label: 'Mobs derrotados', fmt: (v) => num(v) },
  { key: 'deaths', label: 'Muertes', fmt: (v) => num(v) },
  { key: 'crafted', label: 'Objetos fabricados', fmt: (v) => num(v) },
  { key: 'jumps', label: 'Saltos', fmt: (v) => num(v) },
  { key: 'playerKills', label: 'Jugadores derrotados', fmt: (v) => num(v) },
];

const num = (v) => Number(v || 0).toLocaleString('es-MX');
function duration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

const EVENT = {
  join: { label: (e) => `${e.player} entró`, cls: 'ev-join', icon: '→' },
  leave: { label: (e) => `${e.player} salió${e.detail ? ` (${e.detail})` : ''}`, cls: 'ev-leave', icon: '←' },
  start: { label: () => 'Servidor encendido', cls: 'ev-server', icon: '▶' },
  ready: { label: () => 'Servidor listo para jugar', cls: 'ev-server', icon: '✓' },
  stop: { label: () => 'Servidor apagado', cls: 'ev-server', icon: '■' },
  crash: { label: (e) => `El servidor se cayó${e.detail ? `: ${e.detail}` : ''}`, cls: 'ev-crash', icon: '✕' },
  backup: { label: (e) => `Respaldo${e.detail ? ` ${e.detail}` : ''}`, cls: 'ev-backup', icon: '⤓' },
  update: { label: (e) => `Actualizado${e.detail ? `: ${e.detail}` : ''}`, cls: 'ev-server', icon: '↑' },
};

export default function ActivityTab({ server, state }) {
  return (
    <div className="stack" style={{ gap: '1.5rem', maxWidth: 1000 }}>
      <Ranking server={server} running={['running', 'starting', 'stopping'].includes(state)} />
      <ActivityHistory server={server} />
    </div>
  );
}

// --- Ranking de jugadores -------------------------------------------------------------

function Ranking({ server, running }) {
  const [data, setData] = useState(null);
  const [metric, setMetric] = useState('playTime');
  const [selected, setSelected] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/servers/${server.id}/stats`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [server.id]);

  const m = METRICS.find((x) => x.key === metric);
  const sorted = useMemo(() => [...(data?.players || [])].sort((a, b) => (b[metric] || 0) - (a[metric] || 0)), [data, metric]);
  const max = Math.max(1, ...sorted.map((p) => p[metric] || 0));
  const player = data?.players.find((p) => p.uuid === selected);

  return (
    <section className="panel stack" style={{ gap: '0.9rem' }}>
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Ranking de jugadores
        </h2>
        {data && <span className="faint small">Mundo: {data.world}</span>}
      </div>
      {error && <div className="error-box">{error}</div>}
      {data && !data.players.length && <p className="muted small">Todavía no hay estadísticas. Minecraft las guarda cuando alguien juega y el mundo se guarda.</p>}
      {data && data.players.length > 0 && (
        <>
          <div className="chips" role="tablist" aria-label="Qué comparar">
            {METRICS.map((x) => (
              <button key={x.key} type="button" role="tab" aria-selected={metric === x.key} className={`chip-btn${metric === x.key ? ' on' : ''}`} onClick={() => setMetric(x.key)}>
                {x.label}
              </button>
            ))}
          </div>
          <ol className="rank-list">
            {sorted.map((p, i) => (
              <li key={p.uuid}>
                <button type="button" className={`rank-row${selected === p.uuid ? ' on' : ''}`} onClick={() => setSelected(selected === p.uuid ? null : p.uuid)}>
                  <span className="rank-pos">{i + 1}</span>
                  <PlayerHead uuid={p.uuid} name={p.name} size={24} className="rank-head" />
                  <span className="rank-name">
                    {p.name || p.uuid.slice(0, 8)}
                    {p.online && <span className="chip" style={{ marginLeft: '0.4rem' }}>En línea</span>}
                  </span>
                  <span className="rank-bar" aria-hidden="true">
                    <i style={{ width: `${((p[metric] || 0) / max) * 100}%` }} />
                  </span>
                  <span className="rank-value">{m.fmt(p[metric] || 0)}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      {player && <PlayerCard server={server} player={player} onInventory={() => setInventory(player)} />}
      {inventory && (
        <InventoryEditor
          serverId={server.id}
          version={server.mcVersion}
          path={inventory.playerdata}
          title={`Inventario de ${inventory.name || inventory.uuid}`}
          running={running}
          onClose={() => setInventory(null)}
        />
      )}
    </section>
  );
}

function PlayerCard({ server, player, onInventory }) {
  const { data: items } = useGameList(server.id, 'item');
  const { data: mobs } = useGameList(server.id, 'entity');
  const name = (list, id) => list?.list.find((x) => x.id === id)?.name || id.replace(/_/g, ' ');
  return (
    <div className="player-card">
      <div className="row" style={{ gap: '0.75rem' }}>
        <PlayerHead uuid={player.uuid} name={player.name} size={40} body />
        <div className="grow">
          <h3 style={{ margin: 0 }}>{player.name || player.uuid}</h3>
          <div className="muted small">
            {player.lastSeen ? (player.online ? 'Conectado ahora' : `Visto por última vez ${formatDate(new Date(player.lastSeen).toISOString())}`) : 'Sin registro de sesiones en el panel'}
            {player.sessions ? ` · ${player.sessions} ${player.sessions === 1 ? 'sesión' : 'sesiones'}` : ''}
          </div>
        </div>
        {player.playerdata && (
          <button className="btn-go" onClick={onInventory}>
            Ver inventario
          </button>
        )}
      </div>
      <dl className="player-stats">
        {METRICS.map((x) => (
          <div key={x.key}>
            <dt>{x.label}</dt>
            <dd>{x.fmt(player[x.key] || 0)}</dd>
          </div>
        ))}
      </dl>
      <div className="grid-2">
        {player.topMined.length > 0 && (
          <div>
            <h4 className="muted small" style={{ margin: '0 0 0.4rem' }}>
              Lo que más minó
            </h4>
            <ul className="top-list">
              {player.topMined.map((b) => (
                <li key={b.id}>
                  <ItemIcon version={server.mcVersion} id={b.id} />
                  <span className="grow">{name(items, b.id)}</span>
                  <span className="mono small">{num(b.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {player.topKilled.length > 0 && (
          <div>
            <h4 className="muted small" style={{ margin: '0 0 0.4rem' }}>
              Lo que más derrotó
            </h4>
            <ul className="top-list">
              {player.topKilled.map((b) => (
                <li key={b.id}>
                  <span className="grow">{name(mobs, b.id)}</span>
                  <span className="mono small">{num(b.value)}</span>
                </li>
              ))}
            </ul>
            {player.killedBy.length > 0 && (
              <p className="faint small" style={{ marginTop: '0.5rem' }}>
                Lo derrotaron más: {player.killedBy.map((k) => `${name(mobs, k.id)} (${k.value})`).join(', ')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Mapa de calor y línea de tiempo ------------------------------------------------------

function ActivityHistory({ server }) {
  const [data, setData] = useState(null);
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('all');
  const [hover, setHover] = useState(null);
  const [run, busy] = useAction();

  const load = useCallback(
    (before) =>
      api(`/servers/${server.id}/activity?filter=${filter}&limit=80${before ? `&before=${before}` : ''}`).then((r) => {
        setData(r);
        setEvents((prev) => (before ? [...prev, ...r.events] : r.events));
      }),
    [server.id, filter]
  );
  useEffect(() => {
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return null;
  const hm = data.heatmap;
  const level = (v) => (hm.max ? v / hm.max : 0);
  const groups = [];
  for (const e of events) {
    const raw = new Date(e.t).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
    const day = raw.charAt(0).toUpperCase() + raw.slice(1);
    if (!groups.length || groups.at(-1).day !== day) groups.push({ day, items: [] });
    groups.at(-1).items.push(e);
  }
  const h = hover && { day: DAYS[hover[0]], hour: hover[1], v: hm.grid[hover[0]][hover[1]] };

  return (
    <>
      <section className="panel stack" style={{ gap: '0.9rem' }}>
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            Cuándo se juega
          </h2>
          <span className="faint small">
            Últimos {hm.days} días · {hm.uniquePlayers} {hm.uniquePlayers === 1 ? 'jugador' : 'jugadores'} · {hm.playerHours} horas jugadas
          </span>
        </div>
        {hm.max === 0 ? (
          <p className="muted small">Aún no hay suficientes datos. El panel empieza a contar desde ahora; vuelve en unos días.</p>
        ) : (
          <>
            <div className="heatmap" role="grid" aria-label="Promedio de jugadores conectados por día y hora" onMouseLeave={() => setHover(null)}>
              <span />
              {Array.from({ length: 24 }, (_, hh) => (
                <span key={hh} className="hm-hour">
                  {hh % 3 === 0 ? hh : ''}
                </span>
              ))}
              {hm.grid.map((row, d) => (
                <div key={d} className="hm-row" role="row">
                  <span className="hm-day">{DAYS[d].slice(0, 3)}</span>
                  {row.map((v, hh) => (
                    <span
                      key={hh}
                      role="gridcell"
                      className={`hm-cell${hover && hover[0] === d && hover[1] === hh ? ' on' : ''}`}
                      style={v ? { background: `rgba(79, 179, 169, ${0.15 + 0.85 * level(v)})` } : undefined}
                      aria-label={`${DAYS[d]} ${hh}:00, ${v} jugadores en promedio`}
                      onMouseEnter={() => setHover([d, hh])}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="row small" style={{ gap: '0.75rem' }}>
              <span className="muted grow" aria-live="polite">
                {h ? `${h.day} de ${h.hour}:00 a ${h.hour + 1}:00 → ${h.v} ${h.v === 1 ? 'jugador' : 'jugadores'} en promedio` : 'Pasa el mouse por una casilla para ver el promedio.'}
              </span>
              <span className="faint">0</span>
              <span className="hm-legend" aria-hidden="true" />
              <span className="faint">{hm.max}</span>
            </div>
            <p className="faint small" style={{ margin: 0 }}>
              Útil para programar reinicios y respaldos cuando no hay nadie (pestaña Tareas). Hora de esta PC.
            </p>
          </>
        )}
      </section>

      <section className="panel stack" style={{ gap: '0.9rem' }}>
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            Línea de tiempo
          </h2>
          <div className="segmented" role="radiogroup" aria-label="Filtrar">
            {[
              ['all', 'Todo'],
              ['players', 'Jugadores'],
              ['server', 'Servidor'],
            ].map(([k, l]) => (
              <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {!events.length && <p className="muted small">Sin eventos todavía.</p>}
        <div className="timeline">
          {groups.map((g) => (
            <div key={g.day}>
              <h4 className="tl-day">{g.day}</h4>
              <ul>
                {g.items.map((e, i) => {
                  const def = EVENT[e.type] || { label: () => e.type, cls: '', icon: '·' };
                  return (
                    <li key={`${e.t}-${i}`} className={def.cls}>
                      <span className="tl-time mono">{new Date(e.t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="tl-icon" aria-hidden="true">
                        {def.icon}
                      </span>
                      {e.player && <PlayerHead name={e.player} size={16} />}
                      <span>{def.label(e)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        {data.more && (
          <button className="btn-ghost btn-sm" style={{ width: 'max-content' }} disabled={busy} onClick={() => run(() => load(events.at(-1)?.t))}>
            Ver más antiguos
          </button>
        )}
      </section>
    </>
  );
}
