import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Confirm, Modal, useAction } from '../../ui.jsx';

/**
 * Comandos rápidos configurables. Una plantilla como "give {jugador} {objeto} {cantidad}"
 * se convierte en un formulario: jugadores conectados, buscador de objetos con su nombre en español, etc.
 */

export const TYPE_LABELS = {
  player: 'Jugador',
  item: 'Objeto o bloque',
  effect: 'Efecto',
  enchantment: 'Encantamiento',
  entity: 'Criatura o entidad',
  gamemode: 'Modo de juego',
  number: 'Número',
  text: 'Texto libre',
  select: 'Lista propia',
};

const GAMEMODES = [
  { id: 'survival', name: 'Supervivencia' },
  { id: 'creative', name: 'Creativo' },
  { id: 'adventure', name: 'Aventura' },
  { id: 'spectator', name: 'Espectador' },
];

const SELECTORS = [
  { id: '@p', name: 'El jugador más cercano' },
  { id: '@a', name: 'Todos los jugadores' },
  { id: '@r', name: 'Un jugador al azar' },
];

const PLACEHOLDER = /\{([a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ]{1,24})\}/g;
export const placeholders = (template) => [...new Set([...String(template).matchAll(PLACEHOLDER)].map((m) => m[1]))];

const fill = (template, values) => template.replace(PLACEHOLDER, (_, name) => (values[name] ?? '').toString().trim() || `{${name}}`);

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Las listas del juego se piden una vez por servidor y tipo.
const gameCache = new Map();
function loadGameData(serverId, kind) {
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

export default function QuickCommands({ server, running, players, onSend }) {
  const [data, setData] = useState(null);
  const [runCmd, setRunCmd] = useState(null);
  const [confirmCmd, setConfirmCmd] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api('/system/quick-commands')
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  const click = (c) => {
    if (c.params.length) setRunCmd(c);
    else if (c.confirm) setConfirmCmd(c);
    else onSend(c.template);
  };

  return (
    <div className="stack" style={{ gap: '0.4rem' }}>
      <div className="row" style={{ gap: '0.4rem' }}>
        <h3 className="muted grow" style={{ fontWeight: 500 }}>
          Comandos rápidos
        </h3>
        <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>
          Editar
        </button>
      </div>
      <div className="row" style={{ gap: '0.4rem' }}>
        {data.commands.map((c) => (
          <button key={c.id} className="btn-sm" disabled={!running} onClick={() => click(c)} title={c.template}>
            {c.label}
            {c.params.length ? '…' : ''}
          </button>
        ))}
        {!data.commands.length && <span className="faint small">No hay comandos. Pulsa Editar para agregar.</span>}
      </div>

      {runCmd && <RunCommand server={server} cmd={runCmd} players={players} onClose={() => setRunCmd(null)} onSend={onSend} />}
      {confirmCmd && (
        <Confirm
          title={confirmCmd.label}
          message={`Se enviará: ${confirmCmd.template}`}
          confirmLabel="Ejecutar"
          onClose={() => setConfirmCmd(null)}
          onConfirm={() => onSend(confirmCmd.template)}
        />
      )}
      {editing && <EditCommands data={data} onClose={() => setEditing(false)} onSaved={setData} />}
    </div>
  );
}

// --- Ejecutar un comando con huecos ----------------------------------------------

function RunCommand({ server, cmd, players, onClose, onSend }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(cmd.params.map((p) => [p.name, p.default || (p.type === 'player' && players.length === 1 ? players[0] : '')]))
  );
  const set = (name, v) => setValues((x) => ({ ...x, [name]: v }));
  const final = fill(cmd.template, values);
  const missing = cmd.params.filter((p) => !String(values[p.name] ?? '').trim());

  return (
    <Modal title={cmd.label} onClose={onClose} wide={cmd.params.some((p) => ['item', 'effect', 'enchantment', 'entity'].includes(p.type))}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (missing.length) return;
          onSend(final);
          onClose();
        }}
      >
        {cmd.params.map((p) => (
          <ParamField key={p.name} server={server} param={p} value={values[p.name] ?? ''} onChange={(v) => set(p.name, v)} players={players} />
        ))}
        <div className="address">
          <span style={{ overflowWrap: 'anywhere' }}>{final}</span>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-go" disabled={missing.length > 0}>
            {missing.length ? `Falta: ${missing.map((p) => p.name).join(', ')}` : 'Ejecutar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ParamField({ server, param, value, onChange, players }) {
  const label = (
    <span>
      {param.name} <span className="faint">· {TYPE_LABELS[param.type]}</span>
    </span>
  );
  if (param.type === 'player') {
    const listId = `players-${param.name}`;
    return (
      <div className="field">
        {label}
        <input value={value} onChange={(e) => onChange(e.target.value)} list={listId} placeholder="Nombre del jugador o @p, @a…" autoComplete="off" spellCheck={false} />
        <datalist id={listId}>
          {players.map((p) => (
            <option key={p} value={p} />
          ))}
          {SELECTORS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </datalist>
        <div className="row" style={{ gap: '0.3rem' }}>
          {players.map((p) => (
            <button type="button" key={p} className={`btn-sm${value === p ? ' btn-go' : ''}`} onClick={() => onChange(p)}>
              {p}
            </button>
          ))}
          {SELECTORS.map((s) => (
            <button type="button" key={s.id} className={`btn-sm${value === s.id ? ' btn-go' : ' btn-ghost'}`} title={s.name} onClick={() => onChange(s.id)}>
              {s.id}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (param.type === 'gamemode' || param.type === 'select') {
    const opts = param.type === 'gamemode' ? GAMEMODES : param.options.map((o) => ({ id: o, name: o }));
    return (
      <label className="field">
        {label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Elige…</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (param.type === 'number') {
    return (
      <label className="field">
        {label}
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 160 }} />
      </label>
    );
  }
  if (param.type === 'text') {
    return (
      <label className="field">
        {label}
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }
  return (
    <div className="field">
      {label}
      <GamePicker serverId={server.id} kind={param.type} value={value} onChange={onChange} />
    </div>
  );
}

function ItemIcon({ version, id }) {
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

function GamePicker({ serverId, kind, value, onChange }) {
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

// --- Editor de comandos ------------------------------------------------------------

const blank = () => ({ id: '', label: '', template: '', params: [], confirm: false });

function syncParams(cmd) {
  const names = placeholders(cmd.template);
  const prev = new Map(cmd.params.map((p) => [p.name, p]));
  return { ...cmd, params: names.map((name) => prev.get(name) || { name, type: guess(name), default: '', options: [] }) };
}

function guess(name) {
  const n = norm(name);
  if (/jugador|player|destino|objetivo|target/.test(n)) return 'player';
  if (/objeto|item|bloque|block/.test(n)) return 'item';
  if (/efecto|effect/.test(n)) return 'effect';
  if (/encant|enchant/.test(n)) return 'enchantment';
  if (/entidad|mob|entity|criatura/.test(n)) return 'entity';
  if (/modo|gamemode/.test(n)) return 'gamemode';
  if (/cantidad|numero|nivel|segundos|tiempo|amount|count/.test(n)) return 'number';
  return 'text';
}

function EditCommands({ data, onClose, onSaved }) {
  const [list, setList] = useState(() => data.commands.map((c) => ({ ...c, params: c.params.map((p) => ({ ...p })) })));
  const [open, setOpen] = useState(null);
  const [run, busy] = useAction();

  const update = (i, patch) => setList((l) => l.map((c, j) => (j === i ? syncParams({ ...c, ...patch }) : c)));
  const updateParam = (i, name, patch) =>
    setList((l) => l.map((c, j) => (j === i ? { ...c, params: c.params.map((p) => (p.name === name ? { ...p, ...patch } : p)) } : c)));
  const move = (i, d) =>
    setList((l) => {
      const n = [...l];
      const [x] = n.splice(i, 1);
      n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x);
      return n;
    });

  const save = (body) =>
    run(async () => {
      const r = await api('/system/quick-commands', { method: 'PUT', body });
      onSaved(r);
      onClose();
    }, 'Comandos rápidos guardados');

  return (
    <Modal title="Comandos rápidos" onClose={onClose} wide>
      <p className="muted small">
        Escribe el comando sin <span className="mono">/</span>. Para que el panel te pregunte un dato al usarlo, ponlo entre llaves: por ejemplo{' '}
        <span className="mono">give {'{jugador}'} {'{objeto}'} {'{cantidad}'}</span>. Luego elige qué tipo de dato es cada uno: con “Objeto” aparece un
        buscador con todos los objetos del juego; con “Jugador”, los que están conectados.
      </p>
      <div className="stack" style={{ gap: '0.5rem' }}>
        {list.map((c, i) => (
          <div key={c.id || `new-${i}`} className="qc-row">
            <div className="row" style={{ gap: '0.4rem', flexWrap: 'nowrap' }}>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} style={{ minWidth: 28 }}>
                {open === i ? '▾' : '▸'}
              </button>
              <input className="grow" value={c.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="Nombre del botón" maxLength={40} />
              <button type="button" className="btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                ↑
              </button>
              <button type="button" className="btn-ghost btn-sm" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                ↓
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label="Quitar">
                Quitar
              </button>
            </div>
            {open !== i && <div className="mono faint small qc-preview">{c.template || 'sin comando'}</div>}
            {open === i && (
              <div className="stack" style={{ gap: '0.6rem', marginTop: '0.6rem' }}>
                <label className="field">
                  <span>Comando</span>
                  <input className="mono" value={c.template} onChange={(e) => update(i, { template: e.target.value })} placeholder="give {jugador} {objeto} {cantidad}" spellCheck={false} />
                </label>
                {c.params.map((p) => (
                  <div key={p.name} className="grid-2" style={{ alignItems: 'end' }}>
                    <label className="field">
                      <span>
                        <span className="mono">{`{${p.name}}`}</span> es…
                      </span>
                      <select value={p.type} onChange={(e) => updateParam(i, p.name, { type: e.target.value })}>
                        {data.types.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {p.type === 'select' ? (
                      <label className="field">
                        <span>Opciones (separadas por coma)</span>
                        <input
                          value={Array.isArray(p.options) ? p.options.join(', ') : p.options}
                          onChange={(e) => updateParam(i, p.name, { options: e.target.value.split(',').map((x) => x.trimStart()) })}
                          placeholder="peaceful, easy, normal, hard"
                        />
                      </label>
                    ) : (
                      <label className="field">
                        <span>Valor inicial (opcional)</span>
                        <input value={p.default} onChange={(e) => updateParam(i, p.name, { default: e.target.value })} />
                      </label>
                    )}
                  </div>
                ))}
                <label className="row small" style={{ gap: '0.4rem' }}>
                  <input type="checkbox" checked={c.confirm} onChange={(e) => update(i, { confirm: e.target.checked })} />
                  Pedir confirmación antes de ejecutar
                </label>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <button
          type="button"
          onClick={() => {
            setList((l) => [...l, blank()]);
            setOpen(list.length);
          }}
          disabled={list.length >= 40}
        >
          Agregar comando
        </button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => save({ reset: true })}>
          Restaurar los de fábrica
        </button>
        <span className="grow" />
        <button type="button" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn-go"
          disabled={busy}
          onClick={() => save({ commands: list.map((c) => ({ ...c, params: c.params.map((p) => ({ ...p, options: Array.isArray(p.options) ? p.options.map((o) => o.trim()).filter(Boolean) : p.options })) })) })}
        >
          Guardar
        </button>
      </div>
    </Modal>
  );
}
