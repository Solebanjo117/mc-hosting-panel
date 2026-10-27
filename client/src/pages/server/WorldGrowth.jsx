import { useEffect, useState } from 'react';
import { api, formatBytes } from '../../api.js';

/** Cómo creció el mundo: tamaño y regiones por día, en una gráfica pequeña. */
export default function WorldGrowth({ server }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/servers/${server.id}/world-growth`).then(setData).catch(() => {});
  }, [server.id]);
  if (!data?.summary) return null;
  const pts = data.points;
  const W = 600;
  const H = 120;
  const max = Math.max(1, ...pts.map((p) => p.bytes));
  const x = (i) => (pts.length > 1 ? (i / (pts.length - 1)) * W : W / 2);
  const y = (v) => H - 6 - (v / max) * (H - 16);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.bytes).toFixed(1)}`).join('');
  const s = data.summary;
  return (
    <section className="panel stack" style={{ gap: '0.6rem' }}>
      <h2 style={{ margin: 0 }}>Cómo creció el mundo</h2>
      <p className="muted small">
        {formatBytes(s.bytes)} y {s.regions} regiones hoy
        {pts.length > 1 ? `; creció ${formatBytes(Math.max(0, s.grewBytes))} y ${Math.max(0, s.grewRegions)} regiones en ${s.days} ${s.days === 1 ? 'día' : 'días'}.` : '. El panel toma una muestra al día: la gráfica aparece conforme pasen los días.'}
      </p>
      {pts.length > 1 && (
        <figure className="chart" style={{ margin: 0 }}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tamaño del mundo por día, de ${formatBytes(pts[0].bytes)} a ${formatBytes(s.bytes)}`}>
            <path d={`${d}L${W},${H}L0,${H}Z`} className="chart-area" />
            <path d={d} className="chart-line" />
          </svg>
          <figcaption className="faint small">
            {new Date(pts[0].t).toLocaleDateString('es-MX')} → {new Date(pts.at(-1).t).toLocaleDateString('es-MX')}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
