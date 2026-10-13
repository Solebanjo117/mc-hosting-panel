import { useEffect, useState } from 'react';
import { api, formatDate } from '../../api.js';
import { useAction, useToast } from '../../ui.jsx';

/** Optimización de un clic: lista de ajustes con su estado, aplicar y deshacer. */
export default function OptimizeSection({ server, running }) {
  const [s, setS] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();

  useEffect(() => {
    api(`/servers/${server.id}/optimize`).then(setS).catch(() => {});
  }, [server.id]);
  if (!s) return null;

  const groups = [];
  for (const item of s.items) {
    if (!groups.length || groups.at(-1).name !== item.group) groups.push({ name: item.group, items: [] });
    groups.at(-1).items.push(item);
  }

  const apply = (body, msg) =>
    run(async () => {
      const r = await api(`/servers/${server.id}/optimize`, { method: 'POST', body });
      setS(r);
      r.errors?.forEach((e) => toast(e, 'error'));
      toast(r.restartRequired ? `${msg} Reinicia el servidor para aplicarlo.` : msg);
    });

  return (
    <section className="panel stack" id="optimizar">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Optimización
        </h2>
        <span className={`health-chip ${s.pending ? 'warn' : 'ok'}`}>
          <i aria-hidden="true" />
          {s.pending ? `${s.pending} ${s.pending === 1 ? 'ajuste pendiente' : 'ajustes pendientes'}` : 'Optimizado'}
        </span>
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: '75ch' }}>
        Ajustes que hacen que el servidor vaya más fluido sin cambiar cómo se juega. Se guarda lo que había antes por si quieres deshacerlo.
      </p>
      {groups.map((g) => (
        <div key={g.name} className="stack" style={{ gap: '0.35rem' }}>
          <h3 className="muted small" style={{ margin: 0, fontWeight: 500 }}>
            {g.name}
          </h3>
          <ul className="health-list">
            {g.items.map((i) => (
              <li key={i.id} className={`health-item ${i.applied ? 'ok' : 'warn'}`}>
                <span className="health-icon" aria-hidden="true">
                  {i.applied ? '✓' : '!'}
                </span>
                <div className="grow">
                  <div>{i.label}</div>
                  {i.note && <div className="muted small">{i.note}</div>}
                </div>
                {!i.applied && (
                  <button className="btn-sm" disabled={busy} onClick={() => apply({ only: [i.id] }, 'Listo.')}>
                    Aplicar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {s.paperMissing && (
        <p className="note small" style={{ margin: 0 }}>
          Los ajustes de Paper aparecen después de encender el servidor una vez (Paper crea su archivo de configuración al arrancar).
        </p>
      )}
      <div className="row">
        <button className="btn-go" disabled={busy || !s.pending} onClick={() => apply({}, 'Servidor optimizado.')}>
          {busy ? 'Aplicando…' : 'Optimizar todo'}
        </button>
        {s.canUndo && (
          <button className="btn-ghost" disabled={busy} onClick={() => apply({ undo: true }, 'Ajustes restaurados.')}>
            Deshacer
          </button>
        )}
        {s.optimizedAt && <span className="faint small">Última optimización: {formatDate(s.optimizedAt)}</span>}
      </div>
      {running && <p className="faint small" style={{ margin: 0 }}>Los cambios se aplican al reiniciar el servidor.</p>}
    </section>
  );
}
