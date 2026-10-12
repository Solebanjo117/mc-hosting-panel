import { useCallback, useEffect, useState } from 'react';
import { api, formatBytes, formatDate } from '../../api.js';
import { Confirm, useAction } from '../../ui.jsx';

export default function BackupsTab({ server, state }) {
  const [data, setData] = useState(null);
  const [schedule, setSchedule] = useState(server.backupSchedule || { enabled: false, intervalHours: 24, keep: 7, mode: 'mundo' });
  const [confirm, setConfirm] = useState(null);
  const [run, busy] = useAction();
  const base = `/servers/${server.id}/backups`;

  const load = useCallback(() => api(base).then(setData), [base]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const stopped = !['running', 'starting', 'stopping'].includes(state);

  return (
    <div className="stack" style={{ gap: '1.5rem' }}>
      <section className="row">
        <button className="btn-go" disabled={busy} onClick={() => run(() => api(base, { method: 'POST', body: { mode: 'mundo' } }).then(load), 'Respaldo del mundo creado')}>
          Respaldar el mundo
        </button>
        <button disabled={busy} onClick={() => run(() => api(base, { method: 'POST', body: { mode: 'completo' } }).then(load), 'Respaldo completo creado')}>
          Respaldo completo
        </button>
        <span className="muted small">
          {busy ? 'Comprimiendo… puede tardar con mundos grandes.' : 'El completo incluye mundos, configuración, mods y plugins. Se puede hacer con el servidor encendido.'}
        </span>
      </section>

      <section className="panel stack" style={{ gap: '0.9rem' }}>
        <h2 style={{ margin: 0 }}>Respaldos automáticos</h2>
        <label className="check">
          <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} />
          <span>Crear un respaldo automáticamente</span>
        </label>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 160 }}>
            <span>Cada (horas)</span>
            <input type="number" min={1} value={schedule.intervalHours} onChange={(e) => setSchedule({ ...schedule, intervalHours: Number(e.target.value) })} />
          </label>
          <label className="field" style={{ width: 160 }}>
            <span>Conservar los últimos</span>
            <input type="number" min={1} value={schedule.keep} onChange={(e) => setSchedule({ ...schedule, keep: Number(e.target.value) })} />
          </label>
          <label className="field" style={{ width: 180 }}>
            <span>Qué respaldar</span>
            <select value={schedule.mode} onChange={(e) => setSchedule({ ...schedule, mode: e.target.value })}>
              <option value="mundo">Solo el mundo</option>
              <option value="completo">Todo el servidor</option>
            </select>
          </label>
          <button disabled={busy} onClick={() => run(() => api(`/servers/${server.id}`, { method: 'PATCH', body: { backupSchedule: schedule } }), 'Programación guardada')}>
            Guardar programación
          </button>
        </div>
        {data?.lastAutoBackup && <p className="faint small">Último automático: {formatDate(data.lastAutoBackup)}</p>}
      </section>

      <section>
        <h2 style={{ marginBottom: '0.8rem' }}>Respaldos guardados</h2>
        {!data ? (
          <p className="muted">Cargando…</p>
        ) : data.backups.length === 0 ? (
          <p className="muted">Aún no hay respaldos.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Tamaño</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.backups.map((b) => (
                  <tr key={b.file}>
                    <td>{formatDate(b.createdAt)}</td>
                    <td className="muted">
                      {b.mode === 'mundo' ? 'Mundo' : 'Completo'}
                      {b.file.endsWith('-auto.zip') ? ', automático' : ''}
                    </td>
                    <td className="muted">{formatBytes(b.size)}</td>
                    <td className="actions">
                      <a className="btn btn-sm" href={`/api${base}/${encodeURIComponent(b.file)}/download`}>
                        Descargar
                      </a>{' '}
                      <button
                        className="btn-sm"
                        disabled={!stopped}
                        title={stopped ? '' : 'Apaga el servidor para restaurar'}
                        onClick={() => setConfirm({ type: 'restore', b })}
                      >
                        Restaurar
                      </button>{' '}
                      <button className="btn-sm btn-stop" onClick={() => setConfirm({ type: 'delete', b })}>
                        Borrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirm?.type === 'restore' && (
        <Confirm
          title="Restaurar respaldo"
          message={`Se reemplazará lo que contiene este respaldo (${confirm.b.mode === 'mundo' ? 'el mundo' : 'mundos, configuración, mods y plugins'}) por la versión del ${formatDate(confirm.b.createdAt)}. Lo actual se perderá; si dudas, crea un respaldo antes.`}
          confirmLabel="Restaurar"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => run(() => api(`${base}/${encodeURIComponent(confirm.b.file)}/restore`, { method: 'POST' }), 'Respaldo restaurado')}
        />
      )}
      {confirm?.type === 'delete' && (
        <Confirm
          title="Borrar respaldo"
          message="El archivo se borrará de esta PC. No se puede deshacer."
          confirmLabel="Borrar"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => run(() => api(`${base}/${encodeURIComponent(confirm.b.file)}`, { method: 'DELETE' }).then(load), 'Respaldo borrado')}
        />
      )}
    </div>
  );
}
