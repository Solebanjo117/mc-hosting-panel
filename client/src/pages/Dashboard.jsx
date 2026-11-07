import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatBytes, formatDate, uptime, STATUS_LABEL, TYPE_LABEL } from '../api.js';
import { LineChart, RANGES, SERIES_COLORS, OTHER_COLOR } from '../charts.jsx';
import { Status, usePageTitle } from '../ui.jsx';

const MAX_SERIES = SERIES_COLORS.length;
const gb = (mb) => (mb == null ? null : Math.round((mb / 1024) * 100) / 100);
const fmtGb = (v) => `${v.toFixed(v < 10 ? 2 : 1)} GB`;
const fmtPct = (v) => `${Math.round(v * 10) / 10}%`;

function ago(iso) {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

/**
 * Rendimiento general: la PC y todos los servidores sobre la misma línea de tiempo.
 * Cada servidor tiene un color fijo (por orden de creación); a partir del octavo se agrupan en "Otros".
 */
export default function Dashboard() {
  usePageTitle('Rendimiento general');
  const [range, setRange] = useState('6h');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [hover, setHover] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api(`/system/metrics?range=${range}`)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch((err) => alive && setError(err.message));
    load();
    timer.current = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer.current);
    };
  }, [range]);

  // Series por servidor con color fijo; los que sobran se juntan en "Otros" (línea punteada).
  const { series, memPoints, cpuPoints, tpsPoints } = useMemo(() => {
    if (!data) return { series: [], memPoints: [], cpuPoints: [], tpsPoints: [] };
    const named = data.servers.slice(0, MAX_SERIES).map((s, i) => ({ key: s.id, label: s.name, color: SERIES_COLORS[i] }));
    const rest = data.servers.slice(MAX_SERIES);
    const series = rest.length ? [...named, { key: '_otros', label: `Otros (${rest.length})`, color: OTHER_COLOR, dashed: true }] : named;
    const merge = (field, transform, fold) =>
      data.host.points.map((hp, i) => {
        const point = { t: hp.t };
        for (const s of data.servers.slice(0, MAX_SERIES)) {
          const v = s.points[i]?.[field];
          point[s.id] = v == null ? null : transform(v);
        }
        if (rest.length) {
          const vals = rest.map((s) => s.points[i]?.[field]).filter((v) => v != null);
          point._otros = vals.length ? transform(fold(vals)) : null;
        }
        return point;
      });
    const sum = (vals) => vals.reduce((a, b) => a + b, 0);
    return {
      series,
      memPoints: merge('mem', gb, sum),
      cpuPoints: merge('cpu', (v) => v, sum),
      tpsPoints: merge(
        'tps',
        (v) => v,
        (vals) => Math.min(...vals)
      ),
    };
  }, [data]);

  const hostPoints = useMemo(() => (data ? data.host.points.map((p) => ({ ...p, memGb: gb(p.mem), diskGb: gb(p.disk) })) : []), [data]);
  const totals = data?.totals || [];
  const now = data?.now;
  const host = now?.host;
  const when = hover != null && hostPoints[hover] ? new Date(hostPoints[hover].t).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const biggestLimit = data ? Math.max(1, ...data.servers.map((s) => gb(s.memoryLimitMb) || 0)) : 1;
  const tpsNote =
    data && data.servers.length && data.servers.every((s) => !s.tpsAvailable)
      ? 'Ninguno de tus servidores permite medir el TPS (hace falta Paper o Minecraft 1.20.3 en adelante).'
      : 'Sin datos en este periodo.';

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Rendimiento general</h1>
          <p className="muted" style={{ margin: '0.2rem 0 0' }}>
            La PC y todos los servidores en la misma línea de tiempo. El detalle de cada uno está en su pestaña Rendimiento.
          </p>
        </div>
      </div>

      {error && <p className="note">No se pudo cargar: {error}</p>}

      {now && (
        <dl className="summary" aria-label="Ahora mismo">
          <div>
            <dt>Encendidos</dt>
            <dd>
              {now.totals.running} de {now.totals.servers}
            </dd>
          </div>
          <div>
            <dt>Jugando ahora</dt>
            <dd>{now.totals.players}</dd>
          </div>
          <div className="summary-ram">
            <dt>RAM de los servidores</dt>
            <dd title={`Reservada: ${fmtGb(gb(now.totals.reservedMb) || 0)}`}>
              {fmtGb(gb(now.totals.memMb) || 0)} de {Math.round(host.totalMemMb / 1024)} GB
              <span className="meter" role="presentation">
                <i style={{ width: `${Math.min(100, (now.totals.memMb / host.totalMemMb) * 100)}%` }} />
              </span>
            </dd>
          </div>
          <div>
            <dt>CPU de la PC</dt>
            <dd title={`${host.cores} núcleos`}>{host.cpu != null ? fmtPct(host.cpu) : '—'}</dd>
          </div>
          {host.diskTotalMb != null && (
            <div className="summary-ram">
              <dt>Disco libre</dt>
              <dd>
                {Math.round(host.diskFreeMb / 1024)} de {Math.round(host.diskTotalMb / 1024)} GB
                <span className="meter" role="presentation">
                  <i style={{ width: `${Math.min(100, (1 - host.diskFreeMb / host.diskTotalMb) * 100)}%` }} />
                </span>
              </dd>
            </div>
          )}
          <div>
            <dt>Caídas (24 h)</dt>
            <dd>{now.totals.crashes24h ? <span className="trend">{now.totals.crashes24h}</span> : 0}</dd>
          </div>
          <div>
            <dt>Último respaldo</dt>
            <dd title={now.totals.lastBackupAt ? formatDate(now.totals.lastBackupAt) : ''}>{ago(now.totals.lastBackupAt)}</dd>
          </div>
        </dl>
      )}

      <div className="row" style={{ marginBottom: '1rem' }}>
        <div className="segmented" role="radiogroup" aria-label="Periodo">
          {RANGES.map(([id, label]) => (
            <button key={id} className={range === id ? 'on' : ''} role="radio" aria-checked={range === id} onClick={() => setRange(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted small grow">{when ? `Mostrando ${when}` : 'Pasa el cursor sobre una gráfica para ver el mismo momento en todas.'}</span>
        <button className="btn-sm btn-ghost" onClick={() => setShowTable(!showTable)}>
          {showTable ? 'Ver gráficas' : 'Ver como tabla'}
        </button>
      </div>

      {data && data.servers.length === 0 && (
        <p className="note">
          Todavía no hay servidores. <Link to="/nuevo">Crea el primero</Link> y aquí verás cómo se reparten la memoria y la CPU.
        </p>
      )}

      {showTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Jugadores</th>
                <th>RAM servidores</th>
                <th>CPU servidores</th>
                <th>Peor TPS</th>
                <th>CPU de la PC</th>
                <th>RAM de la PC</th>
              </tr>
            </thead>
            <tbody>
              {[...totals]
                .map((p, i) => ({ ...p, host: hostPoints[i] }))
                .reverse()
                .filter((p) => p.players != null || p.host?.cpu != null)
                .map((p) => (
                  <tr key={p.t}>
                    <td>{new Date(p.t).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="tabular">{p.players ?? '—'}</td>
                    <td className="tabular">{p.mem != null ? fmtGb(gb(p.mem)) : '—'}</td>
                    <td className="tabular">{p.cpu != null ? fmtPct(p.cpu) : '—'}</td>
                    <td className="tabular">{p.tpsMin ?? '—'}</td>
                    <td className="tabular">{p.host?.cpu != null ? fmtPct(p.host.cpu) : '—'}</td>
                    <td className="tabular">{p.host?.memGb != null ? fmtGb(p.host.memGb) : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        data && (
          <div className="charts">
            <LineChart
              title="Jugadores en total"
              points={totals}
              valueKey="players"
              max={4}
              format={(v) => `${v} ${v === 1 ? 'jugador' : 'jugadores'}`}
              range={range}
              hoverIndex={hover}
              onHover={setHover}
              emptyText="Sin datos en este periodo."
            />
            <LineChart
              title="TPS por servidor (20 es perfecto)"
              points={tpsPoints}
              series={series}
              max={20}
              refLine={18}
              format={(v) => `${v} TPS`}
              range={range}
              hoverIndex={hover}
              onHover={setHover}
              emptyText={tpsNote}
            />
            <LineChart
              title={`Memoria por servidor (límite más alto: ${Math.round(biggestLimit * 10) / 10} GB)`}
              points={memPoints}
              series={series}
              max={biggestLimit}
              unit=" GB"
              format={fmtGb}
              range={range}
              hoverIndex={hover}
              onHover={setHover}
              emptyText="Sin datos en este periodo."
            />
            <LineChart
              title="CPU por servidor"
              points={cpuPoints}
              series={series}
              max={100}
              unit="%"
              format={fmtPct}
              range={range}
              hoverIndex={hover}
              onHover={setHover}
              emptyText="Sin datos en este periodo."
            />
            <LineChart
              title={`RAM de la PC (${Math.round(data.host.totalMemMb / 1024)} GB en total)`}
              points={hostPoints}
              valueKey="memGb"
              max={gb(data.host.totalMemMb)}
              refLine={gb(data.host.totalMemMb)}
              unit=" GB"
              format={fmtGb}
              range={range}
              hoverIndex={hover}
              onHover={setHover}
              emptyText="La PC se mide cada 30 s mientras el panel está abierto."
            />
            <LineChart
              title={`CPU de la PC (${data.host.cores} núcleos)`}
              points={hostPoints}
              valueKey="cpu"
              max={100}
              unit="%"
              format={fmtPct}
              range={range}
              hoverIndex={hover}
              onHover={setHover}
              emptyText="La PC se mide cada 30 s mientras el panel está abierto."
            />
          </div>
        )
      )}

      {now && now.servers.length > 0 && (
        <section style={{ marginTop: '1.5rem' }} aria-labelledby="overview-table-title">
          <h2 id="overview-table-title">Servidor por servidor</h2>
          <div className="table-wrap">
            <table className="table overview-table">
              <thead>
                <tr>
                  <th>Servidor</th>
                  <th>Estado</th>
                  <th>Jugadores</th>
                  <th>RAM</th>
                  <th>CPU</th>
                  <th>TPS</th>
                  <th>Encendido</th>
                  <th>Caídas 24 h</th>
                  <th>Último respaldo</th>
                  <th>Mundo en disco</th>
                </tr>
              </thead>
              <tbody>
                {now.servers.map((s, i) => (
                  <tr key={s.id}>
                    <td className="name">
                      <span className="row" style={{ gap: '0.5rem' }}>
                        {i < MAX_SERIES && <i className="swatch-line" style={{ color: SERIES_COLORS[i] }} aria-hidden="true" />}
                        <Link to={`/servidor/${s.id}/rendimiento`}>{s.name}</Link>
                        <span className="faint small">
                          {TYPE_LABEL[s.type]} {s.mcVersion}
                        </span>
                      </span>
                    </td>
                    <td>
                      <Status state={s.status} />
                      <span className="sr-only">{STATUS_LABEL[s.status] || s.status}</span>
                    </td>
                    <td className="tabular">{s.status === 'running' ? s.players : '—'}</td>
                    <td className="tabular">{s.memMb != null ? `${fmtGb(gb(s.memMb))} / ${s.memoryLimitMb ? Math.round(s.memoryLimitMb / 1024) : '?'} GB` : '—'}</td>
                    <td className="tabular">{s.cpu != null ? fmtPct(s.cpu) : '—'}</td>
                    <td className="tabular">{s.tps ?? '—'}</td>
                    <td className="tabular">{s.status === 'running' ? uptime(s.startedAt) : '—'}</td>
                    <td className="tabular">{s.crashes24h ? <span className="trend">{s.crashes24h}</span> : 0}</td>
                    <td title={s.lastBackupAt ? formatDate(s.lastBackupAt) : ''}>{ago(s.lastBackupAt)}</td>
                    <td className="tabular">{s.worldBytes != null ? formatBytes(s.worldBytes) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint small overview-note">
            Los colores de la primera columna son los de las gráficas. Si el TPS baja de 18 los jugadores notan lag; si la RAM de los servidores se acerca a la de la PC, baja la memoria de alguno o
            apaga los que no se usen. El historial se guarda 7 días.
          </p>
        </section>
      )}
    </div>
  );
}
