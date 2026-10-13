import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Modal, useAction } from '../../ui.jsx';
import { bareId, GamePicker, ItemIcon, useGameList } from './gameData.jsx';

/**
 * Inventario de un jugador como en el juego: armadura, mano secundaria, inventario,
 * barra rápida y cofre de Ender. Lee y escribe el archivo playerdata/<uuid>.dat (NBT).
 *
 * Formatos que maneja:
 *  - Inventory: lista de objetos con Slot (0-8 barra, 9-35 inventario, 100-103 armadura, -106 mano secundaria).
 *  - Desde 1.21.5 la armadura y la mano secundaria están en el compuesto "equipment".
 *  - Cantidad: "count" (int, 1.20.5+) o "Count" (byte, versiones anteriores).
 */

const ARMOR = [
  { slot: 103, key: 'head', label: 'Casco' },
  { slot: 102, key: 'chest', label: 'Peto' },
  { slot: 101, key: 'legs', label: 'Pantalones' },
  { slot: 100, key: 'feet', label: 'Botas' },
];
const OFFHAND = { slot: -106, key: 'offhand', label: 'Mano secundaria' };
const EQUIP_KEYS = Object.fromEntries([...ARMOR, OFFHAND].map((a) => [a.slot, a.key]));
const BASE_KEYS = new Set(['Slot', 'id', 'count', 'Count']);

const entry = (compound, name) => compound?.value?.find((e) => e.name === name);

function versionAtLeast(v, target) {
  const a = String(v).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const b = target.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i];
  return true;
}

/** Objeto NBT (compuesto) → { id, count, extra } */
function readItem(compound) {
  const fields = compound.value;
  const id = fields.find((e) => e.name === 'id')?.value;
  const c = fields.find((e) => e.name === 'count' || e.name === 'Count');
  return { id: bareId(id), count: Number(c?.value ?? 1), extra: fields.filter((e) => !BASE_KEYS.has(e.name)) };
}

function readAll(root, version) {
  const inv = entry(root, 'Inventory');
  const ender = entry(root, 'EnderItems');
  const equipment = entry(root, 'equipment');
  const items = {};
  const enderItems = {};
  let countField = null;
  for (const el of inv?.value || []) {
    const slot = el.value.find((e) => e.name === 'Slot')?.value;
    if (slot === undefined) continue;
    items[slot] = readItem(el);
    countField ||= el.value.find((e) => e.name === 'count' || e.name === 'Count');
  }
  for (const el of ender?.value || []) {
    const slot = el.value.find((e) => e.name === 'Slot')?.value;
    if (slot !== undefined) enderItems[slot] = readItem(el);
  }
  // 1.21.5+: armadura y mano secundaria van aparte.
  const equipExtra = [];
  for (const e of equipment?.value || []) {
    const slot = Object.entries(EQUIP_KEYS).find(([, k]) => k === e.name)?.[0];
    if (slot !== undefined && e.type === 'compound') items[Number(slot)] = readItem(e);
    else equipExtra.push(e);
  }
  const modern = versionAtLeast(version, '1.20.5');
  return {
    items,
    enderItems,
    useEquipment: Boolean(equipment) || versionAtLeast(version, '1.21.5'),
    equipExtra,
    count: countField ? { name: countField.name, type: countField.type } : modern ? { name: 'count', type: 'int' } : { name: 'Count', type: 'byte' },
  };
}

function itemFields(item, count, slot) {
  const fields = [];
  if (slot !== undefined) fields.push({ name: 'Slot', type: 'byte', value: slot });
  fields.push({ name: 'id', type: 'string', value: item.id.includes(':') ? item.id : `minecraft:${item.id}` });
  fields.push({ name: count.name, type: count.type, value: Math.max(1, Math.min(99, Number(item.count) || 1)) });
  return [...fields, ...(item.extra || [])];
}

