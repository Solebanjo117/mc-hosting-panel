import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { CopyButton, useAction, useToast } from '../../ui.jsx';
import { useLive } from '../../live.jsx';

function Address({ label, text }) {
  return (
    <div>
      {label && <div className="faint small" style={{ marginTop: '0.6rem' }}>{label}</div>}
      <div className="address">
        <span>{text}</span>
        <CopyButton text={text} />
      </div>
    </div>
  );
}

const fwRule = (port, proto) =>
  `netsh advfirewall firewall add rule name="Minecraft ${proto === 'UDP' ? 'Bedrock ' : ''}${port}" dir=in action=allow protocol=${proto} localport=${port}`;

export default function NetworkTab({ server, state }) {
  const [net, setNet] = useState(null);
  const [host, setHost] = useState('');
  const [edition, setEdition] = useState('java');
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const toast = useToast();
  const bedrock = server.bedrock?.enabled ? server.bedrock.port : null;
  const [duck, setDuck] = useState(null);
  const [tunnels, setTunnels] = useState(null);
  const [tunnelError, setTunnelError] = useState('');
  const [run, busy] = useAction();
  const { playit: livePlayit } = useLive();

  useEffect(() => {
    api('/system/network').then(setNet).catch((err) => toast(err.message, 'error'));
    api('/integrations/duckdns').then(setDuck).catch(() => {});
  }, [toast]);

  const loadTunnels = () =>
    api(`/servers/${server.id}/playit`)
      .then((t) => {
        setTunnels(t);
        setTunnelError('');
      })
      .catch((err) => setTunnelError(err.message));
  useEffect(() => {
    loadTunnels();
    // Un túnel recién creado tarda unos segundos en tener dirección.
    const t = setInterval(loadTunnels, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, server.playit?.enabled, server.bedrock?.enabled, livePlayit?.status]);

  const duckHost = duck?.enabled && duck.hosts[0];

  const lan = net?.localIps.find((i) => !i.virtual) || net?.localIps[0];
  const firewallCmd = [fwRule(server.port, 'TCP'), bedrock && fwRule(bedrock, 'UDP')].filter(Boolean).join(' & ');

  async function test() {
    setChecking(true);
    setCheck(null);
    try {
      setCheck(await api(`/servers/${server.id}/network/check?${qs({ host: host.trim(), edition })}`));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="stack" style={{ gap: '1.5rem', maxWidth: 900 }}>
      <section className="grid-2">
        <div className="panel">
          <h2>Jugadores en tu casa</h2>
          <p className="muted small">Conectados a tu mismo Wi-Fi o cable. Funciona sin abrir puertos.</p>
          {lan && (
            <>
              <Address label={bedrock ? 'Java' : null} text={`${lan.address}:${server.port}`} />
              {bedrock && <Address label={`Bedrock: dirección ${lan.address}, puerto ${bedrock}`} text={lan.address} />}
            </>
          )}
          {net?.localIps.length > 1 && (
            <p className="faint small" style={{ marginTop: '0.5rem' }}>
              Otras interfaces: {net.localIps.filter((i) => i !== lan).map((i) => `${i.address} (${i.interface})`).join(', ')}
            </p>
          )}
        </div>
        <div className="panel">
          <h2>Jugadores por internet</h2>
          <p className="muted small">
            Necesitas abrir el puerto {server.port} TCP{bedrock ? ` y el ${bedrock} UDP` : ''} en el firewall y en tu router.
          </p>
          {net?.publicIp ? (
            <>
              <Address label={bedrock ? 'Java' : null} text={`${net.publicIp}:${server.port}`} />
              {bedrock && <Address label={`Bedrock: dirección ${net.publicIp}, puerto ${bedrock}`} text={net.publicIp} />}
            </>
          ) : (
            <p className="faint small">No se pudo detectar tu IP pública.</p>
          )}
          {duckHost ? (
            <>
              <Address label="Con tu dominio de DuckDNS (no cambia aunque cambie tu IP)" text={server.port === 25565 ? duckHost : `${duckHost}:${server.port}`} />
              {bedrock && <Address label={`Bedrock: dirección ${duckHost}, puerto ${bedrock}`} text={duckHost} />}
            </>
          ) : (
            <p className="faint small" style={{ marginTop: '0.5rem' }}>
              Tu IP pública puede cambiar. Para tener una dirección fija configura DuckDNS en <Link to="/ajustes">Ajustes del panel</Link>.
            </p>
          )}
        </div>
      </section>

      <section className="panel stack" style={{ gap: '0.8rem' }}>
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            Túnel de playit.gg
          </h2>
          {server.playit?.enabled && <span className="chip">Activo</span>}
        </div>
        <p className="muted small">
          Si tu compañía de internet usa CGNAT (o no puedes abrir puertos en el módem), playit.gg da una dirección pública que funciona sin abrir nada.
          Puede agregar un poco de ping, porque el tráfico pasa por un servidor de playit.
        </p>
        {tunnelError && <div className="error-box">{tunnelError}</div>}
        {tunnels && !tunnels.claimed ? (
          <p className="small">
            Primero vincula tu cuenta de playit.gg en <Link to="/ajustes">Ajustes del panel</Link> (es gratis y se hace una sola vez).
          </p>
        ) : tunnels?.serverEnabled ? (
          <>
            <TunnelRow label="Java" tunnel={tunnels.java} />
            {bedrock && <TunnelRow label="Bedrock" tunnel={tunnels.bedrock} bedrock />}
            {tunnels.notices?.map((n, i) => (
              <p key={i} className="note">
                {n.message} {n.link && <a href={n.link} target="_blank" rel="noreferrer">Resolver</a>}
              </p>
            ))}
            {!['connected', 'running'].includes(livePlayit?.status || tunnels.status) && (
              <p className="note">El agente de playit no está conectado. Revisa su estado en Ajustes del panel.</p>
            )}
            <div className="row">
              <button disabled={busy} onClick={() => run(() => api(`/servers/${server.id}/playit`, { method: 'POST', body: {} }).then(setTunnels), 'Túneles revisados')}>
                Reparar túneles
              </button>
              <button
                className="btn-stop"
                disabled={busy}
                onClick={() => run(() => api(`/servers/${server.id}/playit`, { method: 'POST', body: { enabled: false } }).then(setTunnels), 'Túneles borrados')}
              >
                Quitar túneles
              </button>
            </div>
          </>
        ) : (
          tunnels && (
            <div className="row">
              <button className="btn-go" disabled={busy} onClick={() => run(() => api(`/servers/${server.id}/playit`, { method: 'POST', body: {} }).then(setTunnels), 'Túneles creados')}>
                Crear túnel{bedrock ? 'es (Java y Bedrock)' : ''}
              </button>
              <span className="faint small">El plan gratuito de playit permite pocos túneles; usa uno por servidor que quieras compartir.</span>
            </div>
          )
        )}
      </section>

      <section className="panel stack" style={{ gap: '0.9rem' }}>
        <h2 style={{ margin: 0 }}>Pasos para abrir {bedrock ? 'los puertos' : `el puerto ${server.port}`}</h2>
        <ol className="stack" style={{ gap: '0.9rem', margin: 0, paddingLeft: '1.2rem' }}>
          <li>
            <strong>Fija la IP de esta PC</strong>
            <p className="muted small">
              Reserva {lan ? <span className="mono">{lan.address}</span> : 'la IP local'} en tu router (reserva DHCP) para que no cambie.
            </p>
          </li>
          <li>
            <strong>Permite {bedrock ? 'los puertos' : 'el puerto'} en el Firewall de Windows</strong>
            <p className="muted small">
              Ejecuta <span className="mono">scripts\abrir-firewall.bat</span> de la carpeta del panel
              {bedrock ? ' una vez para TCP y otra para UDP' : ''}, o pega esto en una terminal abierta como administrador:
            </p>
            <div className="address">
              <span style={{ overflowWrap: 'anywhere' }}>{firewallCmd}</span>
              <CopyButton text={firewallCmd} />
            </div>
          </li>
          <li>
            <strong>Crea el reenvío de puertos en tu router</strong>
            <p className="muted small">
              Puerto {server.port}, protocolo TCP → {lan ? <span className="mono">{lan.address}</span> : 'esta PC'} puerto {server.port}.
              {bedrock && (
                <>
                  {' '}
                  Y otra regla: puerto {bedrock}, protocolo <strong>UDP</strong> → la misma IP, puerto {bedrock}.
                </>
              )}
            </p>
          </li>
          <li>
            <strong>Comprueba que funciona</strong> con el botón de abajo, con el servidor encendido.
          </li>
        </ol>
        <p className="small">
          <Link to="/guia">Ver la guía completa</Link>, con instrucciones para Totalplay, Telmex e Izzi, CGNAT, dominios y alternativas como playit.gg.
        </p>
      </section>

      <section className="panel stack" style={{ gap: '0.9rem' }}>
        <h2 style={{ margin: 0 }}>Probar desde internet</h2>
        <p className="muted small">
          Un servicio externo (mcsrvstat.us) intenta conectarse a tu servidor como lo haría un amigo. Si escribes un dominio o una dirección de playit.gg,
          se prueba esa dirección.
        </p>
        <div className="row">
          {bedrock && (
            <div className="segmented" role="radiogroup" aria-label="Edición a probar">
              <button className={edition === 'java' ? 'on' : ''} onClick={() => setEdition('java')} role="radio" aria-checked={edition === 'java'}>
                Java
              </button>
              <button className={edition === 'bedrock' ? 'on' : ''} onClick={() => setEdition('bedrock')} role="radio" aria-checked={edition === 'bedrock'}>
                Bedrock
              </button>
            </div>
          )}
          <input
            className="grow"
            style={{ width: 'auto', maxWidth: 360 }}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={net?.publicIp ? `${net.publicIp} (tu IP pública)` : 'Dominio, o IP:puerto'}
            aria-label="Dominio o IP a probar"
          />
          <button className="btn-go" disabled={checking || state !== 'running'} onClick={test}>
            {checking ? 'Probando…' : 'Probar desde internet'}
          </button>
          {state !== 'running' && <span className="muted small">Enciende el servidor primero.</span>}
        </div>
        {check &&
          (check.online ? (
            <div className="note" style={{ borderLeftColor: 'var(--prismarine)', background: 'rgba(79,179,169,0.08)' }}>
              Tu servidor se ve desde internet en <span className="mono">{check.host}:{check.port}</span>
              {check.edition === 'bedrock' ? ' (Bedrock)' : ''}
              {check.version ? `, versión ${check.version}` : ''}
              {check.players ? `, ${check.players.online}/${check.players.max} jugadores` : ''}. Ya pueden entrar tus amigos.
            </div>
          ) : (
            <div className="error-box">
              No se pudo conectar a {check.host}:{check.port} {check.edition === 'bedrock' ? 'por UDP (Bedrock)' : ''} desde internet. Revisa el firewall
              y el reenvío de puertos{check.edition === 'bedrock' ? ' (que la regla sea UDP)' : ''}. Si la IP WAN que muestra tu router es distinta a{' '}
              {net?.publicIp || 'tu IP pública'}, probablemente tu proveedor usa CGNAT; la guía explica qué hacer.
              <br />
              <span className="faint">El resultado puede tardar unos minutos en actualizarse porque el servicio guarda caché.</span>
            </div>
          ))}
      </section>
    </div>
  );
}

function TunnelRow({ label, tunnel, bedrock }) {
  if (!tunnel) return <p className="faint small">{label}: sin túnel.</p>;
  if (tunnel.missing) return <p className="note">{label}: el túnel ya no existe en playit.gg. Pulsa “Reparar túneles”.</p>;
  if (tunnel.pending || !tunnel.address)
    return (
      <p className="muted small">
        {label}: preparando la dirección{tunnel.status ? ` (${tunnel.status})` : ''}…
      </p>
    );
  const [host, port] = tunnel.address.split(':');
  return (
    <div>
      <Address
        label={
          bedrock
            ? `${label}: dirección ${host}${port ? `, puerto ${port}` : ''}`
            : `${label}: esta es la dirección para tus amigos${tunnel.disabled ? ` (desactivado: ${tunnel.disabled})` : ''}`
        }
        text={bedrock ? host : tunnel.address}
      />
    </div>
  );
}
