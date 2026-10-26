import { useEffect, useRef, useState } from 'react';
import { api, formatDate } from '../../api.js';
import { useLive } from '../../live.jsx';
import { Confirm, useAction } from '../../ui.jsx';
import Changelog from '../../changelog.jsx';

/**
 * Actualizar Paper / Fabric / Forge / NeoForge / Minecraft con un clic, con respaldo antes y "Deshacer".
 */
export default function SoftwareUpdate({ server, running }) {
  const [st, setSt] = useState(null);
  const [job, setJob] = useState(null);
  const [ask, setAsk] = useState(null); // 'loader' | 'minecraft' | 'undo'
  const [updateContent, setUpdateContent] = useState(true);
  const [run] = useAction();
  const { refresh } = useLive();
  const timer = useRef();

  const load = () =>
    api(`/servers/${server.id}/software`)
      .then((r) => {
        setSt(r);
        setJob(r.job);
      })
      .catch((err) => setSt({ error: err.message }));

  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  // Mientras trabaja, consulta el avance; al terminar vuelve a revisar qué hay disponible.
  useEffect(() => {
    if (!job?.running) return;
    timer.current = setTimeout(async () => {
      const r = await api(`/servers/${server.id}/software/job`).catch(() => null);
      if (!r) return;
      setJob(r.job);
      if (!r.job?.running) {
        load();
        refresh();
      }
    }, 1500);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const go = async (path, body) => {
    const r = await run(() => api(`/servers/${server.id}/software/${path}`, { method: 'POST', body }));
    if (r) setJob(r.job);
    setAsk(null);
  };

  if (!st) return null;
  const busy = Boolean(job?.running);
  const loader = st.loader;
  const mc = st.minecraft;
  const content = mc?.content;
  const contentWord = server.type === 'paper' ? 'plugins' : 'mods';
  const nothing = !loader?.available && !mc?.available;

  return (
    <section className="panel stack" aria-labelledby={`upd-${server.id}`}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h2 id={`upd-${server.id}`} style={{ margin: 0 }}>
          Actualizaciones
        </h2>
        {st.current && (
          <span className="muted small">
            Minecraft {st.current.mcVersion}
            {st.loaderName && st.current.loader ? ` · ${st.loaderName} ${server.type === 'paper' ? `build #${st.current.loader}` : st.current.loader}` : ''}
          </span>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Antes de actualizar se crea un respaldo completo; si estaba encendido, se apaga con cuidado y se vuelve a encender al terminar.
      </p>

      {st.error && !st.current && <div className="error-box">{st.error}</div>}
      {st.modpack && <p className="note">Este servidor viene de un modpack: las versiones las decide el modpack. Actualízalo desde la sección Modpack.</p>}

      {!busy && loader?.available && (
        <div className="update-row">
          <div className="grow">
            <strong>
              {st.loaderName} {loader.latestLabel}
            </strong>
            <span className="faint small" style={{ display: 'block' }}>
              Misma versión de Minecraft: correcciones y mejoras de rendimiento. Es la actualización más segura.
            </span>
          </div>
          <button className="btn-go" onClick={() => setAsk('loader')}>
            Actualizar
          </button>
        </div>
      )}

      {!busy && mc?.available && (
        <div className="update-row">
          <div className="grow stack" style={{ gap: '0.35rem' }}>
            <strong>Minecraft {mc.latest}</strong>
            <span className="faint small">
              Los jugadores tendrán que entrar con la versión {mc.latest}. El mundo se convierte a la versión nueva: para volver atrás se usa el respaldo.
            </span>
            {content && content.total > 0 && (
              <div className="small">
                {content.ready.length > 0 && (
                  <span style={{ color: 'var(--prismarine)' }}>
                    {content.ready.length} de {content.total} {contentWord} tienen versión para {mc.latest}.{' '}
                  </span>
                )}
                {content.missing.length > 0 && (
                  <details>
                    <summary style={{ color: 'var(--gold)' }}>
                      {content.missing.length} sin versión para {mc.latest} en Modrinth (o subidos a mano)
                    </summary>
                    <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem' }}>
                      {content.missing.map((m) => (
                        <li key={m.filename}>{m.title}</li>
                      ))}
                    </ul>
                    <span className="faint">Podrían no cargar en la versión nueva: búscalos actualizados o espera a que salgan.</span>
                  </details>
                )}
              </div>
            )}
          </div>
          <button onClick={() => setAsk('minecraft')}>Actualizar a {mc.latest}</button>
        </div>
      )}

      {!busy && nothing && !st.modpack && st.current && !st.error && <p className="faint small">Todo al día.</p>}
      {!busy && st.error && st.current && <p className="faint small">No se pudo revisar todo: {st.error}</p>}

      {job && (job.running || job.log.length > 0) && (
        <div role="status" aria-live="polite" className="stack" style={{ gap: '0.3rem' }}>
          <strong className="small">{job.error ? 'No se pudo terminar' : job.running ? job.step : job.step}</strong>
          <pre className="log-box">{job.log.join('\n')}</pre>
        </div>
      )}

      {!busy && st.last && (
        <div className="row small" style={{ flexWrap: 'wrap' }}>
          <span className="muted grow">
            Última actualización {formatDate(st.last.at)}: de {st.last.from.mcVersion} a {st.last.to.mcVersion}
            {st.last.to.mcVersion === st.last.from.mcVersion && st.last.to.loaderVersion ? ` (${st.last.to.loaderVersion})` : ''}.
          </span>
          <button className="btn-sm btn-ghost" onClick={() => setAsk('undo')}>
            Deshacer
          </button>
        </div>
      )}

      {ask === 'loader' && (
        <Confirm
          title={`Actualizar ${st.loaderName}`}
          message={
            <div className="stack" style={{ gap: '0.6rem' }}>
              <p>
                Se instala {st.loaderName} {loader.latestLabel}.{running ? ' El servidor se apaga unos segundos y vuelve a encender.' : ''}
              </p>
              {loader.changes && (
                <details open={loader.changes.length <= 8}>
                  <summary>Qué cambió en este build</summary>
                  <Changelog lines={loader.changes} compact />
                </details>
              )}
            </div>
          }
          confirmLabel="Actualizar"
          onClose={() => setAsk(null)}
          onConfirm={() => go('update', { target: 'loader' })}
        />
      )}
      {ask === 'minecraft' && (
        <Confirm
          title={`Actualizar a Minecraft ${mc.latest}`}
          message={
            <div className="stack" style={{ gap: '0.6rem' }}>
              <span>
                Se crea un respaldo y se instala Minecraft {mc.latest}. Al entrar por primera vez, el mundo se convierte a la versión nueva.
                {running ? ' El servidor se apaga mientras tanto.' : ''}
              </span>
              {server.type !== 'vanilla' && (
                <label className="check">
                  <input type="checkbox" checked={updateContent} onChange={(e) => setUpdateContent(e.target.checked)} />
                  <span>Actualizar también los {contentWord} que tengan versión para {mc.latest}</span>
                </label>
              )}
            </div>
          }
          confirmLabel="Actualizar"
          onClose={() => setAsk(null)}
          onConfirm={() => go('update', { target: 'minecraft', mcVersion: mc.latest, updateContent })}
        />
      )}
      {ask === 'undo' && (
        <Confirm
          title="Deshacer la actualización"
          danger
          message={`Se reinstala Minecraft ${st.last.from.mcVersion} y se restaura el respaldo ${st.last.backup}. Lo que se jugó después de actualizar se pierde.`}
          confirmLabel="Deshacer"
          onClose={() => setAsk(null)}
          onConfirm={() => go('undo')}
        />
      )}
    </section>
  );
}
