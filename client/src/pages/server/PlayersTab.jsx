import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAction } from '../../ui.jsx';

const avatar = (name) => `https://mc-heads.net/avatar/${encodeURIComponent(name)}/32`;

export default function PlayersTab({ server, runtime }) {
  const [data, setData] = useState(null);
  const [run, busy] = useAction();
  const [name, setName] = useState('');

  const load = useCallback(() => api(`/servers/${server.id}/players`).then(setData), [server.id]);
  useEffect(() => {
    load().catch(() => {});
  }, [load, runtime?.players?.length, runtime?.status]);

  const act = (action, target, reason, msg) =>
    run(() => api(`/servers/${server.id}/players`, { method: 'POST', body: { action, name: target, reason } }).then(setData), msg);

  if (!data) return <p className="muted">Cargando…</p>;
  const running = runtime?.status === 'running';

  return (
    <div className="stack" style={{ gap: '1.5rem' }}>
      {!running && (
        <p className="note">
          El servidor está apagado: los cambios se guardan directo en los archivos y se aplican al encender.
          {data.onlineMode ? '' : ' Está en modo sin conexión (online-mode=false), así que cualquiera puede usar cualquier nombre; activa la lista blanca.'}
        </p>
      )}

      <section className="panel">
        <h2>En línea ({data.online.length})</h2>
        {data.online.length === 0 ? (
          <p className="muted small">{running ? 'No hay nadie conectado.' : 'Enciende el servidor para ver quién está conectado.'}</p>
        ) : (
          <table className="table">
            <tbody>
              {data.online.map((p) => (
                <tr key={p}>
                  <td>
                    <Player name={p} />
                  </td>
                  <td className="actions">
                    <button className="btn-sm" disabled={busy} onClick={() => act('op', p, '', `${p} ahora es operador`)}>
                      Hacer operador
                    </button>{' '}
                    <button className="btn-sm" disabled={busy} onClick={() => act('kick', p, 'Expulsado desde el panel', `${p} expulsado`)}>
                      Expulsar
                    </button>{' '}
                    <button className="btn-sm btn-stop" disabled={busy} onClick={() => act('ban', p, '', `${p} baneado`)}>
                      Banear
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) act('whitelist-add', name.trim(), '', `${name.trim()} agregado a la lista blanca`).then(() => setName(''));
        }}
      >
        <input
          className="grow"
          style={{ width: 'auto', maxWidth: 320 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de jugador"
          aria-label="Nombre de jugador"
          pattern="[A-Za-z0-9_]{2,16}"
        />
        <button className="btn-go" disabled={busy || !name.trim()}>
          Agregar a la lista blanca
        </button>
        <button type="button" disabled={busy || !name.trim()} onClick={() => act('op', name.trim(), '', `${name.trim()} ahora es operador`)}>
          Hacer operador
        </button>
        <button type="button" className="btn-stop" disabled={busy || !name.trim()} onClick={() => act('ban', name.trim(), '', `${name.trim()} baneado`)}>
          Banear
        </button>
      </form>

      <div className="grid-2">
        <List
          title={`Lista blanca (${data.whitelist.length})`}
          hint={data.whitelistEnabled ? 'Activada: solo estos jugadores pueden entrar.' : 'Desactivada. Actívala en Ajustes con "white-list".'}
          items={data.whitelist}
          actionLabel="Quitar"
          onAction={(e) => act('whitelist-remove', e.name, '', `${e.name} quitado de la lista blanca`)}
          busy={busy}
        />
        <List
          title={`Operadores (${data.ops.length})`}
          hint="Pueden usar todos los comandos dentro del juego."
          items={data.ops}
          actionLabel="Quitar"
          onAction={(e) => act('deop', e.name, '', `${e.name} ya no es operador`)}
          busy={busy}
        />
        <List
          title={`Baneados (${data.banned.length})`}
          items={data.banned}
          actionLabel="Perdonar"
          detail={(e) => e.reason}
          onAction={(e) => act('pardon', e.name, '', `${e.name} perdonado`)}
          busy={busy}
        />
        <List
          title={`IP baneadas (${data.bannedIps.length})`}
          items={data.bannedIps.map((e) => ({ ...e, name: e.ip }))}
          actionLabel="Perdonar"
          noAvatar
          detail={(e) => e.reason}
          onAction={(e) => act('pardon-ip', e.ip, '', `IP ${e.ip} perdonada`)}
          busy={busy}
        />
      </div>
    </div>
  );
}

function Player({ name, noAvatar }) {
  return (
    <span className="row" style={{ gap: '0.55rem', flexWrap: 'nowrap' }}>
      {!noAvatar && <img src={avatar(name)} alt="" width={24} height={24} style={{ imageRendering: 'pixelated', borderRadius: 3 }} />}
      <span>{name}</span>
    </span>
  );
}

function List({ title, hint, items, actionLabel, onAction, busy, detail, noAvatar }) {
  return (
    <section className="panel">
      <h2 style={{ marginBottom: hint ? '0.2rem' : '0.9rem' }}>{title}</h2>
      {hint && <p className="muted small" style={{ marginBottom: '0.8rem' }}>{hint}</p>}
      {items.length === 0 ? (
        <p className="faint small">Vacía.</p>
      ) : (
        <table className="table">
          <tbody>
            {items.map((e) => (
              <tr key={e.uuid || e.name}>
                <td>
                  <Player name={e.name} noAvatar={noAvatar} />
                  {detail?.(e) && <div className="faint small">{detail(e)}</div>}
                </td>
                <td className="actions">
                  <button className="btn-sm" disabled={busy} onClick={() => onAction(e)}>
                    {actionLabel}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
