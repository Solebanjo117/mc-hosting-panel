import { useEffect, useState } from 'react';
import { api, formatDate } from '../../api.js';
import { Modal, useAction } from '../../ui.jsx';
import { useLive } from '../../live.jsx';

/** Modo mantenimiento: MOTD con el aviso, lista blanca temporal con los ayudantes y expulsión de los demás. */
export default function MaintenanceSection({ server }) {
  const runtime = useLive().runtime[server.id];
  const [st, setSt] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ message: 'En mantenimiento, volvemos pronto', until: '', helpers: '', restart: true });
  const [run, busy] = useAction();
  const base = `/servers/${server.id}/maintenance`;
  useEffect(() => {
    api(base).then(setSt).catch(() => {});
  }, [base, runtime?.status]);
  if (!st) return null;
  const online = runtime?.players || [];
  return (
    <section className="panel stack" style={{ gap: '0.7rem' }}>
      <h2 style={{ margin: 0 }}>Modo mantenimiento</h2>
      {st.active ? (
        <>
          <div className="note">
            En mantenimiento desde {formatDate(st.since)}: “{st.message}”{st.until ? ` (${st.until})` : ''}. Pueden entrar: {st.helpers.length ? st.helpers.join(', ') : 'nadie más que los operadores en la lista blanca'}.
          </div>
          <div className="row">
            <button className="btn-go" disabled={busy} onClick={() => run(() => api(base, { method: 'DELETE', body: { restart: runtime?.status === 'running' } }).then(setSt), 'Mantenimiento terminado')}>
              Terminar el mantenimiento
            </button>
            <span className="muted small">Se restauran el MOTD y la lista blanca tal como estaban.</span>
          </div>
        </>
      ) : (
        <>
          <p className="muted small" style={{ maxWidth: '75ch' }}>
            Cierra el servidor a los jugadores sin apagarlo: el MOTD avisa (“🔧 volvemos a las 8”), se activa una lista blanca temporal con quienes te
            ayudan y se expulsa a los demás con el mensaje. Al terminar, todo vuelve a como estaba.
          </p>
          <div>
            <button onClick={() => setOpen(true)} disabled={busy}>
              Entrar en mantenimiento…
            </button>
          </div>
        </>
      )}
      {open && (
        <Modal title="Entrar en mantenimiento" onClose={() => setOpen(false)}>
          <label className="field">
            <span>Mensaje (se ve en la lista de servidores)</span>
            <input value={form.message} maxLength={120} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </label>
          <label className="field">
            <span>Cuándo volvemos (opcional)</span>
            <input value={form.until} maxLength={40} placeholder="hoy a las 8" onChange={(e) => setForm({ ...form, until: e.target.value })} />
          </label>
          <label className="field">
            <span>Quién puede entrar mientras tanto (nombres separados por coma)</span>
            <input value={form.helpers} placeholder={online.join(', ') || 'Ana, Beto'} onChange={(e) => setForm({ ...form, helpers: e.target.value })} />
            {online.length > 0 && (
              <button type="button" className="btn-sm btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setForm({ ...form, helpers: online.join(', ') })}>
                Usar los conectados ahora
              </button>
            )}
          </label>
          {runtime?.status === 'running' && (
            <label className="check">
              <input type="checkbox" checked={form.restart} onChange={(e) => setForm({ ...form, restart: e.target.checked })} />
              <span>Reiniciar ahora para que el MOTD nuevo se vea en la lista de servidores (la lista blanca y las expulsiones aplican sin reiniciar).</span>
            </label>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={() => setOpen(false)}>Cancelar</button>
            <button
              className="btn-stop"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    api(base, {
                      method: 'POST',
                      body: { message: form.message, until: form.until, helpers: form.helpers.split(',').map((s) => s.trim()).filter(Boolean), restart: form.restart },
                    }).then((r) => {
                      setSt(r);
                      setOpen(false);
                    }),
                  'Mantenimiento activado'
                )
              }
            >
              Entrar en mantenimiento
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
