import { useEffect, useState } from 'react';
import { api, formatDate } from '../../api.js';

/** Logros del servidor: lo que la comunidad ha conseguido junta. */
export default function Achievements({ server }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/servers/${server.id}/achievements`).then(setData).catch(() => {});
  }, [server.id]);
  if (!data) return null;
  return (
    <section className="panel stack" style={{ gap: '0.8rem' }}>
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Logros del servidor
        </h2>
        <span className="muted small">
          {data.unlocked} de {data.total}
        </span>
      </div>
      <p className="muted small">
        {data.facts.playerHours} h jugadas entre todos, récord de {data.facts.maxConcurrent} a la vez, {data.facts.uniquePlayers} {data.facts.uniquePlayers === 1 ? 'persona' : 'personas'} distintas, {data.facts.ageDays} días de vida.
      </p>
      <ul className="ach-grid">
        {data.items.map((a) => (
          <li key={a.id} className={`ach${a.at ? ' on' : ''}`} title={a.at ? `Conseguido ${formatDate(a.at)}` : `${Math.round(a.progress * 100)} %`}>
            <span className="ach-icon" aria-hidden="true">
              {a.at ? '★' : '☆'}
            </span>
            <span className="ach-body">
              <strong>{a.title}</strong>
              <span className="muted small">{a.desc}</span>
              {!a.at && (
                <span className="meter" role="presentation">
                  <i style={{ width: `${Math.round(a.progress * 100)}%` }} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
