import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDate } from '../../api.js';
import { useAction, useToast } from '../../ui.jsx';

const LEVEL = {
  critical: { label: 'Grave', cls: 'lvl-critical' },
  warning: { label: 'Importante', cls: 'lvl-warning' },
  info: { label: 'Sugerencia', cls: 'lvl-info' },
  ok: { label: 'Bien', cls: 'lvl-ok' },
};

export default function SecurityTab({ server }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();
  const base = `/servers/${server.id}/security`;

  const load = useCallback(
    () =>
      api(base).then((d) => {
        setData(d);
        setForm((f) => f || d.protection.settings);
      }),
    [base]
  );
  useEffect(() => {
    load().catch((err) => toast(err.message, 'error'));
    const t = setInterval(() => load().catch(() => {}), 15_000);
    return () => clearInterval(t);
  }, [load, toast]);

  if (!data || !form) return <p className="muted">Revisando…</p>;
  const p = data.protection;
  const pending = data.findings.filter((f) => f.level !== 'ok');
  const fine = data.findings.filter((f) => f.level === 'ok');
  const lockdown = p.lockdownUntil && Date.parse(p.lockdownUntil) > Date.now();

  const fix = (f) =>
    run(async () => {
      const r = await api(`${base}/fix`, { method: 'POST', body: { fix: f.id } });
      setData(r);
      if (f.id === 'flood') setForm(r.protection.settings);
      toast(r.restartRequired ? `${f.fix}: listo. Reinicia el servidor para aplicarlo.` : `${f.fix}: listo.`);
    });

  return (
    <div className="stack" style={{ gap: '1.5rem', maxWidth: 960 }}>
      {lockdown && (
        <section className="panel" style={{ borderColor: 'rgba(232,182,75,0.6)' }}>
          <div className="row">
            <div className="grow">
              <h2 style={{ margin: 0 }}>Lista blanca de emergencia activa</h2>
              <p className="muted small" style={{ marginTop: '0.3rem' }}>
                Se detectó una oleada de conexiones. Solo entran jugadores de la lista blanca hasta {formatDate(new Date(p.lockdownUntil).toISOString())}.
              </p>
            </div>
            <button disabled={busy} onClick={() => run(() => api(`${base}/end-lockdown`, { method: 'POST' }).then(setData), 'Emergencia terminada')}>
              Terminar ahora
            </button>
          </div>
        </section>
      )}

      <section className="stack" style={{ gap: '0.75rem' }}>
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            Revisión de seguridad
          </h2>
          {pending.length === 0 ? (
            <span className="small" style={{ color: 'var(--prismarine)' }}>
              Todo en orden
            </span>
          ) : (
            <span className="muted small">
              {pending.length} {pending.length === 1 ? 'punto por revisar' : 'puntos por revisar'}
            </span>
          )}
        </div>
        <div className="findings">
          {pending.map((f) => (
            <article key={f.id} className={`sec-item ${LEVEL[f.level].cls}`}>
              <div className="sec-level">{LEVEL[f.level].label}</div>
              <div style={{ minWidth: 0 }}>
                <h3>{f.title}</h3>
                <p className="muted small">{f.detail}</p>
                {f.id === 'ip' && (
                  <p className="small" style={{ marginTop: '0.3rem' }}>
                    <Link to={`/servidor/${server.id}/conexion`}>Crear un túnel de playit.gg</Link>
                  </p>
                )}
              </div>
              {f.fix && (
                <button className="btn-sm" disabled={busy} onClick={() => fix(f)}>
                  {f.fix}
                </button>
              )}
            </article>
          ))}
        </div>
        {fine.length > 0 && (
          <ul className="sec-ok small">
            {fine.map((f) => (
              <li key={f.id}>{f.title}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel stack">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            Protección contra oleadas de bots
          </h2>
          {form.enabled && <span className="muted small">{p.connectionsLastMinute} conexiones en el último minuto</span>}
        </div>
        <p className="muted small" style={{ maxWidth: '75ch' }}>
          Vigila las conexiones que registra la consola. Si una IP insiste demasiado, se bloquea un rato. Si llegan muchas conexiones de golpe desde
          muchas IP, se activa la lista blanca hasta que pase. Las IP de tu casa, de Tailscale y del túnel de playit nunca se bloquean.
        </p>
        <label className="check">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          <span>Activar protección</span>
        </label>
        <div className="grid-2">
          <label className="field">
            <span>Conexiones por minuto desde una misma IP</span>
            <input type="number" min={3} value={form.perIpPerMinute} onChange={(e) => setForm({ ...form, perIpPerMinute: e.target.value })} />
            <span>Más que esto y la IP se bloquea.</span>
          </label>
          <label className="field">
            <span>Bloquear esa IP por (minutos)</span>
            <input type="number" min={1} value={form.banMinutes} onChange={(e) => setForm({ ...form, banMinutes: e.target.value })} />
          </label>
          <label className="field">
            <span>Conexiones por minuto en total</span>
            <input type="number" min={5} value={form.globalPerMinute} onChange={(e) => setForm({ ...form, globalPerMinute: e.target.value })} />
            <span>Más que esto activa la lista blanca de emergencia.</span>
          </label>
          <label className="field">
            <span>Duración de la emergencia (minutos)</span>
            <input type="number" min={1} value={form.lockdownMinutes} onChange={(e) => setForm({ ...form, lockdownMinutes: e.target.value })} />
          </label>
        </div>
        <div>
          <button
            className="btn-go"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api(`${base}/protection`, { method: 'PUT', body: form });
                setData(r);
                setForm(r.protection.settings);
              }, 'Protección guardada')
            }
          >
            Guardar
          </button>
        </div>
        {form.enabled && (
          <p className="note">
            Ten a tus amigos en la lista blanca (pestaña <Link to={`/servidor/${server.id}/jugadores`}>Jugadores</Link>): durante una emergencia solo
            ellos pueden entrar.
          </p>
        )}

        {p.bans.length > 0 && (
          <div>
            <h3 style={{ marginBottom: '0.4rem' }}>IP bloqueadas ahora</h3>
            <table className="table">
              <tbody>
                {p.bans.map((b) => (
                  <tr key={b.ip}>
                    <td className="mono">{b.ip}</td>
                    <td className="muted">hasta {formatDate(b.until)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {p.log.length > 0 && (
          <div>
            <h3 style={{ marginBottom: '0.4rem' }}>Actividad reciente</h3>
            <table className="table">
              <tbody>
                {p.log.slice(0, 10).map((l, i) => (
                  <tr key={i}>
                    <td className="muted" style={{ width: 190 }}>
                      {formatDate(l.at)}
                    </td>
                    <td>{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="faint small" style={{ maxWidth: '75ch' }}>
        Ningún programa en tu PC puede detener un DDoS que satura todo tu internet: ese tráfico llena la conexión antes de llegar al servidor. La mejor
        defensa es que no conozcan tu IP. <Link to="/guia#13-seguridad-y-ataques-ddos">Lee la sección de seguridad de la guía</Link>.
      </p>
    </div>
  );
}
