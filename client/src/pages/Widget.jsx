import { api, STATUS_LABEL } from '../api.js';
import { useLive, serverState } from '../live.jsx';
import { Electric, ELECTRIC_STATES, useAction, usePageTitle } from '../ui.jsx';

/**
 * Widget: una ventana pequeña siempre encima (Picture-in-Picture de documento en Chrome y Edge)
 * con la lámpara, los jugadores y el botón de encender de cada servidor.
 */
export default function Widget() {
  usePageTitle('Widget');
  const { servers, runtime } = useLive();
  const [run, busy] = useAction();
  return (
    <div className="widget">
      {servers.length === 0 && <p className="faint small">Sin servidores.</p>}
      {servers.map((s) => {
        const st = serverState(s, runtime[s.id]);
        const on = ['starting', 'running', 'stopping'].includes(st);
        const players = runtime[s.id]?.players || [];
        return (
          <div key={s.id} className="widget-row">
            {ELECTRIC_STATES.has(st) ? <Electric state={st} small /> : null}
            <i className={`dot ${st}`} aria-hidden="true" />
            <span className="name nameplate" title={s.name}>
              {s.name}
            </span>
            <span className="muted small">{st === 'running' ? `${players.length} jugando` : STATUS_LABEL[st]}</span>
            {s.installState === 'ready' &&
              (on ? (
                <button className="btn-sm" disabled={busy || st === 'stopping'} onClick={() => run(() => api(`/servers/${s.id}/stop`, { method: 'POST' }))}>
                  Apagar
                </button>
              ) : (
                <button className="btn-sm btn-go" disabled={busy} onClick={() => run(() => api(`/servers/${s.id}/start`, { method: 'POST' }))}>
                  Encender
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** Abre el widget: en Chrome y Edge como ventana siempre encima; en otros navegadores, una ventana pequeña. */
export async function openWidget() {
  const url = `${location.origin}/widget`;
  if ('documentPictureInPicture' in window) {
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 360, height: 70 + 52 * Math.max(1, Math.min(6, document.querySelectorAll('.side-link .name').length)) });
      pip.document.body.style.margin = '0';
      pip.document.body.style.background = '#0a0d13';
      const frame = pip.document.createElement('iframe');
      frame.src = url;
      frame.style.cssText = 'border:0;width:100%;height:100%;display:block';
      pip.document.body.appendChild(frame);
      return 'pip';
    } catch {
      /* el usuario lo canceló o no se permite: se abre como ventana */
    }
  }
  window.open(url, 'mcp-widget', 'popup,width=360,height=320');
  return 'popup';
}
