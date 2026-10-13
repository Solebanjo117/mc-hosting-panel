import { useCallback, useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Link } from 'react-router-dom';
import { api, qs, formatBytes, formatDate, formatNumber } from '../../api.js';
import { Modal, useAction, useToast } from '../../ui.jsx';
import ModpackSection from './ModpackSection.jsx';
import { useLive, serverState } from '../../live.jsx';

/** "hace 3 días", "hace 2 meses"… */
function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  for (const [unit, sec] of [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
  ]) {
    if (s >= sec) return rtf.format(-Math.floor(s / sec), unit);
  }
  return 'hace un momento';
}

// Las descripciones vienen de otros sitios: se limpian antes de mostrarlas.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noreferrer noopener');
  }
  if (node.tagName === 'IMG') node.setAttribute('loading', 'lazy');
});
const renderBody = (md) => DOMPurify.sanitize(marked.parse(md || ''), { FORBID_TAGS: ['style', 'form', 'input', 'iframe'], FORBID_ATTR: ['style'] });

/** Ruta de la API de contenido; kind = 'datapack' trabaja con los datapacks del mundo. */
const curl = (server, kind, path, params = {}) => {
  const q = qs({ ...params, kind });
  return `/servers/${server.id}/content/${path}${q ? `?${q}` : ''}`;
};

const SOURCE_LABEL = { modrinth: 'Modrinth', hangar: 'Hangar (PaperMC)', curseforge: 'CurseForge' };
const PAGE = 20;

export default function ContentTab({ server, label, kind = null }) {
  const [view, setView] = useState('explorar');
  const [installedVersion, setInstalledVersion] = useState(0);
  const datapacks = kind === 'datapack' || server.type === 'vanilla';
  const apiKind = kind === 'datapack' ? 'datapack' : null;
  const { runtime } = useLive();
  const running = serverState(server, runtime[server.id]) === 'running';
  // Cambios de datapacks hechos con el servidor encendido que todavía no se aplican.
  const [pending, setPending] = useState(null); // { worldgen: bool }
  useEffect(() => {
    if (!running) setPending(null);
  }, [running]);
  const markPending = (info = {}) => {
    if (datapacks && running) setPending((p) => ({ worldgen: Boolean(p?.worldgen || info.worldgen) }));
  };
  const changed = (info) => {
    setInstalledVersion((n) => n + 1);
    markPending(info);
  };

  if (server.installState !== 'ready') {
    return <p className="muted">Podrás instalar {label.toLowerCase()} cuando termine la instalación del servidor.</p>;
  }

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      {!datapacks && <ModpackSection server={server} />}
      {datapacks && <DatapackNotes server={server} pending={pending} onApplied={() => setPending(null)} />}
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
          Solo se muestran {label.toLowerCase()} compatibles con {server.type === 'vanilla' || datapacks ? 'Minecraft' : server.type} {server.mcVersion}.
          {!datapacks && server.type !== 'vanilla' && ' Reinicia el servidor después de instalar.'}
        </span>
      </div>
      {view === 'explorar' ? (
        <Explore server={server} label={label} kind={apiKind} onInstalled={changed} />
      ) : (
        <Installed server={server} label={label} kind={apiKind} onChanged={markPending} key={installedVersion} />
      )}
    </div>
  );
}

