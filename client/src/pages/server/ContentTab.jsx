import { useCallback, useEffect, useState } from 'react';
import { api, qs, formatBytes, formatDate, formatNumber } from '../../api.js';
import { Modal, useAction, useToast } from '../../ui.jsx';

const SOURCE_LABEL = { modrinth: 'Modrinth', hangar: 'Hangar (PaperMC)' };
const PAGE = 20;

export default function ContentTab({ server, label }) {
  const [view, setView] = useState('explorar');
  const [installedVersion, setInstalledVersion] = useState(0);

  if (server.installState !== 'ready') {
    return <p className="muted">Podrás instalar {label.toLowerCase()} cuando termine la instalación del servidor.</p>;
  }

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="row">
        <div className="segmented" role="tablist">
          <button className={view === 'explorar' ? 'on' : ''} onClick={() => setView('explorar')} role="tab" aria-selected={view === 'explorar'}>
            Explorar
          </button>
          <button className={view === 'instalados' ? 'on' : ''} onClick={() => setView('instalados')} role="tab" aria-selected={view === 'instalados'}>
            Instalados
          </button>
        </div>
        <span className="muted small grow">
          Solo se muestran {label.toLowerCase()} compatibles con {server.type === 'vanilla' ? 'Minecraft' : server.type} {server.mcVersion}.
          {server.type !== 'vanilla' && ' Reinicia el servidor después de instalar.'}
        </span>
      </div>
      {view === 'explorar' ? (
        <Explore server={server} label={label} onInstalled={() => setInstalledVersion((n) => n + 1)} />
      ) : (
        <Installed server={server} label={label} key={installedVersion} />
      )}
    </div>
  );
}

