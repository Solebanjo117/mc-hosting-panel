import { useId } from 'react';

/**
 * Gráficas de línea en SVG, sin librerías. Las usan la pestaña Rendimiento de cada servidor y el
 * Rendimiento general. Reglas que siguen todas:
 *  - un solo eje vertical por gráfica (dos medidas distintas van en dos gráficas);
 *  - con una serie la línea lleva área suave; con varias, solo líneas y una leyenda con muestras de color;
 *  - el color de cada serie se fija por servidor (orden de creación), no por posición en la gráfica;
 *  - el cursor vertical (hoverIndex) se comparte entre las gráficas de una misma página.
 */

export const RANGES = [
  ['1h', '1 hora'],
  ['6h', '6 horas'],
  ['24h', '24 horas'],
  ['7d', '7 días'],
];

/** Colores de las series por servidor (tokens --series-1…7 en styles.css; validados para daltonismo). */
export const SERIES_COLORS = Array.from({ length: 7 }, (_, i) => `var(--series-${i + 1})`);
export const OTHER_COLOR = 'var(--sand-faint)';

// Las gráficas se ven a unos 450 px de ancho en dos columnas: un viewBox más estrecho deja la letra de los ejes legible.
const W = 640;
const H = 150;
const PAD = { top: 12, right: 12, bottom: 22, left: 44 };

export function timeLabel(t, range) {
  const d = new Date(t);
  if (range === '7d') return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' });
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function segmentsOf(values, x, y) {
  const segments = [];
  let current = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push([x(i), y(v)]);
  });
  if (current.length) segments.push(current);
  return segments;
}

/**
 * Una gráfica de línea.
 *  - points: [{ t, ...medidas }], con null donde no hay dato (servidor apagado).
 *  - valueKey (una serie) o series: [{ key, label, color, dashed }] (varias).
 *  - max: tope mínimo del eje; refLine: línea de referencia (límite de memoria, 20 TPS…).
 */
export function LineChart({ title, points, valueKey, series, max, unit = '', format, range, hoverIndex, onHover, emptyText, refLine }) {
  const list = series || [{ key: valueKey, label: title, color: 'var(--prismarine)' }];
  const multi = list.length > 1;
  const valuesOf = (s) => points.map((p) => p[s.key]);
  const all = list.flatMap((s) => valuesOf(s)).filter((v) => v != null);
  const hasData = all.length > 0;
  const top = Math.max(max ?? 0, refLine ?? 0, ...all, 1);
  const x = (i) => PAD.left + (i / Math.max(1, points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const ticks = [0, top / 2, top];
  const xTicks = [0, Math.floor(points.length / 2), points.length - 1];
  const id = useId();

  const first = list[0];
  const firstValues = valuesOf(first);
  const hv = hoverIndex != null ? firstValues[hoverIndex] : null;
  const last = [...firstValues].reverse().find((v) => v != null);
  const headline = multi ? null : hoverIndex != null ? (hv != null ? format(hv) : 'apagado') : last != null ? format(last) : '—';

  return (
    <figure className="chart">
      <figcaption className="row">
        <h3 className="grow" id={`${id}-t`}>
          {title}
        </h3>
        {headline != null && <span className="chart-value">{headline}</span>}
      </figcaption>
      {!hasData ? (
        <p className="faint small chart-empty">{emptyText}</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-labelledby={`${id}-t`}
            aria-describedby={`${id}-d`}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - rect.left) / rect.width) * W;
              const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1));
              onHover(Math.min(points.length - 1, Math.max(0, i)));
            }}
            onPointerLeave={() => onHover(null)}
          >
            <desc id={`${id}-d`}>
              {list
                .map((s) => {
                  const l = [...valuesOf(s)].reverse().find((v) => v != null);
                  return `${s.label}: ${l != null ? format(l) : 'sin datos'}`;
                })
                .join('. ')}
            </desc>
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
            {list.map((s) => {
              const values = valuesOf(s);
              const segs = segmentsOf(values, x, y);
              const stroke = s.color || 'var(--prismarine)';
              return (
                <g key={s.key} style={{ color: stroke }}>
                  {segs.map((seg, i) => (
                    <g key={i}>
                      {!multi && <path className="chart-area" style={{ fill: stroke }} d={`M${seg[0][0]},${y(0)} ${seg.map(([a, b]) => `L${a},${b}`).join(' ')} L${seg.at(-1)[0]},${y(0)} Z`} />}
                      {seg.length > 1 ? (
                        <path className="chart-line" style={{ stroke, strokeDasharray: s.dashed ? '4 4' : undefined }} d={seg.map(([a, b], j) => `${j ? 'L' : 'M'}${a},${b}`).join(' ')} />
                      ) : (
                        <circle className="chart-dot" style={{ fill: stroke }} cx={seg[0][0]} cy={seg[0][1]} r={3} />
                      )}
                    </g>
                  ))}
                  {hoverIndex != null && values[hoverIndex] != null && <circle className="chart-dot" style={{ fill: stroke }} cx={x(hoverIndex)} cy={y(values[hoverIndex])} r={4} />}
                </g>
              );
            })}
            {hoverIndex != null && <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={PAD.top} y2={H - PAD.bottom} className="chart-cursor" />}
          </svg>
          {multi && (
            <ul className="chart-legend" aria-label="Series">
              {list.map((s) => {
                const values = valuesOf(s);
                const v = hoverIndex != null ? values[hoverIndex] : [...values].reverse().find((x) => x != null);
                return (
                  <li key={s.key}>
                    <i className={`swatch-line${s.dashed ? ' dashed' : ''}`} style={{ color: s.color }} aria-hidden="true" />
                    <span className="chart-legend-name">{s.label}</span>
                    <span className="tabular">{v != null ? format(v) : hoverIndex != null ? 'apagado' : '—'}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </figure>
  );
}
