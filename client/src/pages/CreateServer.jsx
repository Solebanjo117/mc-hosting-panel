import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useLive } from '../live.jsx';

const TYPES = [
  { id: 'paper', label: 'Paper', text: 'Plugins Bukkit/Spigot/Paper. La mejor opción para un servidor con amigos.' },
  { id: 'fabric', label: 'Fabric', text: 'Mods ligeros y de optimización. Se actualiza rápido.' },
  { id: 'neoforge', label: 'NeoForge', text: 'Mods grandes en versiones modernas (1.20.2 en adelante).' },
  { id: 'forge', label: 'Forge', text: 'Mods y modpacks clásicos, incluidas versiones antiguas.' },
  { id: 'vanilla', label: 'Vanilla', text: 'El servidor oficial, sin cambios. Admite datapacks.' },
];

export default function CreateServer() {
  const navigate = useNavigate();
  const { refresh } = useLive();
  const [type, setType] = useState('paper');
  const [versions, setVersions] = useState(null);
  const [versionsError, setVersionsError] = useState('');
  const [mcVersion, setMcVersion] = useState('');
  const [loaderVersion, setLoaderVersion] = useState('');
  const [name, setName] = useState('');
  const [memoryGb, setMemoryGb] = useState(4);
  const [port, setPort] = useState('');
  const [eula, setEula] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [totalGb, setTotalGb] = useState(16);

  useEffect(() => {
    api('/system/info')
      .then((i) => setTotalGb(Math.max(2, Math.floor(i.system.totalMemMb / 1024))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setVersions(null);
    setVersionsError('');
    setMcVersion('');
    api(`/system/versions/${type}`)
      .then((list) => {
        setVersions(list);
        setMcVersion(list[0]?.id || '');
      })
      .catch((err) => setVersionsError(err.message));
  }, [type]);

  const loaders = useMemo(() => versions?.find((v) => v.id === mcVersion)?.loaders || [], [versions, mcVersion]);
  useEffect(() => setLoaderVersion(loaders[0]?.version || ''), [loaders]);

  const needsLoader = type === 'forge' || type === 'neoforge';

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const server = await api('/servers', {
        method: 'POST',
        body: {
          name,
          type,
          mcVersion,
          loaderVersion: needsLoader ? loaderVersion : null,
          memoryMb: Math.round(memoryGb * 1024),
          port: port ? Number(port) : undefined,
          eula,
        },
      });
      await refresh();
      navigate(`/servidor/${server.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div className="page-head">
        <h1>Crear servidor</h1>
      </div>

      <form className="stack" style={{ gap: '1.75rem' }} onSubmit={submit}>
        <section className="stack" style={{ gap: '0.7rem' }}>
          <h2>Tipo de servidor</h2>
          <div className="type-grid" role="radiogroup">
            {TYPES.map((t) => (
              <button
                type="button"
                key={t.id}
                role="radio"
                aria-checked={type === t.id}
                className={`type-option${type === t.id ? ' on' : ''}`}
                onClick={() => setType(t.id)}
              >
                <strong>{t.label}</strong>
                <span>{t.text}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="grid-2">
          <label className="field">
            <span>Nombre</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Survival con los primos" maxLength={40} required />
          </label>
          <label className="field">
            <span>Versión de Minecraft</span>
            {versionsError ? (
              <div className="error-box">No se pudo cargar la lista: {versionsError}</div>
            ) : (
              <select value={mcVersion} onChange={(e) => setMcVersion(e.target.value)} disabled={!versions} required>
                {!versions && <option>Cargando versiones…</option>}
                {versions?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                  </option>
                ))}
              </select>
            )}
          </label>
          {needsLoader && (
            <label className="field">
              <span>Versión de {type === 'forge' ? 'Forge' : 'NeoForge'}</span>
              <select value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)} required disabled={!loaders.length}>
                {loaders.map((l) => (
                  <option key={l.version} value={l.version}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Memoria RAM: {memoryGb} GB</span>
            <input
              type="range"
              min={1}
              max={Math.max(2, totalGb - 2)}
              step={0.5}
              value={memoryGb}
              onChange={(e) => setMemoryGb(Number(e.target.value))}
              style={{ padding: 0, minHeight: 28 }}
            />
            <span>
              {type === 'paper' || type === 'vanilla' ? '2–4 GB alcanzan para unos 10 jugadores.' : 'Con mods se recomiendan 6 GB o más.'} Deja
              memoria libre para Windows.
            </span>
          </label>
          <label className="field">
            <span>Puerto (opcional)</span>
            <input type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(e.target.value)} placeholder="Automático (25565, 25566…)" />
            <span>Es el puerto que vas a abrir en el router.</span>
          </label>
        </section>

        <label className="check">
          <input type="checkbox" checked={eula} onChange={(e) => setEula(e.target.checked)} required />
          <span>
            Acepto el{' '}
            <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">
              EULA de Minecraft
            </a>
            . Es obligatorio para ejecutar cualquier servidor.
          </span>
        </label>

        {error && <div className="error-box">{error}</div>}

        <div className="row">
          <button className="btn-go" disabled={busy || !eula || !mcVersion || (needsLoader && !loaderVersion)} style={{ minHeight: 40 }}>
            {busy ? 'Creando…' : 'Crear e instalar'}
          </button>
          <span className="muted small">La descarga puede tardar unos minutos según tu internet.</span>
        </div>
      </form>
    </div>
  );
}
