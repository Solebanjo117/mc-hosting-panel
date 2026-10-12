import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs, formatDate, formatNumber, TYPE_LABEL } from '../api.js';
import { useLive } from '../live.jsx';
import { Modal } from '../ui.jsx';

const LOADER_LABEL = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };

export default function ImportModpack() {
  const [mode, setMode] = useState('buscar');
  const [choice, setChoice] = useState(null); // { kind: 'modrinth', project, version } | { kind: 'file', file, plan }

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div className="grow">
          <h1>Crear desde un modpack</h1>
          <p className="muted" style={{ marginTop: '0.4rem', maxWidth: '70ch' }}>
            El panel instala el loader y la versión de Minecraft que pide el modpack, descarga todos sus mods y copia su configuración. Los mods que solo
            sirven en el juego (shaders, minimapas) se omiten.
          </p>
        </div>
      </div>
      <div className="segmented" role="tablist" style={{ marginBottom: '1.25rem' }}>
        <button className={mode === 'buscar' ? 'on' : ''} onClick={() => setMode('buscar')} role="tab" aria-selected={mode === 'buscar'}>
          Buscar en Modrinth
        </button>
        <button className={mode === 'subir' ? 'on' : ''} onClick={() => setMode('subir')} role="tab" aria-selected={mode === 'subir'}>
          Subir archivo .mrpack
        </button>
      </div>
      {mode === 'buscar' ? <Search onPick={setChoice} /> : <Upload onPick={setChoice} />}
      {choice && <Confirm choice={choice} onClose={() => setChoice(null)} />}
    </div>
  );
}

function Search({ onPick }) {
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
    api(`/integrations/modpacks/search?${qs({ query: debounced, limit: 20 })}`, { signal: ctrl.signal })
      .then(setData)
      .catch((err) => err.name !== 'AbortError' && setError(err.message))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [debounced]);

  return (
    <div className="stack">
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar modpacks (p. ej. Cobblemon, All the Mods, Fabulously…)" aria-label="Buscar modpacks" />
      {error && <div className="error-box">No se pudo buscar en Modrinth: {error}</div>}
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
          project={versionsFor}
          onClose={() => setVersionsFor(null)}
          onPick={(version) => {
            setVersionsFor(null);
            onPick({ kind: 'modrinth', project: versionsFor, version });
          }}
        />
      )}
    </div>
  );
}

function Versions({ project, onClose, onPick }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/integrations/modpacks/${project.id}/versions`)
      .then(setList)
      .catch((err) => setError(err.message));
  }, [project.id]);
  return (
    <Modal title={`Versiones de ${project.title}`} onClose={onClose} wide>
      {error && <div className="error-box">{error}</div>}
      {!list && !error && <p className="muted">Cargando…</p>}
      {list?.length === 0 && <p className="muted">No hay versiones para Fabric, Forge o NeoForge.</p>}
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
                    <button className="btn-sm btn-go" onClick={() => onPick(v)}>
                      Usar esta
                    </button>
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
        Sube el archivo .mrpack del modpack (en Modrinth, botón de descarga de la versión). Los modpacks de CurseForge (.zip) no son compatibles; busca
        si el mismo modpack está en Modrinth.
      </p>
      <button className="btn-go" disabled={busy} onClick={() => ref.current.click()}>
        {busy ? 'Revisando…' : 'Elegir archivo .mrpack'}
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
    ? `${TYPE_LABEL[choice.plan.type]} ${choice.plan.loaderVersion}, Minecraft ${choice.plan.mcVersion}, ${choice.plan.serverFiles} archivos para el servidor${
        choice.plan.skippedClientFiles ? ` (${choice.plan.skippedClientFiles} solo de cliente se omiten)` : ''
      }`
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
