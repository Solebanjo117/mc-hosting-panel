import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useLive } from '../../live.jsx';
import { notifyPrefs, notifySupported } from '../../notify.js';
import { Confirm, useAction } from '../../ui.jsx';

/** Simulacro de caída: apaga el servidor de golpe a propósito y comprueba que todo lo que debe pasar, pasa. */
export default function DrillSection({ server }) {
  const { runtime } = useLive();
  const rt = runtime[server.id];
  const [ask, setAsk] = useState(false);
  const [drill, setDrill] = useState(null); // { at, autoRestart, crashed, restarted }
  const [run, busy] = useAction();

  useEffect(() => {
    if (!drill || !rt) return;
    if (rt.status === 'crashed' && !drill.crashed) setDrill({ ...drill, crashed: Date.now() });
    if (rt.status === 'running' && drill.crashed && !drill.restarted) setDrill({ ...drill, restarted: Date.now() });
  }, [rt?.status, drill, rt]);

  const prefs = notifyPrefs();
  const notifyOk = notifySupported() && Notification.permission === 'granted' && prefs.enabled && prefs.crash;
  const step = (ok, pending, label, detail) => (
    <li className={`health-item ${ok ? 'ok' : pending ? 'info' : 'bad'}`}>
      <span className="health-icon" aria-hidden="true">
        {ok ? '✓' : pending ? '…' : '✕'}
      </span>
      <span className="grow">
        <strong>{label}</strong>
        {detail && <span className="muted small"> {detail}</span>}
      </span>
    </li>
  );

  return (
    <section className="panel stack" style={{ gap: '0.7rem' }}>
      <h2 style={{ margin: 0 }}>Simulacro de caída</h2>
      <p className="muted small" style={{ maxWidth: '75ch' }}>
        Cierra el proceso del servidor de golpe, como si Java fallara, y comprueba que el reinicio automático y las notificaciones funcionan. Avisa a quien
        esté jugando: los sacará un momento.
      </p>
      <div className="row">
        <button className="btn-stop" disabled={busy || rt?.status !== 'running'} onClick={() => setAsk(true)}>
          Hacer el simulacro
        </button>
        {rt?.status !== 'running' && <span className="muted small">Enciende el servidor para probarlo.</span>}
      </div>
      {drill && (
        <ul className="health-list" aria-label="Resultado del simulacro">
          {step(Boolean(drill.crashed), !drill.crashed, 'El panel detectó la caída', drill.crashed ? `en ${Math.round((drill.crashed - drill.started) / 100) / 10} s` : 'esperando…')}
          {drill.autoRestart
            ? step(Boolean(drill.restarted), !drill.restarted, 'Reinicio automático', drill.restarted ? `listo en ${Math.round((drill.restarted - drill.started) / 1000)} s` : 'arranca unos 10 s después de la caída…')
            : step(false, false, 'Reinicio automático', 'está apagado en Ajustes → "Reiniciar si se cae". Actívalo.')}
          {step(notifyOk, false, 'Notificación en este navegador', notifyOk ? 'permiso concedido y avisos de caída activados' : 'sin permiso o desactivada en Ajustes del panel → Notificaciones')}
        </ul>
      )}
      {ask && (
        <Confirm
          title="Simulacro de caída"
          message={`Se cerrará el proceso de "${server.name}" sin guardar el último minuto. ${rt?.players?.length ? `Hay ${rt.players.length} jugando ahora.` : 'No hay nadie jugando.'}`}
          confirmLabel="Hacer el simulacro"
          danger
          onClose={() => setAsk(false)}
          onConfirm={() => run(() => api(`/servers/${server.id}/drill`, { method: 'POST' }).then((r) => setDrill({ ...r, started: Date.now(), crashed: 0, restarted: 0 })))}
        />
      )}
    </section>
  );
}
