import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs, formatDate, formatNumber, TYPE_LABEL } from '../api.js';
import { useLive } from '../live.jsx';
import { Modal, usePageTitle } from '../ui.jsx';

const LOADER_LABEL = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };

const SITE_LABEL = { modrinth: 'Modrinth', curseforge: 'CurseForge' };

export default function ImportModpack() {
  const [mode, setMode] = useState('modrinth');
  usePageTitle('Crear desde un modpack');
  const [choice, setChoice] = useState(null); // { kind: 'store', source, project, version } | { kind: 'file', file, plan }

  const tab = (id, label) => (
    <button className={mode === id ? 'on' : ''} onClick={() => setMode(id)} role="tab" aria-selected={mode === id}>
      {label}
    </button>
  );
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div className="grow">
          <h1>Crear desde un modpack</h1>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: '70ch' }}>
            El panel instala el loader y la versión de Minecraft que pide el modpack, descarga todos sus mods y copia su configuración. Los mods que solo
            sirven en el juego (shaders, minimapas) se omiten en el servidor; después puedes descargar el modpack para tus jugadores desde la pestaña Mods.
          </p>
        </div>
      </div>
      <div className="segmented" role="tablist" style={{ marginBottom: '1.25rem' }}>
        {tab('modrinth', 'Modrinth')}
        {tab('curseforge', 'CurseForge')}
        {tab('subir', 'Subir archivo')}
      </div>
      {mode === 'subir' ? <Upload onPick={setChoice} /> : <Search key={mode} source={mode} onPick={setChoice} />}
      {choice && <Confirm choice={choice} onClose={() => setChoice(null)} />}
    </div>
  );
}

function Search({ source, onPick }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [versionsFor, setVersionsFor] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    api(`/integrations/modpacks/search?${qs({ source, query: debounced, limit: 20 })}`, { signal: ctrl.signal })
      .then(setData)
      .catch((err) => err.name !== 'AbortError' && setError(err))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [debounced, source]);

  return (
    <div className="stack">
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar modpacks (p. ej. Cobblemon, All the Mods, Fabulously…)" aria-label="Buscar modpacks" />
      {error &&
        (error.status === 409 ? (
          <div className="note">
            Para buscar modpacks de CurseForge agrega tu clave gratuita de CurseForge en <Link to="/ajustes">Ajustes del panel</Link>.
          </div>
        ) : (
          <div className="error-box">
            No se pudo buscar en {SITE_LABEL[source]}: {error.message}
          </div>
        ))}
      <div className="results" aria-busy={loading}>
        {data?.results.length === 0 && <p className="muted">Sin resultados.</p>}
        {data?.results.map((p) => (
          <article key={p.id} className="result">
            {p.icon ? <img src={p.icon} alt="" loading="lazy" /> : <div className="noicon" aria-hidden="true" />}
            <div style={{ minWidth: 0 }}>
              <h3>
                <a href={p.url} target="_blank" rel="noreferrer">
                  {p.title}
                </a>{' '}
                <span className="faint small" style={{ fontWeight: 400 }}>
                  de {p.author}
                </span>
              </h3>
              <p>{p.description}</p>
              <div className="faint small" style={{ marginTop: '0.2rem' }}>
                {formatNumber(p.downloads)} descargas · {p.loaders.map((l) => LOADER_LABEL[l] || l).join(', ')} · Minecraft {p.versions.join(', ')}
                {p.blocked && ' · se descarga a mano desde CurseForge'}
              </div>
            </div>
            <div>
              <button className="btn-sm btn-go" onClick={() => setVersionsFor(p)}>
                Elegir versión
              </button>
            </div>
          </article>
        ))}
      </div>
      {versionsFor && (
        <Versions
          source={source}
          project={versionsFor}
          onClose={() => setVersionsFor(null)}
          onPick={(version) => {
            setVersionsFor(null);
            onPick({ kind: 'store', source, project: versionsFor, version });
          }}
        />
      )}
    </div>
  );
}