function writeAll(root, state) {
  const value = root.value.filter((e) => !['Inventory', 'EnderItems', ...(state.useEquipment ? ['equipment'] : [])].includes(e.name));
  const inventorySlots = Object.keys(state.items)
    .map(Number)
    .filter((s) => !(state.useEquipment && EQUIP_KEYS[s]))
    .sort((a, b) => a - b);
  value.push({
    name: 'Inventory',
    type: 'list',
    listType: inventorySlots.length ? 'compound' : 'end',
    value: inventorySlots.map((s) => ({ type: 'compound', value: itemFields(state.items[s], state.count, s) })),
  });
  const enderSlots = Object.keys(state.enderItems)
    .map(Number)
    .sort((a, b) => a - b);
  value.push({
    name: 'EnderItems',
    type: 'list',
    listType: enderSlots.length ? 'compound' : 'end',
    value: enderSlots.map((s) => ({ type: 'compound', value: itemFields(state.enderItems[s], state.count, s) })),
  });
  if (state.useEquipment) {
    const equip = [...state.equipExtra];
    for (const [slot, key] of Object.entries(EQUIP_KEYS)) {
      const item = state.items[slot];
      if (item) equip.push({ name: key, type: 'compound', value: itemFields(item, state.count) });
    }
    value.push({ name: 'equipment', type: 'compound', value: equip });
  }
  return { ...root, value };
}

