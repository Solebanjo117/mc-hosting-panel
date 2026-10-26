import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PublicSection from './PublicSection.jsx';
import { api, formatDate, qs } from '../../api.js';
import { CopyButton, Modal, useAction, useToast } from '../../ui.jsx';
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
  const [tunnels, setTunnels] = useState(null);
  const [tunnelError, setTunnelError] = useState('');
  const [createError, setCreateError] = useState('');
  const [linking, setLinking] = useState(false);
  const [run, busy] = useAction();
  const { playit: livePlayit } = useLive();

  useEffect(() => {
    api('/system/network').then(setNet).catch((err) => toast(err.message, 'error'));
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

  const linkedOnly = server.playit?.enabled && server.playit.owned && !Object.entries(server.playit.owned).some(([k, v]) => v && server.playit[`${k}TunnelId`]);

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
          <p className="faint small" style={{ marginTop: '0.5rem' }}>
            Tu IP pública puede cambiar. Para un nombre fijo usa la sección <a href="#dominio">Dominio</a> de abajo. Si tu internet tiene CGNAT (abriste puertos
            y aun así no conecta), usa el túnel de playit.gg.
          </p>
        </div>
      </section>

      <PublicSection server={server} />

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
        {createError && (
          <div className="error-box">
            {createError}
            <div className="small" style={{ marginTop: '0.4rem' }}>
              Puedes crear el túnel tú mismo en playit.gg y vincularlo con “{server.playit?.enabled ? 'Cambiar túnel' : 'Usar un túnel que ya creé'}”.
            </div>
          </div>
        )}
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
              <button disabled={busy} onClick={() => setLinking(true)}>
                Cambiar túnel
              </button>
              <button
                className="btn-stop"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api(`/servers/${server.id}/playit`, { method: 'POST', body: { enabled: false } }).then(setTunnels),
                    linkedOnly ? 'Túnel desvinculado (sigue en tu cuenta de playit.gg)' : 'Túneles quitados'
                  )
                }
              >
                {linkedOnly ? 'Desvincular túnel' : 'Quitar túneles'}
              </button>
            </div>
            {!linkedOnly && <p className="faint small">"Quitar túneles" borra de playit.gg los túneles que creó el panel. Los que vinculaste tú solo se desvinculan.</p>}
          </>
        ) : (
          tunnels && (
            <>
              <div className="row">
                <button
                  className="btn-go"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      setCreateError('');
                      try {
                        const r = await api(`/servers/${server.id}/playit`, { method: 'POST', body: {} });
                        setTunnels(r);
                        r.warnings?.forEach((w) => setCreateError(w));
                      } catch (err) {
                        setCreateError(err.message);
                        throw err;
                      }
                    }, 'Túneles listos')
                  }
                >
                  Crear túnel{bedrock ? 'es (Java y Bedrock)' : ''}
                </button>
                <button disabled={busy} onClick={() => setLinking(true)}>
                  Usar un túnel que ya creé
                </button>
              </div>
              <span className="faint small">
                El plan gratuito de playit permite pocos túneles; usa uno por servidor que quieras compartir. Si ya tienes un túnel en playit.gg que apunta al
                puerto {server.port}, “Crear túnel” lo detecta y lo usa en vez de crear otro.
              </span>
            </>
          )
        )}
      </section>

      <DomainSection server={server} hasTunnel={Boolean(server.playit?.enabled)} />

      {linking && (
        <LinkTunnels
          server={server}
          bedrockPort={bedrock}
          agentId={livePlayit?.agentId || tunnels?.agentId}
          onClose={() => setLinking(false)}
          onDone={(r) => {
            setTunnels(r);
            setCreateError('');
            setLinking(false);
            r.warnings?.forEach((w) => toast(w, 'error'));
          }}
        />
      )}

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