function Versions({ source, project, onClose, onPick }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/integrations/modpacks/${project.id}/versions?${qs({ source })}`)
      .then(setList)
      .catch((err) => setError(err.message));
  }, [project.id, source]);
  return (
    <Modal title={`Versiones de ${project.title}`} onClose={onClose} wide>
      {error && <div className="error-box">{error}</div>}
      {!list && !error && <p className="muted">Cargando…</p>}
      {list?.length === 0 && <p className="muted">No hay versiones para Fabric, Forge o NeoForge.</p>}
      {source === 'curseforge' && list?.some((v) => !v.file) && (
        <p className="note">El autor de este modpack no permite descargarlo desde otras apps. Bájalo de CurseForge y súbelo en la pestaña Subir archivo.</p>
      )}
      {list?.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Versión</th>
                <th>Minecraft</th>
                <th>Loader</th>
                <th>Fecha</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id}>
                  <td>
                    {v.number} {v.type !== 'release' && <span className="faint">({v.type})</span>}
                  </td>
                  <td className="muted">{v.gameVersions.join(', ')}</td>
                  <td className="muted">{v.loaders.map((l) => LOADER_LABEL[l] || l).join(', ')}</td>
                  <td className="muted">{formatDate(v.date)}</td>
                  <td className="actions">
                    {v.file || source !== 'curseforge' ? (
                      <button className="btn-sm btn-go" onClick={() => onPick(v)}>
                        Usar esta
                      </button>
                    ) : (
                      <a className="btn btn-sm" href={v.externalUrl} target="_blank" rel="noreferrer" title="El autor no permite descargarlo desde otras apps: bájalo y súbelo en Subir archivo">
                        Bajar de CurseForge
                      </a>
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

function Upload({ onPick }) {
  const ref = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function inspect(file) {
    if (!file) return;
    setError('');
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const plan = await api('/integrations/modpacks/inspect', { method: 'POST', form });
      onPick({ kind: 'file', file, plan });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      ref.current.value = '';
    }
  }
  return (
    <div className="empty">
      <p className="muted" style={{ maxWidth: '65ch' }}>
        Sube el modpack: el archivo <span className="mono">.mrpack</span> de Modrinth o el <span className="mono">.zip</span> de CurseForge (el que se
        importa en el CurseForge App, no el "server pack"). Los de CurseForge necesitan tu clave de CurseForge en Ajustes del panel.
      </p>
      <button className="btn-go" disabled={busy} onClick={() => ref.current.click()}>
        {busy ? 'Revisando…' : 'Elegir archivo'}
      </button>
      <input ref={ref} type="file" accept=".mrpack,.zip" hidden onChange={(e) => inspect(e.target.files[0])} />
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}

function Confirm({ choice, onClose }) {
  const navigate = useNavigate();
  const { refresh } = useLive();
  const isFile = choice.kind === 'file';
  const title = isFile ? choice.plan.name : choice.project.title;
  const [name, setName] = useState(title.slice(0, 40));
  const [memoryGb, setMemoryGb] = useState(6);
  const [eula, setEula] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const summary = isFile
    ? `${choice.plan.format === 'curseforge' ? 'CurseForge · ' : ''}${TYPE_LABEL[choice.plan.type]} ${choice.plan.loaderVersion}, Minecraft ${choice.plan.mcVersion}, ${
        choice.plan.serverFiles
      } archivos${choice.plan.skippedClientFiles ? ` (${choice.plan.skippedClientFiles} solo de cliente se omiten)` : choice.plan.format === 'curseforge' ? ' (los que solo sirven en el juego se omiten al instalar)' : ''}`
    : `Versión ${choice.version.number}, Minecraft ${choice.version.gameVersions.join(', ')}, ${choice.version.loaders.map((l) => LOADER_LABEL[l] || l).join(', ')}`;

  async function create() {
    setBusy(true);
    setError('');
    const form = new FormData();
    form.append('name', name);
    form.append('memoryMb', String(Math.round(memoryGb * 1024)));
    form.append('eula', String(eula));
    if (isFile) form.append('file', choice.file);
    else {
      form.append('source', choice.source);
      form.append('projectId', choice.project.id);
      form.append('versionId', choice.version.id);
    }
    try {
      const r = await api('/integrations/modpacks/import', { method: 'POST', form });
      await refresh();
      navigate(`/servidor/${r.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Crear servidor con ${title}`} onClose={busy ? undefined : onClose}>
      <p className="muted small">{summary}</p>
      <label className="field">
        <span>Nombre del servidor</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </label>
      <label className="field">
        <span>Memoria RAM: {memoryGb} GB</span>
        <input type="range" min={2} max={16} step={0.5} value={memoryGb} onChange={(e) => setMemoryGb(Number(e.target.value))} style={{ padding: 0, minHeight: 28 }} />
        <span>Los modpacks grandes piden 6–8 GB. Revisa la página del modpack.</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={eula} onChange={(e) => setEula(e.target.checked)} />
        <span>
          Acepto el{' '}
          <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">
            EULA de Minecraft
          </a>
          .
        </span>
      </label>
      {error && <div className="error-box">{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-go" disabled={busy || !eula || !name.trim()} onClick={create}>
          {busy ? (isFile ? 'Subiendo…' : 'Descargando modpack…') : 'Crear e instalar'}
        </button>
      </div>
    </Modal>
  );
}