/** Para datapacks: en qué mundo van, cómo se aplican y el botón para aplicarlos sin reiniciar. */
function DatapackNotes({ server, pending, onApplied }) {
  const [world, setWorld] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    api(`/servers/${server.id}/properties`)
      .then((p) => setWorld(p['level-name'] || 'world'))
      .catch(() => setWorld('world'));
  }, [server.id]);
  return (
    <div className="stack" style={{ gap: '0.6rem' }}>
      <p className="muted small" style={{ margin: 0, maxWidth: '80ch' }}>
        Los datapacks van en el mundo activo{world && (
          <>
            {' '}
            (<span className="mono">{world}</span>)
          </>
        )}
        . Si creas otro mundo en <Link to={`/servidor/${server.id}/mundos`}>Mundos</Link>, puedes copiarle estos datapacks. Los que cambian la generación del mundo (biomas,
        estructuras) solo afectan las zonas que todavía no se exploran.
      </p>
      {pending && (
        <div className="note row" style={{ margin: 0, alignItems: 'center' }} role="status">
          <span className="grow">
            {pending.worldgen
              ? 'Hay cambios sin aplicar. Alguno cambia la generación del mundo: eso necesita reiniciar el servidor.'
              : 'Hay cambios sin aplicar. Puedes aplicarlos ahora sin reiniciar.'}
          </span>
          <button
            className="btn-sm btn-go"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api(`/servers/${server.id}/content/reload`, { method: 'POST' });
                onApplied();
                return r;
              }, 'Datapacks aplicados (/reload)')
            }
          >
            {busy ? 'Aplicando…' : 'Aplicar ahora'}
          </button>
        </div>
      )}
    </div>
  );
}

