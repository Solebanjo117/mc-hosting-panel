import { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from '../../api.js';
import { Modal, useAction } from '../../ui.jsx';
import PowerSchedule from './PowerSchedule.jsx';

const ACTIONS = {
  restart: 'Reiniciar',
  stop: 'Apagar',
  start: 'Encender',
  backup: 'Respaldar el mundo',
  message: 'Mensaje en el chat',
  command: 'Ejecutar comando',
};
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function describeWhen(when) {
  if (when.type === 'interval') {
    const m = when.minutes;
    return m % 60 === 0 ? `Cada ${m / 60} ${m === 60 ? 'hora' : 'horas'}` : `Cada ${m} minutos`;
  }
  const days = when.days.length === 7 ? 'Todos los días' : when.days.map((d) => DAYS[d]).join(', ');
  return `${days} a las ${when.time}`;
}

function describeTask(t) {
  const parts = [ACTIONS[t.action]];
  if (t.action === 'message') parts.push(`“${t.message}”`);
  if (t.action === 'command') parts.push(`/${t.command}`);
  if (t.warnMinutes) parts.push(`con aviso ${t.warnMinutes} min antes`);
  if (t.backupBefore) parts.push('y respaldo previo');
  return parts.join(' ');
}

export default function SchedulesTab({ server }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [run, busy] = useAction();
  const base = `/servers/${server.id}/schedules`;

  const load = useCallback(() => api(base).then(setData), [base]);
  useEffect(() => {
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 20_000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return <p className="muted">Cargando…</p>;

  return (
    <div className="stack" style={{ gap: '1.5rem', maxWidth: 960 }}>
      <PowerSchedule server={server} />
      <div className="row">
        <button className="btn-go" onClick={() => setEditing({})}>
          Nueva tarea
        </button>
        <button
          disabled={busy || data.tasks.some((t) => t.action === 'restart' && t.when.type === 'daily')}
          onClick={() =>
            run(
              () =>
                api(base, {
                  method: 'POST',
                  body: { action: 'restart', when: { type: 'daily', time: '05:00', days: EVERY_DAY }, warnMinutes: 5, backupBefore: true },
                }).then(setData),
              'Reinicio diario agregado'
            )
          }
        >
          Agregar reinicio diario a las 5:00
        </button>
        <span className="muted small">Las horas son las de esta PC.</span>
      </div>

      {data.tasks.length === 0 ? (
        <div className="empty">
          <p className="muted">
            No hay tareas. Un reinicio diario con aviso y respaldo previo mantiene el servidor ligero y tus mundos a salvo.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Activa</th>
                <th>Qué hace</th>
                <th>Cuándo</th>
                <th>Próxima vez</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={t.enabled}
                      aria-label="Activar tarea"
                      onChange={(e) => run(() => api(`${base}/${t.id}`, { method: 'PUT', body: { ...t, enabled: e.target.checked } }).then(setData))}
                    />
                  </td>
                  <td>
                    {t.label && <div style={{ fontWeight: 500 }}>{t.label}</div>}
                    <div className={t.label ? 'muted small' : ''}>{describeTask(t)}</div>
                  </td>
                  <td className="muted">{describeWhen(t.when)}</td>
                  <td className="muted">{t.running ? 'En curso…' : t.nextRun ? formatDate(t.nextRun) : '—'}</td>
                  <td className="actions">
                    <button
                      className="btn-sm"
                      disabled={busy || t.running}
                      onClick={() => run(() => api(`${base}/${t.id}/run`, { method: 'POST' }).then(load), 'Tarea iniciada')}
                    >
                      Ejecutar ahora
                    </button>{' '}
                    <button className="btn-sm" onClick={() => setEditing(t)}>
                      Editar
                    </button>{' '}
                    <button className="btn-sm btn-stop" disabled={busy} onClick={() => run(() => api(`${base}/${t.id}`, { method: 'DELETE' }).then(setData), 'Tarea borrada')}>
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.log.length > 0 && (
        <section>
          <h2 style={{ marginBottom: '0.6rem' }}>Historial</h2>
          <table className="table">
            <tbody>
              {data.log.slice(0, 12).map((l, i) => (
                <tr key={i}>
                  <td className="muted" style={{ width: 200 }}>
                    {formatDate(l.at)}
                  </td>
                  <td>{ACTIONS[l.action]}</td>
                  <td className="muted">{l.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {editing && (
        <TaskEditor
          task={editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            setData(await api(editing.id ? `${base}/${editing.id}` : base, { method: editing.id ? 'PUT' : 'POST', body }));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TaskEditor({ task, onClose, onSave }) {
  const [form, setForm] = useState({
    action: task.action || 'restart',
    label: task.label || '',
    whenType: task.when?.type || 'daily',
    time: task.when?.time || '05:00',
    days: task.when?.days || EVERY_DAY,
    minutes: task.when?.minutes || 60,
    warnMinutes: task.warnMinutes ?? 5,
    backupBefore: task.backupBefore ?? true,
    command: task.command || '',
    message: task.message || '',
    enabled: task.enabled ?? true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSave({
        action: form.action,
        label: form.label,
        enabled: form.enabled,
        when: form.whenType === 'interval' ? { type: 'interval', minutes: Number(form.minutes) } : { type: 'daily', time: form.time, days: form.days },
        warnMinutes: Number(form.warnMinutes),
        backupBefore: form.backupBefore,
        command: form.command,
        message: form.message,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const warn = form.action === 'restart' || form.action === 'stop';

  return (
    <Modal title={task.id ? 'Editar tarea' : 'Nueva tarea'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">
            <span>Qué hacer</span>
            <select value={form.action} onChange={(e) => set('action', e.target.value)}>
              {Object.entries(ACTIONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Nombre (opcional)</span>
            <input value={form.label} onChange={(e) => set('label', e.target.value)} maxLength={60} placeholder="Reinicio nocturno" />
          </label>
        </div>

        {form.action === 'message' && (
          <label className="field">
            <span>Mensaje</span>
            <input value={form.message} onChange={(e) => set('message', e.target.value)} maxLength={250} placeholder="Recuerden votar por el servidor" required />
          </label>
        )}
        {form.action === 'command' && (
          <label className="field">
            <span>Comando (sin /)</span>
            <input className="mono" value={form.command} onChange={(e) => set('command', e.target.value)} placeholder="weather clear" required />
          </label>
        )}

        <div className="segmented" role="radiogroup" aria-label="Frecuencia">
          <button type="button" className={form.whenType === 'daily' ? 'on' : ''} onClick={() => set('whenType', 'daily')}>
            A una hora
          </button>
          <button type="button" className={form.whenType === 'interval' ? 'on' : ''} onClick={() => set('whenType', 'interval')}>
            Cada cierto tiempo
          </button>
        </div>

        {form.whenType === 'daily' ? (
          <div className="stack" style={{ gap: '0.6rem' }}>
            <label className="field" style={{ maxWidth: 160 }}>
              <span>Hora</span>
              <input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} required />
            </label>
            <div className="row" role="group" aria-label="Días">
              {DAYS.map((d, i) => (
                <label key={d} className="check">
                  <input
                    type="checkbox"
                    checked={form.days.includes(i)}
                    onChange={(e) => set('days', e.target.checked ? [...form.days, i].sort() : form.days.filter((x) => x !== i))}
                  />
                  <span>{d}</span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <label className="field" style={{ maxWidth: 220 }}>
            <span>Cada (minutos)</span>
            <input type="number" min={5} value={form.minutes} onChange={(e) => set('minutes', e.target.value)} />
          </label>
        )}

        {warn && (
          <label className="field" style={{ maxWidth: 260 }}>
            <span>Avisar en el chat antes (minutos)</span>
            <input type="number" min={0} max={60} value={form.warnMinutes} onChange={(e) => set('warnMinutes', e.target.value)} />
            <span>Avisa al inicio, a los 5 min, 1 min y 10 s.</span>
          </label>
        )}
        {form.action === 'restart' && (
          <label className="check">
            <input type="checkbox" checked={form.backupBefore} onChange={(e) => set('backupBefore', e.target.checked)} />
            <span>Respaldar el mundo antes de reiniciar</span>
          </label>
        )}
        {warn && form.whenType === 'daily' && Number(form.warnMinutes) > 0 && (
          <p className="faint small">El servidor se {form.action === 'restart' ? 'reinicia' : 'apaga'} justo a las {form.time}; los avisos empiezan antes.</p>
        )}

        {error && <div className="error-box">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-go" disabled={saving}>
            Guardar tarea
          </button>
        </div>
      </form>
    </Modal>
  );
}
