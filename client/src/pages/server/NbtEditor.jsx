import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../../api.js';
import { Modal } from '../../ui.jsx';

/**
 * Editor de archivos NBT (level.dat, datos de jugadores, estructuras).
 * Permite cambiar valores y borrar entradas; las listas largas de números se muestran resumidas.
 */

const TYPE_LABEL = {
  byte: 'byte',
  short: 'short',
  int: 'int',
  long: 'long',
  float: 'float',
  double: 'double',
  string: 'texto',
  list: 'lista',
  compound: 'grupo',
  byte_array: 'bytes',
  int_array: 'enteros',
  long_array: 'longs',
};

// Explicaciones de los campos que más se editan.
const HINTS = {
  LevelName: 'Nombre del mundo',
  GameType: 'Modo de juego por defecto: 0 supervivencia, 1 creativo, 2 aventura, 3 espectador',
  Difficulty: '0 pacífico, 1 fácil, 2 normal, 3 difícil',
  DifficultyLocked: '1 = dificultad bloqueada',
  hardcore: '1 = hardcore',
  allowCommands: '1 = trucos permitidos',
  DayTime: 'Hora del día en ticks (0 amanecer, 6000 mediodía, 13000 noche)',
  Time: 'Ticks totales desde que se creó el mundo',
  SpawnX: 'Punto de aparición X',
  SpawnY: 'Punto de aparición Y',
  SpawnZ: 'Punto de aparición Z',
  raining: '1 = está lloviendo',
  thundering: '1 = hay tormenta',
  rainTime: 'Ticks hasta que cambie la lluvia',
  clearWeatherTime: 'Ticks de clima despejado forzado',
  Pos: 'Posición del jugador [X, Y, Z]',
  Rotation: 'Hacia dónde mira [giro, inclinación]',
  Health: 'Vida (20 = 10 corazones)',
  foodLevel: 'Hambre (20 = llena)',
  foodSaturationLevel: 'Saturación',
  XpLevel: 'Nivel de experiencia',
  XpTotal: 'Experiencia total',
  playerGameType: 'Modo de juego del jugador: 0 supervivencia, 1 creativo, 2 aventura, 3 espectador',
  Dimension: 'Dimensión (minecraft:overworld, minecraft:the_nether, minecraft:the_end)',
  Inventory: 'Inventario: cada objeto tiene id, cantidad y espacio (Slot)',
  EnderItems: 'Cofre de Ender',
  SelectedItemSlot: 'Espacio seleccionado en la barra (0 a 8)',
  Air: 'Aire bajo el agua (300 = lleno)',
  Fire: 'Ticks que le quedan ardiendo (-20 = no arde)',
  OnGround: '1 = está en el suelo',
  abilities: 'Habilidades: volar, invulnerable, etc.',
  mayfly: '1 = puede volar',
  flying: '1 = está volando',
  invulnerable: '1 = no recibe daño',
  Count: 'Cantidad',
  count: 'Cantidad',
  Slot: 'Espacio del inventario',
  id: 'Identificador',
};

const isNumeric = (t) => ['byte', 'short', 'int', 'long', 'float', 'double'].includes(t);
const isArray = (t) => ['byte_array', 'int_array', 'long_array'].includes(t);

function setIn(node, pathArr, updater) {
  if (!pathArr.length) return updater(node);
  const [k, ...rest] = pathArr;
  const copy = { ...node, value: [...node.value] };
  copy.value[k] = setIn(node.value[k], rest, updater);
  return copy;
}

function removeIn(node, pathArr) {
  const parent = pathArr.slice(0, -1);
  const idx = pathArr.at(-1);
  return setIn(node, parent, (n) => ({ ...n, value: n.value.filter((_, i) => i !== idx) }));
}

function Value({ node, onChange }) {
  if (node.type === 'byte' && (node.value === 0 || node.value === 1)) {
    return (
      <span className="row" style={{ gap: '0.4rem', flexWrap: 'nowrap' }}>
        <input type="checkbox" checked={node.value === 1} onChange={(e) => onChange(e.target.checked ? 1 : 0)} aria-label="Valor" />
        <input className="nbt-input" value={node.value} onChange={(e) => onChange(e.target.value)} style={{ width: 70 }} aria-label="Valor" />
      </span>
    );
  }
  if (isNumeric(node.type)) {
    return <input className="nbt-input mono" inputMode="decimal" value={node.value} onChange={(e) => onChange(e.target.value)} aria-label="Valor" />;
  }
  if (node.type === 'string') {
    return <input className="nbt-input" value={node.value} onChange={(e) => onChange(e.target.value)} style={{ width: 'min(100%, 420px)' }} aria-label="Valor" />;
  }
  return null;
}

