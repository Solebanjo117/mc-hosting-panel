import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';

/** Listas del juego (objetos, efectos…) con nombre en español, íconos y buscador. Se usan en comandos e inventarios. */

export const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

// Las listas se piden una vez por servidor y tipo.
const gameCache = new Map();
export function loadGameData(serverId, kind) {
  const key = `${serverId}:${kind}`;
  if (!gameCache.has(key)) {
    const p = api(`/servers/${serverId}/gamedata/${kind}`).catch((err) => {
      gameCache.delete(key);
      throw err;
    });
    gameCache.set(key, p);
  }
  return gameCache.get(key);
}

/** Hook: { data, error } con la lista del juego. */
export function useGameList(serverId, kind) {
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    let alive = true;
    loadGameData(serverId, kind)
      .then((data) => alive && setState({ data, error: '' }))
      .catch((err) => alive && setState({ data: null, error: err.message }));
    return () => {
      alive = false;
    };
  }, [serverId, kind]);
  return state;
}

export const bareId = (id) => String(id || '').replace(/^minecraft:/, '');

export function ItemIcon({ version, id }) {
  const [step, setStep] = useState(0);
  if (step > 1) return <span className="picker-icon" aria-hidden="true" />;
  const folder = step === 0 ? 'item' : 'block';
  return (
    <img
      className="picker-icon"
      src={`https://raw.githubusercontent.com/misode/mcmeta/${version}-assets/assets/minecraft/textures/${folder}/${id}.png`}
      alt=""
      loading="lazy"
      onError={() => setStep((s) => s + 1)}
    />
  );
}

export function GamePicker({ serverId, kind, value, onChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    loadGameData(serverId, kind)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [serverId, kind]);

  const results = useMemo(() => {
    if (!data) return [];
    const words = norm(q).split(/\s+/).filter(Boolean);
    const list = words.length ? data.list.filter((x) => words.every((w) => norm(x.name).includes(w) || x.id.includes(w))) : data.list;
    return list.slice(0, 80);
  }, [data, q]);

  const selected = data?.list.find((x) => x.id === value);
  const raw = q.trim().toLowerCase().replace(/\s+/g, '_');

  return (
    <div className="stack" style={{ gap: '0.4rem' }}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={kind === 'item' ? 'Busca: diamante, espada, cama…' : 'Escribe para buscar…'}
        autoComplete="off"
        spellCheck={false}
      />
      {value && (
        <div className="small">
          Elegido: <strong>{selected?.name || value}</strong> <span className="mono faint">{value}</span>
        </div>
      )}
      {error && (
        <div className="note small">
          No se pudo cargar la lista ({error}). Escribe el ID a mano, por ejemplo <span className="mono">diamond_sword</span>, y pulsa “Usar tal cual”.
        </div>
      )}
      {!data && !error && <p className="faint small">Cargando la lista del juego…</p>}
      {(data || error) && (
        <div className="picker-list" role="listbox">
          {results.map((x) => (
            <button
              type="button"
              key={x.id}
              role="option"
              aria-selected={x.id === value}
              className={`picker-item${x.id === value ? ' on' : ''}`}
              onClick={() => onChange(x.id)}
            >
              {kind === 'item' && <ItemIcon version={data.version} id={x.id} />}
              <span className="grow">{x.name || x.id}</span>
              <span className="mono faint small">{x.id}</span>
            </button>
          ))}
          {raw && /^[a-z0-9_.:/-]+$/.test(raw) && !data?.list.some((x) => x.id === raw) && (
            <button type="button" className="picker-item" onClick={() => onChange(raw)}>
              <span className="grow">
                Usar <span className="mono">{raw}</span> tal cual
              </span>
              <span className="faint small">para mods: modid:objeto</span>
            </button>
          )}
          {data && !results.length && !raw && <p className="faint small" style={{ padding: '0.5rem' }}>Sin resultados.</p>}
        </div>
      )}
    </div>
  );
}

