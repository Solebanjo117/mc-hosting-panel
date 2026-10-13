import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Confirm, useAction } from '../../ui.jsx';

/** Mapa 3D del mundo con BlueMap, dentro del panel. */
export default function MapTab({ server, state }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [run, busy] = useAction();
  const running = state === 'running';

  const load = () =>
    api(`/servers/${server.id}/map`)
      .then(setS)
      .catch((err) => setError(err.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, state]);

  if (error) return <div className="error-box">{error}</div>;
  if (!s) return <p className="muted">Cargando…</p>;

  if (!s.supported) {
    return (
      <section className="panel" style={{ maxWidth: 760 }}>
        <h2>Mapa del mundo</h2>
        <p className="muted">{s.reason}</p>
      </section>
    );
  }

  if (!s.enabled) {
    return (
      <section className="panel stack" style={{ maxWidth: 760 }}>
        <h2 style={{ margin: 0 }}>Mapa del mundo</h2>
        <p className="muted">
          Con <strong>BlueMap</strong> ves tu mundo en 3D desde el navegador: puedes girar, acercarte, ver construcciones y dónde está cada jugador en
          tiempo real. Tus amigos también pueden verlo si les compartes el panel por Tailscale.
        </p>
        <ul className="small muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>La primera vez descarga sus recursos y dibuja el mapa poco a poco: usa CPU un rato y espacio en disco.</li>
          <li>Solo se dibujan las zonas que ya se exploraron; se actualiza mientras juegan.</li>
          <li>Se instala como {server.type === 'paper' ? 'plugin' : 'mod'} y el panel lo configura solo. Necesita reiniciar el servidor.</li>
        </ul>
        <div className="row">
          <button
            className="btn-go"
            disabled={busy || server.installState !== 'ready'}
            onClick={() =>
              run(async () => {
                const r = await api(`/servers/${server.id}/map`, { method: 'POST', body: { enabled: true } });
                setS(r);
              }, running ? 'BlueMap instalado. Reinicia el servidor para ver el mapa.' : 'BlueMap instalado. Enciende el servidor para ver el mapa.')
            }
          >
            {busy ? 'Instalando…' : 'Instalar el mapa (BlueMap)'}
          </button>
        </div>
      </section>
    );
  }

  const src = `/api/servers/${server.id}/map/view/`;
  return (
    <div className="stack" style={{ gap: '0.75rem' }}>
      <div className="row">
        <span className="muted small grow">
          {running
            ? 'Arrastra para mover, rueda para acercar, clic derecho para girar. Si se ve vacío, BlueMap todavía está dibujando.'
            : 'Enciende el servidor para ver el mapa.'}
        </span>
        <button className="btn-sm" onClick={() => setReloadKey((k) => k + 1)} disabled={!running}>
          Recargar
        </button>
        <a className="btn btn-sm" href={src} target="_blank" rel="noreferrer">
          Abrir en pestaña nueva
        </a>
        <button className="btn-sm btn-ghost" onClick={() => setConfirm(true)}>
          Quitar mapa
        </button>
      </div>
      {running ? (
        <iframe key={reloadKey} title="Mapa del mundo" src={src} className="map-frame" allow="fullscreen" />
      ) : (
        <div className="map-frame map-off">
          <p className="muted">El mapa aparece aquí cuando el servidor está encendido.</p>
        </div>
      )}
      {confirm && (
        <Confirm
          title="Quitar el mapa"
          message="Se desinstala BlueMap. Los archivos del mapa ya dibujado se quedan en la carpeta del servidor por si lo vuelves a activar."
          confirmLabel="Quitar"
          danger
          onClose={() => setConfirm(false)}
          onConfirm={() => run(async () => setS(await api(`/servers/${server.id}/map`, { method: 'POST', body: { enabled: false } })), 'Mapa quitado')}
        />
      )}
    </div>
  );
}
