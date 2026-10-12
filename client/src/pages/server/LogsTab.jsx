import { useEffect, useState } from 'react';
import { api, formatBytes, formatDate, qs } from '../../api.js';
import { useToast } from '../../ui.jsx';

export function Findings({ findings }) {
  if (!findings?.length) return null;
  return (
    <div className="stack" style={{ gap: '0.6rem' }}>
      {findings.map((f, i) => (
        <div key={i} className="finding">
          <strong>{f.title}</strong>
          <p className="muted small">{f.detail}</p>
          <p className="small">{f.fix}</p>
        </div>
      ))}
    </div>
  );
}

export default function LogsTab({ server }) {
  const [list, setList] = useState(null);
  const [view, setView] = useState({ kind: 'logs', file: 'latest.log' });
  const [content, setContent] = useState(null);
  const [filter, setFilter] = useState('');
  const [debounced, setDebounced] = useState('');
  const [global, setGlobal] = useState('');
  const [globalResults, setGlobalResults] = useState(null);
  const [diagnosis, setDiagnosis] = useState(null);
  const toast = useToast();
  const base = `/servers/${server.id}/logs`;

  useEffect(() => {
    api(base).then(setList).catch(() => {});
    api(`${base}/diagnose`).then((d) => setDiagnosis(d.findings)).catch(() => {});
  }, [base]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(filter), 300);
    return () => clearTimeout(t);
  }, [filter]);

  useEffect(() => {
    setContent(null);
    if (!view.file) return undefined;
    // Ignora respuestas de un archivo anterior si el usuario ya eligió otro.
    let current = true;
    const req =
      view.kind === 'crash'
        ? api(`${base}/crash/${encodeURIComponent(view.file)}`)
        : api(`${base}/file/${encodeURIComponent(view.file)}?${qs({ q: debounced })}`);
    req
      .then((c) => current && setContent({ ...c, kind: view.kind }))
      .catch((err) => current && setContent({ error: err.message, kind: view.kind }));
    return () => {
      current = false;
    };
  }, [base, view, debounced]);

  async function searchAll(e) {
    e.preventDefault();
    try {
      setGlobalResults(await api(`${base}/search?${qs({ q: global })}`));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (!list) return <p className="muted">Cargando…</p>;
  const noLogs = !list.logs.length && !list.crashes.length;

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      {diagnosis?.length > 0 && (
        <section className="panel">
          <h2>Lo que encontramos en el último log</h2>
          <Findings findings={diagnosis} />
        </section>
      )}

      <form className="row" onSubmit={searchAll}>
        <input
          className="grow"
          style={{ width: 'auto', maxWidth: 420 }}
          value={global}
          onChange={(e) => setGlobal(e.target.value)}
          placeholder="Buscar en todos los logs (p. ej. el nombre de un jugador)"
          aria-label="Buscar en todos los logs"
        />
        <button disabled={global.trim().length < 2}>Buscar en todos</button>
        {globalResults && (
          <button type="button" className="btn-ghost" onClick={() => setGlobalResults(null)}>
            Cerrar búsqueda
          </button>
        )}
      </form>

      {globalResults ? (
        <section className="stack" style={{ gap: '0.5rem' }}>
          <p className="muted small">
            {globalResults.results.length} resultado(s) para “{globalResults.query}”{globalResults.truncated ? ' (se muestran los primeros 1000)' : ''}.
          </p>
          <div className="logview">
            {globalResults.results.map((r, i) => (
              <div key={i}>
                <button className="link-btn" onClick={() => setView({ kind: 'logs', file: r.file })}>
                  {r.file}:{r.n}
                </button>{' '}
                {r.text}
              </div>
            ))}
          </div>
        </section>
      ) : noLogs ? (
        <p className="muted">Todavía no hay logs. Aparecen cuando enciendes el servidor.</p>
      ) : (
        <div className="logs-layout">
          <nav className="stack" style={{ gap: '1rem', alignContent: 'start' }} aria-label="Archivos de log">
            {list.crashes.length > 0 && (
              <div>
                <h3 className="muted small" style={{ fontWeight: 500, marginBottom: '0.3rem' }}>
                  Reportes de crash
                </h3>
                {list.crashes.map((f) => (
                  <button key={f.file} className={`file-pick${view.kind === 'crash' && view.file === f.file ? ' on' : ''}`} onClick={() => setView({ kind: 'crash', file: f.file })}>
                    {formatDate(f.mtime)}
                  </button>
                ))}
              </div>
            )}
            <div>
              <h3 className="muted small" style={{ fontWeight: 500, marginBottom: '0.3rem' }}>
                Logs
              </h3>
              {list.logs.map((f) => (
                <button key={f.file} className={`file-pick${view.kind === 'logs' && view.file === f.file ? ' on' : ''}`} onClick={() => setView({ kind: 'logs', file: f.file })}>
                  {f.file === 'latest.log' ? 'Actual (latest.log)' : f.file.replace(/\.log(\.gz)?$/, '')}
                  <span className="faint"> {formatBytes(f.size)}</span>
                </button>
              ))}
            </div>
          </nav>

          <section className="stack" style={{ gap: '0.6rem', minWidth: 0 }}>
            <div className="row">
              <strong className="grow mono small" style={{ overflowWrap: 'anywhere' }}>
                {view.file}
              </strong>
              {view.kind === 'logs' && (
                <input
                  style={{ width: 240 }}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filtrar este archivo"
                  aria-label="Filtrar este archivo"
                />
              )}
              <a className="btn btn-sm" href={`/api${base}/raw/${view.kind}/${encodeURIComponent(view.file)}`}>
                Descargar
              </a>
            </div>
            {content?.error && <div className="error-box">{content.error}</div>}
            {content?.kind === 'crash' && view.kind === 'crash' && !content.error && (
              <>
                {content.findings.length > 0 ? (
                  <section className="panel">
                    <h2>Posible causa</h2>
                    <Findings findings={content.findings} />
                  </section>
                ) : (
                  <p className="note">No reconocimos la causa automáticamente. Busca líneas con “Caused by” o el nombre de un mod cerca del inicio.</p>
                )}
                <pre className="logview">{content.text}</pre>
              </>
            )}
            {content?.kind === 'logs' && view.kind === 'logs' && !content.error && (
              <>
                <p className="faint small">
                  {content.matches != null ? `${content.matches} de ${content.total} líneas` : `${content.total} líneas`}
                  {content.truncated ? '; se muestran las últimas 4000' : ''}.
                </p>
                <div className="logview">
                  {content.lines.map((l) => (
                    <div key={l.n} className={/ERROR|Exception|FATAL/.test(l.text) ? 'l-error' : /WARN/.test(l.text) ? 'l-warn' : ''}>
                      <span className="ln">{l.n}</span>
                      {l.text}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