function Explore({ server, label, kind, onInstalled }) {
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
  const [details, setDetails] = useState(null);
  const [installed, setInstalled] = useState(new Set());
  const toast = useToast();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(0), [debounced, source, sort]);

  const loadInstalled = useCallback(() => {
    api(curl(server, kind, 'installed'))
      .then((r) => setInstalled(new Set(r.items.map((i) => i.projectId).filter(Boolean))))
      .catch(() => {});
  }, [server.id, kind]);
  useEffect(loadInstalled, [loadInstalled]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    api(curl(server, kind, 'search', { source, query: debounced, sort, offset: page * PAGE, limit: PAGE }), { signal: ctrl.signal })
      .then(setData)
      .catch((err) => err.name !== 'AbortError' && setError(err.message))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [server.id, kind, source, debounced, sort, page]);

  async function install(item, versionId) {
    setInstalling(item.id);
    try {
      const r = await api(curl(server, kind, 'install'), {
        method: 'POST',
        body: { source: item.source, projectId: item.id, versionId, title: item.title, icon: item.icon },
      });
      const main = r.installed[0];
      const deps = r.installed.filter((i) => i.dependency && !i.error);
      const failed = r.installed.filter((i) => i.error);
      toast(`Instalado ${main.title} ${main.version}${deps.length ? ` y ${deps.length} dependencia(s)` : ''}`);
      for (const f of failed) toast(f.error, 'error');
      const worldgen = r.installed.some((i) => i.worldgen);
      if (worldgen) toast(`${main.title} cambia la generación del mundo: se aplica al reiniciar y solo en zonas nuevas.`);
      loadInstalled();
      onInstalled({ worldgen });
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
          {source !== 'hangar' && <option value="relevance">{source === 'curseforge' ? 'Populares' : 'Relevancia'}</option>}
          {source !== 'hangar' && <option value="newest">Más nuevos</option>}
        </select>
      </div>

      {error && <div className="error-box">No se pudo buscar en {SOURCE_LABEL[source]}: {error}</div>}
      {data && !sources.includes('curseforge') && page === 0 && !debounced && (
        <p className="faint small" style={{ margin: 0 }}>
          ¿Buscas algo que solo está en CurseForge? Agrega tu clave gratis en <Link to="/ajustes">Ajustes del panel</Link> y aparecerá como otra fuente.
        </p>
      )}

      <div className="mcards" aria-busy={loading}>
        {data?.results.length === 0 && !loading && <p className="muted">Sin resultados para esta versión. Prueba con otras palabras.</p>}
        {data?.results.map((item) => (
          <article key={`${item.source}-${item.id}`} className="mcard">
            <button
              type="button"
              className="mcard-banner"
              onClick={() => setDetails(item)}
              aria-label={`Ver detalles de ${item.title}`}
              style={
                item.banner
                  ? { backgroundImage: `url("${item.banner}")` }
                  : { background: `linear-gradient(135deg, ${item.color || 'var(--slate-3)'}55, var(--slate-2))` }
              }
            />
            <div className="mcard-body">
              <div className="mcard-head">
                {item.icon ? <img src={item.icon} alt="" loading="lazy" className="mcard-icon" /> : <div className="mcard-icon noicon" aria-hidden="true" />}
                <div style={{ minWidth: 0 }}>
                  <h3 className="mcard-title">
                    <button type="button" className="link-btn" onClick={() => setDetails(item)}>
                      {item.title}
                    </button>
                  </h3>
                  <div className="faint small">de {item.author}</div>
                </div>
                {installed.has(item.id) && <span className="chip mcard-installed">Instalado</span>}
              </div>
              <p className="mcard-desc">{item.description}</p>
              {item.categories?.length > 0 && (
                <div className="mcard-tags">
                  {item.categories.slice(0, 3).map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
              )}
              <div className="mcard-stats faint small">
                <span title="Descargas">⤓ {formatNumber(item.downloads)}</span>
                {item.follows != null && <span title="Seguidores">♥ {formatNumber(item.follows)}</span>}
                {item.updated && <span title={formatDate(item.updated)}>Actualizado {ago(item.updated)}</span>}
              </div>
              {item.clientOnly && <div className="small" style={{ color: 'var(--gold)' }}>Solo funciona en el cliente, no en el servidor</div>}
              {item.worldgen && kind === 'datapack' && <div className="small" style={{ color: 'var(--gold)' }}>Cambia la generación del mundo: mejor antes de explorar</div>}
              {item.blocked && <div className="small" style={{ color: 'var(--gold)' }}>El autor solo permite bajarlo desde CurseForge: se instala a mano</div>}
            </div>
            <footer className="mcard-foot">
              <button className="btn-sm btn-ghost" onClick={() => setDetails(item)}>
                Detalles
              </button>
              <button className="btn-sm" onClick={() => setPicker(item)} disabled={installing === item.id}>
                Versiones
              </button>
              <button className="btn-sm btn-go" onClick={() => install(item)} disabled={installing === item.id}>
                {installing === item.id ? 'Instalando…' : installed.has(item.id) ? 'Reinstalar' : 'Instalar'}
              </button>
            </footer>
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

      {details && (
        <ProjectDetails
          server={server}
          item={details}
          installed={installed.has(details.id)}
          installing={installing === details.id}
          onClose={() => setDetails(null)}
          onInstall={() => install(details)}
          onVersions={() => {
            setPicker(details);
            setDetails(null);
          }}
        />
      )}
      {picker && (
        <VersionPicker
          server={server}
          kind={kind}
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

function VersionPicker({ server, item, kind, onClose, onPick }) {
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(curl(server, kind, 'versions', { source: item.source, projectId: item.id }))
      .then(setVersions)
      .catch((err) => setError(err.message));
  }, [server.id, item, kind]);

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

function Installed({ server, label, kind, onChanged }) {
  const [data, setData] = useState(null);
  const [updates, setUpdates] = useState(null);
  const [run, busy] = useAction();

  const load = useCallback(() => api(curl(server, kind, 'installed')).then(setData), [server.id, kind]);
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
              const u = await api(curl(server, kind, 'updates'));
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
                            {item.folder ? '/' : ''}
                            {item.dependency ? ' · dependencia' : ''}
                          </div>
                          {item.worldgen && (
                            <div className="small" style={{ color: 'var(--gold)' }} title="Se aplica al reiniciar y solo en las zonas que todavía no se exploran">
                              Generación de mundo
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="muted">{item.versionName || '—'}</td>
                    <td className="muted">
                      {item.folder ? 'Carpeta' : { manual: 'Subido a mano', hangar: 'Hangar', geysermc: 'GeyserMC', curseforge: 'CurseForge' }[item.source] || 'Modrinth'}
                      {item.managedBy === 'bedrock' ? ', para Bedrock' : item.managedBy === 'modpack' ? ', del modpack' : ''}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        disabled={item.folder}
                        title={item.folder ? 'Un datapack en carpeta no se puede desactivar; desinstálalo o comprímelo en .zip' : undefined}
                        aria-label={`Activar ${item.title}`}
                        onChange={(e) =>
                          run(() =>
                            api(curl(server, kind, 'toggle'), {
                              method: 'POST',
                              body: { filename: item.filename, enabled: e.target.checked },
                            }).then((d) => {
                              setData(d);
                              onChanged?.({ worldgen: item.worldgen });
                            })
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
                              await api(curl(server, kind, 'update'), { method: 'POST', body: up });
                              setUpdates((list) => list.filter((u) => u !== up));
                              await load();
                              onChanged?.({ worldgen: item.worldgen });
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
                              api(curl(server, kind, 'uninstall'), { method: 'POST', body: { filename: item.filename } }).then((d) => {
                                setData(d);
                                onChanged?.({ worldgen: item.worldgen });
                              }),
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

function ProjectDetails({ server, item, installed, installing, onClose, onInstall, onVersions }) {
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [shot, setShot] = useState(0);
  useEffect(() => {
    api(`/servers/${server.id}/content/project?${qs({ source: item.source, projectId: item.id })}`)
      .then(setP)
      .catch((err) => setError(err.message));
  }, [server.id, item]);
  const html = useMemo(() => (p ? renderBody(p.body) : ''), [p]);
  const g = p?.gallery || [];

  return (
    <Modal title={item.title} onClose={onClose} wide>
      <div className="stack" style={{ gap: '1rem' }}>
        <div className="row" style={{ gap: '0.9rem', flexWrap: 'nowrap' }}>
          {item.icon ? <img src={item.icon} alt="" width={64} height={64} className="mcard-icon" style={{ width: 64, height: 64 }} /> : null}
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="muted small">de {item.author}</div>
            <p style={{ margin: '0.2rem 0 0' }}>{item.description}</p>
            <div className="mcard-stats faint small" style={{ marginTop: '0.4rem' }}>
              <span>⤓ {formatNumber(p?.downloads ?? item.downloads)} descargas</span>
              {(p?.follows ?? item.follows) != null && <span>♥ {formatNumber(p?.follows ?? item.follows)}</span>}
              {(p?.updated || item.updated) && <span>Actualizado {ago(p?.updated || item.updated)}</span>}
              {p?.license && <span>Licencia {p.license}</span>}
            </div>
          </div>
        </div>
        <div className="row">
          <button className="btn-go" disabled={installing} onClick={onInstall}>
            {installing ? 'Instalando…' : installed ? 'Reinstalar' : 'Instalar la versión recomendada'}
          </button>
          <button onClick={onVersions}>Elegir versión</button>
          <span className="grow" />
          <a className="btn btn-ghost" href={item.url} target="_blank" rel="noreferrer">
            Abrir en {SOURCE_LABEL[item.source]?.replace(' (PaperMC)', '') || 'la página'}
          </a>
        </div>
        {error && <div className="error-box">{error}</div>}
        {!p && !error && <p className="muted">Cargando detalles…</p>}
        {g.length > 0 && (
          <div className="gallery">
            <figure className="gallery-main">
              <img src={g[shot].raw || g[shot].url} alt={g[shot].title || ''} />
              {(g[shot].title || g[shot].description) && (
                <figcaption className="small muted">
                  {g[shot].title}
                  {g[shot].description ? ` — ${g[shot].description}` : ''}
                </figcaption>
              )}
            </figure>
            {g.length > 1 && (
              <div className="gallery-thumbs">
                {g.map((x, i) => (
                  <button key={x.url} type="button" className={i === shot ? 'on' : ''} onClick={() => setShot(i)} aria-label={`Imagen ${i + 1}`}>
                    <img src={x.url} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {p?.links?.length > 0 && (
          <div className="row small" style={{ gap: '0.8rem' }}>
            {p.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            ))}
          </div>
        )}
        {html && <div className="doc project-body" dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </Modal>
  );
}
