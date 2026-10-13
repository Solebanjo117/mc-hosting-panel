import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatBytes, formatDate } from '../../api.js';
import { Confirm, Modal, PlayerHead, useAction, useToast } from '../../ui.jsx';
import NbtEditor from './NbtEditor.jsx';
import InventoryEditor from './InventoryEditor.jsx';

export default function WorldsTab({ server, state }) {
  const [data, setData] = useState(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [nbt, setNbt] = useState(null);
  const [playersOf, setPlayersOf] = useState(null);
  const [inventory, setInventory] = useState(null);
  const fileRef = useRef(null);
  const [run, busy] = useAction();
  const toast = useToast();
  const on = ['running', 'starting', 'stopping'].includes(state);
  const base = `/servers/${server.id}/worlds`;

  const load = useCallback(() => api(base).then(setData), [base]);
  useEffect(() => {
    load().catch((err) => toast(err.message, 'error'));
  }, [load, toast]);

  async function upload(file) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('activate', 'false');
    setUploading(true);
    try {
      const r = await api(`${base}/import`, { method: 'POST', form });
      setData(r);
      toast(`Mundo "${r.imported}" importado. Actívalo con "Usar este mundo".`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
      fileRef.current.value = '';
    }
  }

  if (!data) return <p className="muted">Cargando…</p>;

  return (
    <div className="stack" style={{ gap: '1.25rem', maxWidth: 960 }}>
      {on && <p className="note">Apaga el servidor para cambiar, crear, importar o borrar mundos. Puedes descargar el mundo mientras está encendido.</p>}
      <div className="row">
        <button className="btn-go" disabled={on || busy} onClick={() => setCreating(true)}>
          Crear mundo nuevo
        </button>
        <button disabled={on || uploading} onClick={() => fileRef.current.click()}>
          {uploading ? 'Subiendo…' : 'Importar mundo (.zip)'}
        </button>
        <input ref={fileRef} type="file" accept=".zip" hidden onChange={(e) => upload(e.target.files[0])} />
        <span className="muted small">El servidor usa un mundo a la vez; los demás quedan guardados.</span>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Mundo</th>
              <th>Tamaño</th>
              <th>Último guardado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.worlds.map((w) => (
              <tr key={w.name}>
                <td>
                  <span style={{ fontWeight: w.active ? 600 : 400 }}>{w.name}</span>{' '}
                  {w.active && <span className="chip">En uso</span>}
                  {!w.generated && <span className="faint small"> Se genera al encender{data.seed ? ` (semilla ${data.seed})` : ''}</span>}
                </td>
                <td className="muted">{w.generated ? formatBytes(w.size) : '—'}</td>
                <td className="muted">{formatDate(w.mtime) || '—'}</td>
                <td className="actions">
                  {!w.active && w.generated && (
                    <button
                      className="btn-sm btn-go"
                      disabled={on || busy}
                      onClick={() => run(() => api(`${base}/switch`, { method: 'POST', body: { name: w.name } }).then(setData), `Ahora se usa "${w.name}"`)}
                    >
                      Usar este mundo
                    </button>
                  )}{' '}
                  {w.generated && (
                    <>
                      <button className="btn-sm" onClick={() => setNbt({ path: `${w.name}/level.dat`, title: `${w.name}: configuración del mundo (level.dat)` })}>
                        Editar datos
                      </button>{' '}
                      <button className="btn-sm" onClick={() => setPlayersOf(w.name)}>
                        Jugadores
                      </button>{' '}
                    </>
                  )}
                  {w.generated && (
                    <a className="btn btn-sm" href={`/api${base}/${encodeURIComponent(w.name)}/download`}>
                      Descargar
                    </a>
                  )}{' '}
                  {!w.active && (
                    <button className="btn-sm btn-stop" disabled={on} onClick={() => setConfirm(w)}>
                      Borrar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="faint small">
        Para regenerar el mundo con otra semilla sin perder el actual, crea un mundo nuevo: el anterior se conserva y puedes volver a él cuando quieras.
        Haz un respaldo antes de borrar.
      </p>

      {nbt && <NbtEditor serverId={server.id} path={nbt.path} title={nbt.title} running={on} onClose={() => setNbt(null)} onSaved={() => toast('Guardado (se dejó una copia .panel-bak)')} />}
      {playersOf && (
        <PlayerData
          serverId={server.id}
          world={playersOf}
          onClose={() => setPlayersOf(null)}
          onOpen={(p) => {
            setPlayersOf(null);
            setNbt({ path: p.path, title: `Datos de ${p.name || p.uuid}` });
          }}
          onInventory={(p) => {
            setPlayersOf(null);
            setInventory({ path: p.path, title: `Inventario de ${p.name || p.uuid}` });
          }}
        />
      )}
      {inventory && (
        <InventoryEditor
          serverId={server.id}
          version={server.mcVersion}
          path={inventory.path}
          title={inventory.title}
          running={on}
          onClose={() => setInventory(null)}
        />
      )}
      {creating && <CreateWorld base={base} seed={data.seed} onClose={() => setCreating(false)} onDone={setData} />}
      {confirm && (
        <Confirm
          title={`Borrar ${confirm.name}`}
          message="Se borrará el mundo con su Nether y su End. No se puede deshacer."
          confirmLabel="Borrar mundo"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => run(() => api(`${base}/${encodeURIComponent(confirm.name)}`, { method: 'DELETE' }).then(setData), 'Mundo borrado')}
        />
      )}
    </div>
  );
}

function CreateWorld({ base, onClose, onDone }) {
  const [name, setName] = useState('mundo-nuevo');
  const [seed, setSeed] = useState('');
  const [levelType, setLevelType] = useState('normal');
  const [run, busy] = useAction();
  return (
    <Modal title="Crear mundo nuevo" onClose={onClose}>
      <label className="field">
        <span>Nombre de la carpeta</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </label>
      <label className="field">
        <span>Semilla (opcional)</span>
        <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Vacío = aleatoria" />
      </label>
      <label className="field">
        <span>Tipo de mundo</span>
        <select value={levelType} onChange={(e) => setLevelType(e.target.value)}>
          <option value="normal">Normal</option>
          <option value="flat">Plano (superflat)</option>
          <option value="large_biomes">Biomas grandes</option>
          <option value="amplified">Amplificado</option>
        </select>
      </label>
      <p className="muted small">El mundo nuevo pasa a ser el activo y se genera la próxima vez que enciendas el servidor. El actual se conserva.</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancelar</button>
        <button
          className="btn-go"
          disabled={busy || !name.trim()}
          onClick={() =>
            run(async () => {
              onDone(await api(base, { method: 'POST', body: { name, seed, levelType } }));
              onClose();
            }, 'Mundo preparado. Enciende el servidor para generarlo.')
          }
        >
          Crear mundo
        </button>
      </div>
    </Modal>
  );
}

function PlayerData({ serverId, world, onClose, onOpen, onInventory }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/servers/${serverId}/files/players?world=${encodeURIComponent(world)}`)
      .then((r) => setList(r.players))
      .catch((err) => setError(err.message));
  }, [serverId, world]);
  return (
    <Modal title={`Datos de jugadores en ${world}`} onClose={onClose}>
      <p className="muted small">
        Inventario, posición, vida, experiencia y modo de juego de cada jugador. Edítalos con el servidor apagado; si el jugador está conectado, el
        servidor sobrescribe los cambios.
      </p>
      {error && <div className="error-box">{error}</div>}
      {!list && !error && <p className="muted">Cargando…</p>}
      {list?.length === 0 && <p className="muted">Todavía no ha entrado nadie a este mundo.</p>}
      {list?.length > 0 && (
        <table className="table">
          <tbody>
            {list.map((p) => (
              <tr key={p.uuid}>
                <td>
                  <span className="row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
                    {p.name && <PlayerHead uuid={p.uuid} name={p.name} size={24} />}
                    <span>{p.name || <span className="mono small">{p.uuid}</span>}</span>
                  </span>
                </td>
                <td className="muted small">{formatDate(p.mtime)}</td>
                <td className="actions">
                  <button className="btn-sm btn-go" onClick={() => onInventory(p)}>
                    Inventario
                  </button>{' '}
                  <button className="btn-sm" onClick={() => onOpen(p)}>
                    Todos los datos
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