function Node({ node, name, pathArr, depth, onEdit, onRemove, filter }) {
  const [open, setOpen] = useState(depth < 2);
  const container = node.type === 'compound' || node.type === 'list';
  const children = container ? node.value : null;
  const label = name ?? (pathArr.length ? `#${pathArr.at(-1)}` : 'raíz');
  const hint = typeof name === 'string' ? HINTS[name] : null;

  if (filter && !container && !(String(name ?? '').toLowerCase().includes(filter) || String(node.value).toLowerCase().includes(filter))) return null;

  return (
    <li className="nbt-node">
      <div className="nbt-row">
        {container || isArray(node.type) ? (
          <button className="nbt-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Contraer' : 'Expandir'}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="nbt-toggle" />
        )}
        <span className="nbt-key" title={hint || undefined}>
          {label}
        </span>
        <span className="nbt-type">{node.type === 'list' ? `lista de ${TYPE_LABEL[node.listType] || node.listType}` : TYPE_LABEL[node.type]}</span>
        {container && <span className="faint small">{children.length} elementos</span>}
        {isArray(node.type) && <span className="faint small">{node.value.length} valores</span>}
        {!container && !isArray(node.type) && <Value node={node} onChange={(v) => onEdit(pathArr, v)} />}
        {pathArr.length > 0 && (
          <button className="btn-sm btn-ghost nbt-del" onClick={() => onRemove(pathArr)} title="Borrar esta entrada" aria-label={`Borrar ${label}`}>
            ✕
          </button>
        )}
      </div>
      {hint && <div className="nbt-hint">{hint}</div>}
      {open && isArray(node.type) && (
        <div className="nbt-array mono small">
          {node.value.slice(0, 256).join(', ')}
          {node.value.length > 256 ? ` … (${node.value.length - 256} más)` : ''}
        </div>
      )}
      {open && container && (
        <ul className="nbt-children">
          {children.map((child, i) => (
            <Node
              key={i}
              node={child}
              name={node.type === 'compound' ? child.name : undefined}
              pathArr={[...pathArr, i]}
              depth={depth + 1}
              onEdit={onEdit}
              onRemove={onRemove}
              filter={filter}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function NbtEditor({ serverId, path, title, running, onClose, onSaved }) {
  const [doc, setDoc] = useState(null);
  const [tree, setTree] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api(`/servers/${serverId}/files/nbt?${qs({ path })}`)
      .then((d) => {
        setDoc(d);
        setTree(d.root);
      })
      .catch((err) => setError(err.message));
  }, [serverId, path]);

  const edit = (pathArr, value) => {
    setTree((t) => setIn(t, pathArr, (n) => ({ ...n, value })));
    setDirty(true);
  };
  const remove = (pathArr) => {
    setTree((t) => removeIn(t, pathArr));
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api(`/servers/${serverId}/files/nbt`, { method: 'PUT', body: { path, compression: doc.compression, rootName: doc.rootName, root: tree } });
      setDirty(false);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const f = useMemo(() => filter.trim().toLowerCase(), [filter]);

  return (
    <Modal title={title || path} onClose={() => (!dirty || confirm('¿Descartar los cambios?')) && onClose()} wide>
      {running && <p className="note">El servidor está encendido: puedes ver los datos, pero para guardar tienes que apagarlo (el servidor sobrescribe estos archivos).</p>}
      {error && <div className="error-box">{error}</div>}
      {!tree && !error && <p className="muted">Leyendo…</p>}
      {tree && (
        <>
          <div className="row">
            <input className="grow" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por nombre o valor" aria-label="Filtrar" />
            <span className="faint small">
              Formato {doc.compression === 'none' ? 'sin comprimir' : doc.compression}
            </span>
          </div>
          <ul className="nbt-tree">
            <Node node={tree} name={doc.rootName || undefined} pathArr={[]} depth={0} onEdit={edit} onRemove={remove} filter={f} />
          </ul>
        </>
      )}
      <div className="row">
        <span className="faint small grow">Antes de guardar se crea una copia del original con la extensión .panel-bak.</span>
        <button onClick={onClose}>Cerrar</button>
        <button className="btn-go" disabled={!dirty || saving || running} onClick={save}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </Modal>
  );
}
