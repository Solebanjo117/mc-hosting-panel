import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { CopyButton, useAction } from '../../ui.jsx';

/** Página pública e invitación: un enlace para que tus amigos vean el estado y cómo entrar, sin sesión. */
export default function PublicSection({ server }) {
  const [cfg, setCfg] = useState(null);
  const [run, busy] = useAction();
  const load = () => api(`/servers/${server.id}/public`).then(setCfg);
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);
  const save = (patch, msg) => run(() => api(`/servers/${server.id}/public`, { method: 'PUT', body: patch }).then(setCfg), msg);
  if (!cfg) return null;
  const link = `${location.origin}/estado/${server.id}`;
  return (
    <section className="panel stack" style={{ gap: '0.8rem' }}>
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Página pública e invitación
        </h2>
        <label className="check" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={cfg.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? 'Página pública activada' : 'Página pública desactivada')} />
          <span>Activar</span>
        </label>
      </div>
      <p className="muted small" style={{ maxWidth: '75ch' }}>
        Un enlace que cualquiera puede abrir sin entrar al panel: ve si el servidor está encendido, quién juega, el MOTD y cómo entrar con la dirección correcta.
        Solo se muestra lo que marques aquí; nunca la consola ni tus archivos. Para que lo abran desde fuera de tu red, el panel tiene que ser accesible (por
        ejemplo con Tailscale o Cloudflare Tunnel).
      </p>
      {cfg.enabled && (
        <>
          <span className="address">
            <span>{link}</span>
            <CopyButton text={link} label="Copiar enlace" />
          </span>
          <div className="row" style={{ gap: '1rem' }}>
            <label className="check">
              <input type="checkbox" checked={cfg.showPlayers} disabled={busy} onChange={(e) => save({ showPlayers: e.target.checked })} />
              <span>Mostrar quién está jugando</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={cfg.showAddress} disabled={busy} onChange={(e) => save({ showAddress: e.target.checked })} />
              <span>Mostrar la dirección y cómo entrar</span>
            </label>
          </div>
          <label className="field" style={{ maxWidth: 520 }}>
            <span>Mensaje para tus amigos (opcional)</span>
            <input defaultValue={cfg.message} maxLength={200} placeholder="Jugamos los viernes a las 8." onBlur={(e) => e.target.value !== cfg.message && save({ message: e.target.value })} />
          </label>
          <p className="faint small">
            Dirección que verán: {cfg.address?.java || 'todavía no hay una dirección pública (abre el puerto, usa playit o un dominio)'}
            {cfg.address?.via ? ` (por ${cfg.address.via})` : ''}.
          </p>
          <a className="btn btn-sm" href={link} target="_blank" rel="noreferrer">
            Abrir la página
          </a>
        </>
      )}
    </section>
  );
}
