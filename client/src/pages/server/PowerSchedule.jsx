import { useEffect, useRef, useState } from 'react';
import { api, formatDate } from '../../api.js';
import { useAction } from '../../ui.jsx';

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/**
 * Horario de energía: pinta las horas en que el servidor debe estar encendido.
 * Arrastra sobre la cuadrícula para marcar o desmarcar varias horas seguidas.
 */
export default function PowerSchedule({ server }) {
  const [data, setData] = useState(null);
  const [run, busy] = useAction();
  const paint = useRef(null); // { value } mientras se arrastra
  const base = `/servers/${server.id}/power`;

  useEffect(() => {
    api(base).then(setData).catch(() => {});
  }, [base]);
  useEffect(() => {
    const up = () => {
      if (paint.current && paint.current.dirty) {
        const grid = paint.current.grid;
        paint.current = null;
        run(() => api(base, { method: 'PUT', body: { grid } }).then(setData));
      } else paint.current = null;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [base, run]);

  if (!data) return null;
  const save = (patch, msg) => run(() => api(base, { method: 'PUT', body: patch }).then(setData), msg);
  const toggle = (d, h, value) => {
    const grid = data.grid.map((row) => [...row]);
    grid[d][h] = value;
    setData({ ...data, grid });
    return grid;
  };
  const hours = data.grid.flat().filter(Boolean).length;
  const presets = {
    tardes: (d, h) => h >= 16 && h < 24,
    finde: (d, h) => (d >= 4 && h >= 14) || (d === 6 && h < 2) || (d === 5 && (h >= 10 || h < 2)),
    siempre: () => true,
    nunca: () => false,
  };

  return (
    <section className="panel stack" style={{ gap: '0.8rem' }}>
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Horario de energía
        </h2>
        <label className="check" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={data.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? 'Horario activado' : 'Horario desactivado')} />
          <span>Activar</span>
        </label>
      </div>
      <p className="muted small" style={{ maxWidth: '75ch' }}>
        Pinta las horas en que el servidor debe estar encendido (hora de esta PC). Al empezar una hora marcada se enciende solo; al terminar la última, se
        apaga con un aviso de un minuto en el chat. Las tareas programadas siguen funcionando aparte.
      </p>
      <div className="power-grid" role="group" aria-label="Horario semanal" onMouseLeave={() => paint.current && (paint.current.dirty = true)}>
        <div className="power-corner" />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="power-hour" aria-hidden="true">
            {h % 3 === 0 ? h : ''}
          </div>
        ))}
        {DAYS.map((label, d) => (
          <div key={label} className="power-row">
            <div className="power-day">{label}</div>
            {data.grid[d].map((on, h) => (
              <button
                key={h}
                type="button"
                aria-label={`${label} ${h}:00 ${on ? 'encendido' : 'apagado'}`}
                aria-pressed={on}
                className={`power-cell${on ? ' on' : ''}`}
                disabled={busy}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const value = !on;
                  paint.current = { value, grid: toggle(d, h, value), dirty: true };
                }}
                onMouseEnter={() => {
                  if (paint.current) paint.current.grid = toggle(d, h, paint.current.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    save({ grid: toggle(d, h, !on) });
                  }
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: '0.4rem' }}>
        <span className="muted small">
          {hours} {hours === 1 ? 'hora' : 'horas'} a la semana. Atajos:
        </span>
        {[
          ['tardes', 'Tardes (16 a 24 h)'],
          ['finde', 'Fines de semana'],
          ['siempre', 'Siempre'],
          ['nunca', 'Limpiar'],
        ].map(([id, label]) => (
          <button key={id} type="button" className="btn-sm" disabled={busy} onClick={() => save({ grid: DAYS.map((_, d) => Array.from({ length: 24 }, (_, h) => presets[id](d, h))) })}>
            {label}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={data.stopIfEmpty} disabled={busy} onChange={(e) => save({ stopIfEmpty: e.target.checked })} />
        <span>Al terminar el horario, apagar solo cuando no quede nadie jugando.</span>
      </label>
      {data.lastAction && (
        <p className="faint small">
          Último movimiento: {data.lastAction.text}, {formatDate(data.lastAction.at)}.
        </p>
      )}
    </section>
  );
}