export default function InventoryEditor({ serverId, version, path, title, running, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('inv');
  const [selected, setSelected] = useState(null); // { where: 'items'|'enderItems', slot }
  const [picking, setPicking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [run, busy] = useAction();
  const { data: names } = useGameList(serverId, 'item');
  const nameOf = useMemo(() => {
    const map = new Map((names?.list || []).map((x) => [x.id, x.name]));
    return (id) => map.get(id) || id;
  }, [names]);

  useEffect(() => {
    api(`/servers/${serverId}/files/nbt?path=${encodeURIComponent(path)}`)
      .then((f) => {
        setFile(f);
        setState(readAll(f.root, version));
      })
      .catch((err) => setError(err.message));
  }, [serverId, path, version]);

  const where = tab === 'inv' ? 'items' : 'enderItems';
  const sel = selected && state?.[selected.where]?.[selected.slot];

  const change = (fn) => {
    setState((s) => {
      const next = { ...s, items: { ...s.items }, enderItems: { ...s.enderItems } };
      fn(next);
      return next;
    });
    setDirty(true);
  };

  const move = (from, to) => {
    if (from.where === to.where && from.slot === to.slot) return;
    change((s) => {
      const a = s[from.where][from.slot];
      const b = s[to.where][to.slot];
      if (b) s[from.where][from.slot] = b;
      else delete s[from.where][from.slot];
      if (a) s[to.where][to.slot] = a;
    });
    setSelected(to);
  };

  const slotEl = (slot, label, small) => {
    const item = state[where][slot];
    const isSel = selected?.where === where && selected.slot === slot;
    return (
      <button
        key={`${where}-${slot}`}
        type="button"
        className={`inv-slot${isSel ? ' on' : ''}${small ? ' small' : ''}`}
        title={item ? `${nameOf(item.id)} ×${item.count}` : label || 'Vacío'}
        draggable={Boolean(item)}
        onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ where, slot }))}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          try {
            move(JSON.parse(e.dataTransfer.getData('text/plain')), { where, slot });
          } catch {
            /* nada que mover */
          }
        }}
        onClick={() => {
          setSelected({ where, slot });
          setPicking(!item);
        }}
      >
        {item ? (
          <>
            <ItemIcon version={version} id={item.id} />
            {item.count > 1 && <span className="inv-count">{item.count}</span>}
            {item.extra.length > 0 && <span className="inv-extra" aria-label="Con datos extra" />}
          </>
        ) : (
          label && <span className="inv-label">{label}</span>
        )}
      </button>
    );
  };

  const save = () =>
    run(async () => {
      await api(`/servers/${serverId}/files/nbt`, {
        method: 'PUT',
        body: { path, compression: file.compression, rootName: file.rootName, root: writeAll(file.root, state) },
      });
      setDirty(false);
      onSaved?.();
    }, 'Inventario guardado (se dejó una copia .panel-bak)');

  return (
    <Modal title={title} onClose={onClose} wide>
      {error && <div className="error-box">{error}</div>}
      {!state && !error && <p className="muted">Cargando…</p>}
      {state && (
        <div className="stack">
          {running && <p className="note">Apaga el servidor para guardar cambios. Mientras está encendido, el servidor reescribe este archivo.</p>}
          <div className="segmented" role="tablist">
            <button type="button" className={tab === 'inv' ? 'on' : ''} onClick={() => (setTab('inv'), setSelected(null))}>
              Inventario
            </button>
            <button type="button" className={tab === 'ender' ? 'on' : ''} onClick={() => (setTab('ender'), setSelected(null))}>
              Cofre de Ender
            </button>
          </div>

          <div className="inv-layout">
            <div className="inv-panel">
              {tab === 'inv' ? (
                <>
                  <div className="inv-top">
                    <div className="inv-armor">
                      {ARMOR.map((a) => slotEl(a.slot, a.label))}
                    </div>
                    <div className="inv-offhand">
                      {slotEl(OFFHAND.slot, 'Mano 2')}
                    </div>
                  </div>
                  <div className="inv-grid">
                    {Array.from({ length: 27 }, (_, i) => slotEl(i + 9))}
                  </div>
                  <div className="inv-grid inv-hotbar">
                    {Array.from({ length: 9 }, (_, i) => slotEl(i))}
                  </div>
                </>
              ) : (
                <div className="inv-grid">
                  {Array.from({ length: 27 }, (_, i) => slotEl(i))}
                </div>
              )}
              <p className="faint small" style={{ marginTop: '0.6rem' }}>
                Arrastra para mover. Toca una casilla para cambiarla.
              </p>
            </div>

            <div className="inv-side stack" style={{ gap: '0.6rem' }}>
              {!selected && <p className="muted small">Elige una casilla para ver o cambiar el objeto.</p>}
              {selected && sel && !picking && (
                <>
                  <div className="row" style={{ gap: '0.6rem', flexWrap: 'nowrap' }}>
                    <ItemIcon version={version} id={sel.id} />
                    <div>
                      <strong>{nameOf(sel.id)}</strong>
                      <div className="mono faint small">{sel.id}</div>
                    </div>
                  </div>
                  {sel.extra.length > 0 && (
                    <p className="faint small">Tiene datos extra (encantamientos, nombre, durabilidad…). Se conservan; edítalos con “Editar datos”.</p>
                  )}
                  <label className="field">
                    <span>Cantidad</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={sel.count}
                      onChange={(e) =>
                        change((s) => {
                          s[selected.where][selected.slot] = { ...sel, count: Math.max(1, Math.min(99, Number(e.target.value) || 1)) };
                        })
                      }
                      style={{ maxWidth: 120 }}
                    />
                  </label>
                  <div className="row">
                    <button type="button" onClick={() => setPicking(true)}>
                      Cambiar objeto
                    </button>
                    <button
                      type="button"
                      className="btn-stop"
                      onClick={() =>
                        change((s) => {
                          delete s[selected.where][selected.slot];
                        })
                      }
                    >
                      Quitar
                    </button>
                  </div>
                </>
              )}
              {selected && (picking || !sel) && (
                <>
                  <strong className="small">{sel ? 'Cambiar por…' : 'Poner un objeto en esta casilla'}</strong>
                  <GamePicker
                    serverId={serverId}
                    kind="item"
                    value=""
                    onChange={(id) => {
                      change((s) => {
                        const prev = s[selected.where][selected.slot];
                        // Si cambias el objeto, sus datos extra (encantamientos de otro objeto…) ya no aplican.
                        s[selected.where][selected.slot] = { id, count: prev?.count || 1, extra: [] };
                      });
                      setPicking(false);
                    }}
                  />
                  {sel && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setPicking(false)}>
                      Cancelar
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}>
              Cerrar
            </button>
            <button type="button" className="btn-go" disabled={running || busy || !dirty} onClick={save}>
              Guardar inventario
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
