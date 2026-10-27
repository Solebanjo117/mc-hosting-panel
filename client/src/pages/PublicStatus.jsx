import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, STATUS_LABEL, TYPE_LABEL, uptime } from '../api.js';
import { parseMc, segStyle } from '../mcText.js';
import { CopyButton, GrassBlock, PlayerHead, usePageTitle } from '../ui.jsx';

/**
 * Página pública de un servidor: /estado/<id>. Se ve sin sesión.
 * Muestra el estado, el MOTD como en el juego, quién juega y cómo entrar (Java y Bedrock).
 */
export default function PublicStatus() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  usePageTitle(data ? data.name : 'Servidor');

  useEffect(() => {
    let stop = false;
    const load = () =>
      api(`/public/${id}`)
        .then((d) => !stop && setData(d))
        .catch((err) => !stop && setError(err.message));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id]);

  if (error) {
    return (
      <div className="auth">
        <div className="auth-card panel stack">
          <GrassBlock className="auth-block" />
          <h1>Esta página no está disponible</h1>
          <p className="muted">El administrador no la ha activado o el enlace cambió.</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="loading" aria-busy="true"><GrassBlock /></div>;

  const on = data.status === 'running';
  const motd = data.motd.split('\n');
  const java = data.address?.java;
  const bedrock = data.address?.bedrock;

  return (
    <div className="auth public-page">
      <div className="public-card panel stack">
        <div className="row" style={{ gap: '1rem', alignItems: 'flex-start' }}>
          {data.icon ? <img className="server-icon" src={`/api/public/${data.id}/icon?v=${data.icon}`} width={64} height={64} alt="" /> : <GrassBlock size={56} />}
          <div className="grow" style={{ minWidth: 0 }}>
            <h1 className="nameplate" style={{ overflowWrap: 'anywhere' }}>{data.name}</h1>
            <div className="mc-list" style={{ marginTop: '0.5rem', maxWidth: 'none', padding: '6px 10px' }}>
              <div className="mc-list-text">
                {motd.map((line, i) => (
                  <div key={i}>
                    {parseMc(line).map((seg, j) => (
                      <span key={j} style={segStyle(seg)}>
                        {seg.text}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="public-status">
          <span className={`status${on ? ' on' : ''}`}>
            <i className={`dot ${data.status}`} aria-hidden="true" />
            {data.maintenance ? 'En mantenimiento' : STATUS_LABEL[data.status] || data.status}
          </span>
          <span className="muted small">
            {TYPE_LABEL[data.type]} {data.mcVersion}
            {data.modpack ? ` · modpack ${data.modpack.name}` : ''}
            {on && data.startedAt ? ` · encendido hace ${uptime(data.startedAt)}` : ''}
          </span>
        </div>

        {data.maintenance && (
          <div className="note">
            {data.maintenance.message || 'El servidor está en mantenimiento.'}
            {data.maintenance.until ? ` Volvemos: ${data.maintenance.until}.` : ''}
          </div>
        )}
        {data.message && !data.maintenance && <p className="muted">{data.message}</p>}

        <section className="stack" style={{ gap: '0.5rem' }}>
          <h2>
            Jugando ahora: {data.playerCount} de {data.maxPlayers}
          </h2>
          {data.players ? (
            data.players.length ? (
              <div className="row" style={{ gap: '0.5rem' }}>
                {data.players.map((p) => (
                  <span key={p} className="chip">
                    <PlayerHead name={p} size={20} /> {p}
                  </span>
                ))}
              </div>
            ) : (
              <p className="faint small">{on ? 'Nadie conectado en este momento.' : 'El servidor está apagado.'}</p>
            )
          ) : null}
        </section>

        {data.address && (java || bedrock) && (
          <section className="stack" style={{ gap: '0.6rem' }}>
            <h2>Cómo entrar</h2>
            {java && (
              <div className="stack" style={{ gap: '0.3rem' }}>
                <strong>Minecraft Java {data.mcVersion}</strong>
                <span className="address">
                  <span>{java}</span>
                  <CopyButton text={java} label="Copiar dirección" />
                </span>
                <ol className="small muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
                  <li>Abre Minecraft {data.mcVersion} (en el launcher elige esa versión{data.modpack ? ` con el modpack ${data.modpack.name}` : ''}).</li>
                  <li>Multijugador → Agregar servidor → pega la dirección.</li>
                  <li>Entra. {data.maxPlayers} lugares.</li>
                </ol>
              </div>
            )}
            {data.bedrock && bedrock && (
              <div className="stack" style={{ gap: '0.3rem' }}>
                <strong>Bedrock (celular, consola, Windows)</strong>
                <span className="address">
                  <span>
                    {bedrock.host}, puerto {bedrock.port}
                  </span>
                  <CopyButton text={bedrock.host} label="Copiar dirección" />
                </span>
                <p className="small muted">Jugar → Servidores → Agregar servidor: dirección {bedrock.host} y puerto {bedrock.port}.</p>
              </div>
            )}
          </section>
        )}
        <p className="faint small">Se actualiza solo cada 15 segundos.</p>
      </div>
    </div>
  );
}
