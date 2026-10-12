import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { CopyButton, useToast } from '../../ui.jsx';

export default function NetworkTab({ server, state }) {
  const [net, setNet] = useState(null);
  const [host, setHost] = useState('');
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api('/system/network').then(setNet).catch((err) => toast(err.message, 'error'));
  }, [toast]);

  const lan = net?.localIps.find((i) => !i.virtual) || net?.localIps[0];
  const firewallCmd = `netsh advfirewall firewall add rule name="Minecraft ${server.port}" dir=in action=allow protocol=TCP localport=${server.port}`;

  async function test() {
    setChecking(true);
    setCheck(null);
    try {
      setCheck(await api(`/servers/${server.id}/network/check?${qs({ host: host.trim() })}`));
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
            <div className="address">
              <span>
                {lan.address}:{server.port}
              </span>
              <CopyButton text={`${lan.address}:${server.port}`} />
            </div>
          )}
          {net?.localIps.length > 1 && (
            <p className="faint small" style={{ marginTop: '0.5rem' }}>
              Otras interfaces: {net.localIps.filter((i) => i !== lan).map((i) => `${i.address} (${i.interface})`).join(', ')}
            </p>
          )}
        </div>
        <div className="panel">
          <h2>Jugadores por internet</h2>
          <p className="muted small">Necesitas abrir el puerto {server.port} (TCP) en el firewall y en tu router.</p>
          {net?.publicIp ? (
            <div className="address">
              <span>
                {net.publicIp}:{server.port}
              </span>
              <CopyButton text={`${net.publicIp}:${server.port}`} />
            </div>
          ) : (
            <p className="faint small">No se pudo detectar tu IP pública.</p>
          )}
          <p className="faint small" style={{ marginTop: '0.5rem' }}>
            Tu IP pública puede cambiar. Para tener una dirección fija usa un dominio gratuito (DuckDNS o No-IP).
          </p>
        </div>
      </section>

      <section className="panel stack" style={{ gap: '0.9rem' }}>
        <h2 style={{ margin: 0 }}>Pasos para abrir el puerto {server.port}</h2>
        <ol className="stack" style={{ gap: '0.9rem', margin: 0, paddingLeft: '1.2rem' }}>
          <li>
            <strong>Fija la IP de esta PC</strong>
            <p className="muted small">
              Reserva {lan ? <span className="mono">{lan.address}</span> : 'la IP local'} en tu router (reserva DHCP) para que no cambie.
            </p>
          </li>
          <li>
            <strong>Permite el puerto en el Firewall de Windows</strong>
            <p className="muted small">
              Ejecuta <span className="mono">scripts\abrir-firewall.bat</span> de la carpeta del panel, o pega este comando en una terminal abierta como
              administrador:
            </p>
            <div className="address">
              <span style={{ overflowWrap: 'anywhere' }}>{firewallCmd}</span>
              <CopyButton text={firewallCmd} />
            </div>
          </li>
          <li>
            <strong>Crea el reenvío de puertos en tu router</strong>
            <p className="muted small">
              Puerto externo {server.port} → {lan ? <span className="mono">{lan.address}</span> : 'esta PC'} puerto {server.port}, protocolo TCP.
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
          Un servicio externo (mcsrvstat.us) intenta conectarse a tu servidor como lo haría un amigo. Si escribes un dominio o una dirección de playit.gg, se prueba esa dirección.
        </p>
        <div className="row">
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
              {check.version ? `, versión ${check.version}` : ''}
              {check.players ? `, ${check.players.online}/${check.players.max} jugadores` : ''}. Ya pueden entrar tus amigos.
            </div>
          ) : (
            <div className="error-box">
              No se pudo conectar a {check.host}:{check.port} desde internet. Revisa el firewall y el reenvío de puertos. Si la IP WAN que muestra tu
              router es distinta a {net?.publicIp || 'tu IP pública'}, probablemente tu proveedor usa CGNAT; la guía explica qué hacer.
              <br />
              <span className="faint">El resultado puede tardar unos minutos en actualizarse porque el servicio guarda caché.</span>
            </div>
          ))}
      </section>
    </div>
  );
}