function Explore({ server, label, onInstalled }) {
  const [source, setSource] = useState('modrinth');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState('downloads');
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(null);
  const [picker, setPicker] = useState(null);
  const [installed, setInstalled] = useState(new Set());
  const toast = useToast();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(0), [debounced, source, sort]);

  const loadInstalled = useCallback(() => {
    api(`/servers/${server.id}/content/installed`)
      .then((r) => setInstalled(new Set(r.items.map((i) => i.projectId).filter(Boolean))))
      .catch(() => {});
  }, [server.id]);
  useEffect(loadInstalled, [loadInstalled]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    api(`/servers/${server.id}/content/search?${qs({ source, query: debounced, sort, offset: page * PAGE, limit: PAGE })}`, { signal: ctrl.signal })
      .then(setData)
      .catch((err) => err.name !== 'AbortError' && setError(err.message))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [server.id, source, debounced, sort, page]);

  async function install(item, versionId) {
    setInstalling(item.id);
    try {
      const r = await api(`/servers/${server.id}/content/install`, {
        method: 'POST',
        body: { source: item.source, projectId: item.id, versionId, title: item.title, icon: item.icon },
      });
      const main = r.installed[0];
      const deps = r.installed.filter((i) => i.dependency && !i.error);
      const failed = r.installed.filter((i) => i.error);
      toast(`Instalado ${main.title} ${main.version}${deps.length ? ` y ${deps.length} dependencia(s)` : ''}`);
      for (const f of failed) toast(f.error, 'error');
      loadInstalled();
      onInstalled();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setInstalling(null);
    }
  }

  const sources = data?.sources || (server.type === 'paper' ? ['modrinth', 'hangar'] : ['modrinth']);
  const total = data?.total || 0;

  return (
    <div className="stack">
      <div className="row">
        <input
          className="grow"
          style={{ width: 'auto', minWidth: 220 }}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Buscar ${label.toLowerCase()}…`}
          aria-label={`Buscar ${label.toLowerCase()}`}
        />
        {sources.length > 1 && (
          <select value={source} onChange={(e) => setSource(e.target.value)} style={{ width: 'auto' }} aria-label="Fuente">
            {sources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto' }} aria-label="Ordenar">
          <option value="downloads">Más descargados</option>
          <option value="updated">Actualizados recientemente</option>
          {source === 'modrinth' && <option value="relevance">Relevancia</option>}
          {source === 'modrinth' && <option value="newest">Más nuevos</option>}
        </select>
      </div>

      {error && <div className="error-box">No se pudo buscar en {SOURCE_LABEL[source]}: {error}</div>}

      <div className="results" aria-busy={loading}>
        {data?.results.length === 0 && !loading && <p className="muted">Sin resultados para esta versión. Prueba con otras palabras.</p>}
        {data?.results.map((item) => (
          <article key={`${item.source}-${item.id}`} className="result">
            {item.icon ? <img src={item.icon} alt="" loading="lazy" /> : <div className="noicon" aria-hidden="true" />}
            <div style={{ minWidth: 0 }}>
              <h3>
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>{' '}
                <span className="faint small" style={{ fontWeight: 400 }}>
                  de {item.author}
                </span>
              </h3>
              <p>{item.description}</p>
              <div className="faint small" style={{ marginTop: '0.2rem' }}>
                {formatNumber(item.downloads)} descargas
                {item.updated ? `, actualizado ${formatDate(item.updated).split(',')[0]}` : ''}
                {item.clientOnly && <span style={{ color: 'var(--gold)' }}> · Solo funciona en el cliente</span>}
              </div>
            </div>
            <div className="row" style={{ gap: '0.4rem', justifyContent: 'flex-end' }}>
              <button className="btn-sm" onClick={() => setPicker(item)} disabled={installing === item.id}>
                Versiones
              </button>
              <button className="btn-sm btn-go" onClick={() => install(item)} disabled={installing === item.id}>
                {installing === item.id ? 'Instalando…' : installed.has(item.id) ? 'Reinstalar' : 'Instalar'}
              </button>
            </div>
          </article>
        ))}
      </div>

      {total > PAGE && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </button>
          <span className="muted small">
            Página {page + 1} de {Math.ceil(total / PAGE)}
          </span>
          <button disabled={(page + 1) * PAGE >= total || loading} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </button>
        </div>
      )}

      {picker && (
        <VersionPicker
          server={server}
          item={picker}
          onClose={() => setPicker(null)}
          onPick={(versionId) => {
            setPicker(null);
            install(picker, versionId);
          }}
        />
      )}
    </div>
  );
}

function VersionPicker({ server, item, onClose, onPick }) {
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/servers/${server.id}/content/versions?${qs({ source: item.source, projectId: item.id })}`)
      .then(setVersions)
      .catch((err) => setError(err.message));
  }, [server.id, item]);

  return (
    <Modal title={`Versiones de ${item.title}`} onClose={onClose} wide>
      {error && <div className="error-box">{error}</div>}
      {!versions && !error && <p className="muted">Cargando…</p>}
      {versions?.length === 0 && <p className="muted">No hay versiones compatibles con {server.mcVersion}.</p>}
      {versions?.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Versión</th>
                <th>Canal</th>
                <th>Fecha</th>
                <th>Archivo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>{v.number}</td>
                  <td className="muted">{v.type}</td>
                  <td className="muted">{formatDate(v.date)}</td>
                  <td className="muted">{v.file ? `${v.file.name} ${v.file.size ? `(${formatBytes(v.file.size)})` : ''}` : 'Descarga externa'}</td>
                  <td className="actions">
                    {v.file ? (
                      <button className="btn-sm btn-go" onClick={() => onPick(v.id)}>
                        Instalar
                      </button>
                    ) : (
                      v.externalUrl && (
                        <a className="btn btn-sm" href={v.externalUrl} target="_blank" rel="noreferrer">
                          Abrir sitio
                        </a>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function Installed({ server, label }) {
  const [data, setData] = useState(null);
  const [updates, setUpdates] = useState(null);
  const [run, busy] = useAction();

  const load = useCallback(() => api(`/servers/${server.id}/content/installed`).then(setData), [server.id]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const updateFor = (filename) => updates?.find((u) => u.filename === filename);

  if (!data) return <p className="muted">Cargando…</p>;

  return (
    <div className="stack">
      <div className="row">
        <span className="muted small grow">
          Carpeta <span className="mono">{data.folder}</span>. También puedes subir archivos desde la pestaña Archivos.
        </span>
        <button
          disabled={busy || !data.items.length}
          onClick={() =>
            run(async () => {
              const u = await api(`/servers/${server.id}/content/updates`);
              setUpdates(u);
              return u;
            }).then((u) => u && !u.length && setUpdates([]))
          }
        >
          Buscar actualizaciones
        </button>
      </div>
      {updates && updates.length === 0 && <p className="small" style={{ color: 'var(--prismarine)' }}>Todo está actualizado.</p>}

      {data.items.length === 0 ? (
        <div className="empty">
          <p className="muted">Todavía no hay {label.toLowerCase()} instalados.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Versión</th>
                <th>Origen</th>
                <th>Activo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const up = updateFor(item.filename);
                return (
                  <tr key={item.filename}>
                    <td>
                      <div className="row" style={{ gap: '0.55rem', flexWrap: 'nowrap' }}>
                        {item.icon && <img src={item.icon} alt="" width={24} height={24} style={{ borderRadius: 4 }} />}
                        <div>
                          <div>{item.title}</div>
                          <div className="faint mono" style={{ fontSize: 11 }}>
                            {item.filename}
                            {item.dependency ? ' · dependencia' : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="muted">{item.versionName || '—'}</td>
                    <td className="muted">{item.source === 'manual' ? 'Subido a mano' : item.source === 'hangar' ? 'Hangar' : 'Modrinth'}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        aria-label={`Activar ${item.title}`}
                        onChange={(e) =>
                          run(() =>
                            api(`/servers/${server.id}/content/toggle`, {
                              method: 'POST',
                              body: { filename: item.filename, enabled: e.target.checked },
                            }).then(setData)
                          )
                        }
                      />
                    </td>
                    <td className="actions">
                      {up && (
                        <button
                          className="btn-sm btn-go"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await api(`/servers/${server.id}/content/update`, { method: 'POST', body: up });
                              setUpdates((list) => list.filter((u) => u !== up));
                              await load();
                            }, `Actualizado a ${up.newVersion}`)
                          }
                        >
                          Actualizar a {up.newVersion}
                        </button>
                      )}{' '}
                      <button
                        className="btn-sm btn-stop"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              api(`/servers/${server.id}/content/uninstall`, { method: 'POST', body: { filename: item.filename } }).then(setData),
                            `${item.title} desinstalado`
                          )
                        }
                      >
                        Desinstalar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
