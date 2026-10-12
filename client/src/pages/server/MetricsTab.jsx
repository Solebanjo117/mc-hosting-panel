import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';

const RANGES = [
  ['1h', '1 hora'],
  ['6h', '6 horas'],
  ['24h', '24 horas'],
  ['7d', '7 días'],
];

const W = 760;
const H = 150;
const PAD = { top: 12, right: 12, bottom: 22, left: 44 };

function timeLabel(t, range) {
  const d = new Date(t);
  if (range === '7d') return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' });
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Una gráfica de línea para una sola medida. Las cuatro gráficas comparten la línea
 * vertical del cursor (hoverIndex) para comparar el mismo momento en todas.
 */
function LineChart({ title, points, valueKey, max, unit, format, range, hoverIndex, onHover, emptyText, refLine }) {
  const values = points.map((p) => p[valueKey]);
  const hasData = values.some((v) => v != null);
  const top = Math.max(max ?? 0, ...values.filter((v) => v != null), 1);
  const x = (i) => PAD.left + (i / Math.max(1, points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);

  // Segmentos separados donde el servidor estuvo apagado (sin datos).
  const segments = [];
  let current = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push([x(i), y(v)]);
  });
  if (current.length) segments.push(current);

  const ticks = [0, top / 2, top];
  const xTicks = [0, Math.floor(points.length / 2), points.length - 1];
  const hv = hoverIndex != null ? values[hoverIndex] : null;
  const last = [...values].reverse().find((v) => v != null);

  return (
    <figure className="chart">
      <figcaption className="row">
        <h3 className="grow">{title}</h3>
        <span className="chart-value">{hoverIndex != null ? (hv != null ? format(hv) : 'apagado') : last != null ? format(last) : '—'}</span>
      </figcaption>
      {!hasData ? (
        <p className="faint small chart-empty">{emptyText}</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}: último valor ${last != null ? format(last) : 'sin datos'}`}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1));
            onHover(Math.min(points.length - 1, Math.max(0, i)));
          }}
          onPointerLeave={() => onHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">
                {Math.round(t * 10) / 10}
                {unit}
              </text>
            </g>
          ))}
          {xTicks.map((i, k) => (
            <text key={k} x={x(i)} y={H - 4} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'} className="chart-axis">
              {points[i] ? timeLabel(points[i].t, range) : ''}
            </text>
          ))}
          {refLine != null && <line x1={PAD.left} x2={W - PAD.right} y1={y(refLine)} y2={y(refLine)} className="chart-ref" />}
          {segments.map((seg, i) => (
            <g key={i}>
              <path
                className="chart-area"
                d={`M${seg[0][0]},${y(0)} ${seg.map(([a, b]) => `L${a},${b}`).join(' ')} L${seg.at(-1)[0]},${y(0)} Z`}
              />
              {seg.length > 1 ? (
                <path className="chart-line" d={seg.map(([a, b], j) => `${j ? 'L' : 'M'}${a},${b}`).join(' ')} />
              ) : (
                <circle className="chart-dot" cx={seg[0][0]} cy={seg[0][1]} r={3} />
              )}
            </g>
          ))}
          {hoverIndex != null && (
            <g>
              <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={PAD.top} y2={H - PAD.bottom} className="chart-cursor" />
              {hv != null && <circle className="chart-dot" cx={x(hoverIndex)} cy={y(hv)} r={4} />}
            </g>
          )}
        </svg>
      )}
    </figure>
  );
}

export default function MetricsTab({ server, runtime }) {
  const [range, setRange] = useState('6h');
  const [data, setData] = useState(null);
  const [hover, setHover] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api(`/servers/${server.id}/metrics?range=${range}`)
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    timer.current = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer.current);
    };
  }, [server.id, range]);

  const points = data?.points || [];
  const memLimitGb = (data?.memoryLimitMb || server.memoryMb) / 1024;
  const memPoints = useMemo(() => points.map((p) => ({ ...p, memGb: p.mem != null ? Math.round((p.mem / 1024) * 100) / 100 : null })), [points]);
  const when = hover != null && points[hover] ? new Date(points[hover].t).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const tpsNote = data && !data.tpsAvailable ? 'Esta versión no permite medir el TPS (solo Paper o Minecraft 1.20.3 en adelante).' : 'El TPS se mide cada minuto mientras el servidor está encendido.';

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="row">
        <div className="segmented" role="radiogroup" aria-label="Periodo">
          {RANGES.map(([id, label]) => (
            <button key={id} className={range === id ? 'on' : ''} role="radio" aria-checked={range === id} onClick={() => setRange(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted small grow">{when ? `Mostrando ${when}` : 'Pasa el cursor sobre una gráfica para ver un momento exacto.'}</span>
        <button className="btn-sm btn-ghost" onClick={() => setShowTable(!showTable)}>
          {showTable ? 'Ver gráficas' : 'Ver como tabla'}
        </button>
      </div>

      {runtime?.status !== 'running' && <p className="note">El servidor está apagado. Las gráficas guardan datos solo mientras está encendido.</p>}

      {showTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>CPU</th>
                <th>RAM</th>
                <th>TPS</th>
                <th>Jugadores</th>
              </tr>
            </thead>
            <tbody>
              {[...memPoints]
                .reverse()
                .filter((p) => p.cpu != null || p.memGb != null)
                .map((p) => (
                  <tr key={p.t}>
                    <td>{new Date(p.t).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="tabular">{p.cpu != null ? `${p.cpu}%` : '—'}</td>
                    <td className="tabular">{p.memGb != null ? `${p.memGb} GB` : '—'}</td>
                    <td className="tabular">{p.tps ?? '—'}</td>
                    <td className="tabular">{p.players ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="charts">
          <LineChart
            title="TPS (20 es perfecto)"
            points={points}
            valueKey="tps"
            max={20}
            unit=""
            format={(v) => `${v} TPS`}
            range={range}
            hoverIndex={hover}
            onHover={setHover}
            emptyText={tpsNote}
          />
          <LineChart
            title="Jugadores"
            points={points}
            valueKey="players"
            max={4}
            unit=""
            format={(v) => `${v} ${v === 1 ? 'jugador' : 'jugadores'}`}
            range={range}
            hoverIndex={hover}
            onHover={setHover}
            emptyText="Sin datos en este periodo."
          />
          <LineChart
            title={`Memoria (límite ${memLimitGb.toFixed(1)} GB)`}
            points={memPoints}
            valueKey="memGb"
            max={memLimitGb}
            refLine={memLimitGb}
            unit=" GB"
            format={(v) => `${v.toFixed(2)} GB`}
            range={range}
            hoverIndex={hover}
            onHover={setHover}
            emptyText="Sin datos en este periodo."
          />
          <LineChart
            title="CPU"
            points={points}
            valueKey="cpu"
            max={100}
            unit="%"
            format={(v) => `${v}%`}
            range={range}
            hoverIndex={hover}
            onHover={setHover}
            emptyText="Sin datos en este periodo."
          />
        </div>
      )}
      <p className="faint small">
        {tpsNote} Si el TPS baja de 18 los jugadores notan lag; si la memoria toca el límite seguido, súbela en Ajustes. El historial se guarda 7 días.
      </p>
    </div>
  );
}
