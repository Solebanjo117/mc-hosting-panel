import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { LineChart, RANGES } from '../../charts.jsx';

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
          <LineChart title="TPS (20 es perfecto)" points={points} valueKey="tps" max={20} unit="" format={(v) => `${v} TPS`} range={range} hoverIndex={hover} onHover={setHover} emptyText={tpsNote} />
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
          <LineChart title="CPU" points={points} valueKey="cpu" max={100} unit="%" format={(v) => `${v}%`} range={range} hoverIndex={hover} onHover={setHover} emptyText="Sin datos en este periodo." />
        </div>
      )}
      <p className="faint small">{tpsNote} Si el TPS baja de 18 los jugadores notan lag; si la memoria toca el límite seguido, súbela en Ajustes. El historial se guarda 7 días.</p>
    </div>
  );
}