const typeLabel = (t) =>
  t.type === 'minecraft-java' ? 'Minecraft Java' : t.type === 'minecraft-bedrock' ? 'Minecraft Bedrock' : t.typeLabel || (t.portType ? t.portType.toUpperCase() : 'Otro');

function fits(t, kind) {
  if (t.type === 'minecraft-java') return kind === 'java';
  if (t.type === 'minecraft-bedrock') return kind === 'bedrock';
  if (!t.type && t.portType) return t.portType === 'both' || t.portType === (kind === 'java' ? 'tcp' : 'udp');
  return !t.type;
}

function LinkTunnels({ server, bedrockPort, agentId, onClose, onDone }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [java, setJava] = useState(server.playit?.javaTunnelId || '');
  const [bed, setBed] = useState(server.playit?.bedrockTunnelId || '');
  const [run, busy] = useAction();

  const load = () => {
    setError('');
    api('/integrations/playit/tunnels')
      .then((r) => {
        setData(r);
        const free = (kind, port) => r.tunnels.find((t) => !t.usedBy && fits(t, kind) && t.localPort === port);
        if (!server.playit?.javaTunnelId) setJava((v) => v || free('java', server.port)?.id || '');
        if (bedrockPort && !server.playit?.bedrockTunnelId) setBed((v) => v || free('bedrock', bedrockPort)?.id || '');
      })
      .catch((err) => setError(err.message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const options = (kind) => (data?.tunnels || []).filter((t) => fits(t, kind) && (!t.usedBy || t.usedBy === server.name));
  const shown = data?.tunnels.find((t) => t.id === java);

  return (
    <Modal title="Usar un túnel de playit.gg" onClose={onClose} wide>
      <p className="muted small">
        Crea el túnel en <a href="https://playit.gg/account/setup/new-tunnel" target="_blank" rel="noreferrer">playit.gg → New Tunnel</a> con estos datos y
        luego pulsa <strong>Actualizar lista</strong>:
      </p>
      <ol className="small stack" style={{ gap: '0.3rem', margin: 0, paddingLeft: '1.2rem' }}>
        <li>
          <strong>Name your tunnel:</strong> el que quieras, por ejemplo <span className="mono">{server.name.replace(/[^\x20-\x7e]/g, '') || 'Minecraft'}</span>.
        </li>
        <li>
          <strong>Tunnel Type:</strong> Minecraft Java{bedrockPort ? ' (y otro túnel Minecraft Bedrock para celular y consola)' : ''}.
        </li>
        <li>
          <strong>Public Endpoint:</strong> deja la opción gratuita que viene por defecto.
        </li>
        <li>
          <strong>Assign to Agent:</strong> el agente del panel
          {agentId && (
            <>
              {' '}
              (su ID empieza con <span className="mono">{agentId.slice(0, 8)}</span>)
            </>
          )}
          . Local Address <span className="mono">127.0.0.1</span>, puerto <span className="mono">{server.port}</span>
          {bedrockPort ? (
            <>
              {' '}
              (Bedrock: <span className="mono">{bedrockPort}</span>)
            </>
          ) : null}
          .
        </li>
      </ol>

      {error && <div className="error-box">{error}</div>}
      {!data && !error && <p className="muted">Buscando tus túneles…</p>}
      {data && data.tunnels.length === 0 && (
        <p className="note">
          El agente del panel todavía no tiene túneles. Si ya creaste uno, revisa que en “Assign to Agent” hayas elegido el agente del panel y no otro.
        </p>
      )}
      {data && data.tunnels.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Túnel</th>
                <th>Tipo</th>
                <th>Dirección</th>
                <th>Puerto local</th>
              </tr>
            </thead>
            <tbody>
              {data.tunnels.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.name || <span className="faint">Sin nombre</span>}
                    {t.usedBy && <span className="faint small"> · lo usa {t.usedBy}</span>}
                  </td>
                  <td className="muted small">{typeLabel(t)}</td>
                  <td className="mono small">{t.address || (t.pending ? `preparando${t.status ? ` (${t.status})` : ''}…` : '—')}</td>
                  <td className="mono small">{t.localPort ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="grid-2">
          <label className="field">
            <span>Túnel para Java (puerto {server.port})</span>
            <select value={java} onChange={(e) => setJava(e.target.value)}>
              <option value="">Ninguno</option>
              {options('java').map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.id.slice(0, 8)} {t.address ? `— ${t.address}` : ''}
                </option>
              ))}
            </select>
          </label>
          {bedrockPort && (
            <label className="field">
              <span>Túnel para Bedrock (puerto {bedrockPort})</span>
              <select value={bed} onChange={(e) => setBed(e.target.value)}>
                <option value="">Ninguno</option>
                {options('bedrock').map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name || t.id.slice(0, 8)} {t.address ? `— ${t.address}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {shown?.localPort && shown.localPort !== server.port && (
        <p className="note">
          Ese túnel apunta al puerto {shown.localPort} y el servidor usa el {server.port}. El panel intentará corregirlo; si no puede, cámbialo en playit.gg.
        </p>
      )}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={load} disabled={busy}>
          Actualizar lista
        </button>
        <button onClick={onClose}>Cancelar</button>
        <button
          className="btn-go"
          disabled={busy || (!java && !bed)}
          onClick={() =>
            run(async () => onDone(await api(`/servers/${server.id}/playit/link`, { method: 'POST', body: { java: java || null, bedrock: bed || null } })), 'Túnel vinculado')
          }
        >
          Vincular
        </button>
      </div>
    </Modal>
  );
}

const TARGETS = [
  { id: 'auto', label: 'Automático' },
  { id: 'playit', label: 'Túnel de playit' },
  { id: 'home', label: 'IP de mi casa' },
];

function DomainSection({ server, hasTunnel }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [run, busy] = useAction();

  const load = () =>
    api(`/servers/${server.id}/dns`).then((r) => {
      setD(r);
      setForm((f) => f || { name: r.name || (r.provider === 'duckdns' ? '' : slug(server.name)), bedrockName: r.bedrockName, target: r.target });
    });
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, server.dns?.applied?.at, server.playit?.enabled]);

  if (!d || !form) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const host = (name) => (name ? `${name}.${d.zone}` : d.zone);
  const save = (enabled) =>
    run(async () => {
      const r = await api(`/servers/${server.id}/dns`, { method: 'PUT', body: { ...form, enabled } });
      setD(r);
      if (r.applied?.error) throw new Error(r.applied.error);
    }, enabled ? 'Dominio actualizado' : d.srv ? 'Dominio quitado: se borraron sus registros' : 'Dominio quitado de este servidor');
  const a = d.applied;
  const bedrockOn = Boolean(server.bedrock?.enabled);

  return (
    <section className="panel stack" style={{ gap: '0.8rem' }} id="dominio">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Dominio
        </h2>
        {d.enabled && <span className="chip">Activo</span>}
      </div>
      {d.provider && (
        <p className="faint small" style={{ margin: 0 }}>
          Usa {d.providerName}
          {d.provider !== 'duckdns' && (
            <>
              {' '}
              con <span className="mono">{d.zone}</span>
            </>
          )}
          . Para cambiar de servicio o desvincularlo ve a <Link to="/ajustes">Ajustes del panel</Link>.
        </p>
      )}
      {!d.provider ? (
        <p className="small">
          Elige un servicio de dominio (deSEC, DuckDNS o Cloudflare) en <Link to="/ajustes">Ajustes del panel</Link> y luego vuelve aquí para ponerle nombre a
          este servidor.
        </p>
      ) : (
        <>
          {d.enabled && a?.ok && (
            <div className="stack" style={{ gap: '0.2rem' }}>
              {a.java?.unsupported ? (
                <div className="note small">
                  <strong>Java:</strong> playit solo deja entrar con la dirección de su túnel, y DuckDNS no puede redirigir a ella (no tiene registros SRV). Para
                  Java comparte la dirección de playit
                  {a.java.playitAddress && (
                    <>
                      : <span className="mono">{a.java.playitAddress}</span>
                    </>
                  )}
                  . Para tener tu propio nombre en Java usa Cloudflare o deSEC con tu dominio (en Ajustes del panel).
                </div>
              ) : (
                <Address label={a.java.withPort ? 'Java: esta es la dirección para tus amigos (con puerto)' : 'Java: esta es la dirección para tus amigos'} text={a.java.address} />
              )}
              {a.bedrock && <Address label={`Bedrock: dirección ${a.bedrock.host}, puerto ${a.bedrock.port}`} text={a.bedrock.host} />}
              <p className="faint small" style={{ marginTop: '0.4rem' }}>
                Apunta a {a.target === 'playit' ? 'tu túnel de playit.gg' : 'la IP de tu casa (necesita los puertos abiertos)'} (actualizado {formatDate(a.at)}). Un
                cambio puede tardar unos minutos en verse en todos lados.
              </p>
              {a.warnings?.map((w, i) => (
                <p key={i} className="note">
                  {w}
                </p>
              ))}
            </div>
          )}
          {d.enabled && a && !a.ok && <div className="error-box">{a.error}</div>}

          <div className="grid-2">
            <label className="field">
              <span>{d.provider === 'duckdns' ? 'Subdominio de DuckDNS' : 'Nombre'}</span>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value.toLowerCase().trim())}
                placeholder={d.provider === 'duckdns' ? 'miserver' : 'smp (vacío = solo el dominio)'}
              />
              <span className="mono">{host(form.name || (d.provider === 'duckdns' ? 'tunombre' : ''))}</span>
            </label>
            {d.provider === 'duckdns' && bedrockOn && (
              <label className="field">
                <span>Subdominio para Bedrock (opcional)</span>
                <input value={form.bedrockName} onChange={(e) => set('bedrockName', e.target.value.toLowerCase().trim())} placeholder="Vacío = el mismo" />
                <span>Solo hace falta si playit le da a Bedrock otra IP.</span>
              </label>
            )}
          </div>
          <div className="stack" style={{ gap: '0.4rem' }}>
            <span className="small">Apuntar a</span>
            <div className="segmented" role="radiogroup" aria-label="Apuntar a">
              {TARGETS.map((t) => (
                <button key={t.id} type="button" className={form.target === t.id ? 'on' : ''} onClick={() => set('target', t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <span className="faint small">
              {form.target === 'auto' &&
                (hasTunnel ? 'Ahora usa tu túnel de playit. Si lo quitas, pasa a la IP de tu casa.' : 'Ahora usa la IP de tu casa. Si creas un túnel de playit, cambia a él solo.')}
              {form.target === 'playit' && 'Siempre el túnel de playit (funciona aunque tengas CGNAT).'}
              {form.target === 'home' && 'Siempre la IP de tu casa: necesitas los puertos abiertos en el router.'}
            </span>
          </div>
          {!d.srv && (
            <p className="faint small">
              DuckDNS solo guarda IPs (no tiene registros SRV). Con la IP de tu casa funciona para Java y Bedrock (Java con <span className="mono">:puerto</span> si
              no es 25565). Con el túnel de playit solo sirve para Bedrock: playit no deja entrar a Java con otro nombre. Para Java con playit usa Cloudflare o
              deSEC.
            </p>
          )}
          <div className="row">
            <button className="btn-go" disabled={busy || (d.provider === 'duckdns' && !form.name)} onClick={() => save(true)}>
              {d.enabled ? 'Guardar y actualizar' : 'Activar dominio'}
            </button>
            {d.enabled && (
              <button className="btn-stop" disabled={busy} onClick={() => save(false)}>
                Quitar dominio de este servidor
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function slug(text) {
  return (
    String(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'mc'
  );
}
