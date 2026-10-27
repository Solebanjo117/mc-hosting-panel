import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useLive } from '../../live.jsx';
import { useAction } from '../../ui.jsx';

/**
 * Zonas con alerta: rectángulos del mundo con nombre ("la base de Juan", "la bóveda").
 * Cuando alguien entra, queda en la línea de tiempo y el panel avisa.
 */
export default function ZonesSection({ server }) {
  const { runtime } = useLive();
  const positions = runtime[server.id]?.positions || {};
  const [zones, setZones] = useState(null);
  const [form, setForm] = useState({ name: '', x1: '', z1: '', x2: '', z2: '', notify: true });
  const [run, busy] = useAction();
  const base = `/servers/${server.id}/zones`;
  useEffect(() => {
    api(base)
      .then((r) => setZones(r.zones))
      .catch(() => {});
  }, [base]);
  if (!zones) return null;
  const save = (list, msg) => run(() => api(base, { method: 'PUT', body: { zones: list } }).then((r) => setZones(r.zones)), msg);
  const online = Object.entries(positions);
  const R = 16; // radio por defecto al tomar la posición de alguien
  return (
    <section className="panel stack" style={{ gap: '0.8rem' }}>
      <h2 style={{ margin: 0 }}>Zonas con alerta</h2>
      <p className="muted small" style={{ maxWidth: '75ch' }}>
        Marca lugares del mundo (la base de alguien, la bóveda, el spawn) y el panel te avisa cuando alguien entra. Se guarda en Actividad y, si tienes
        notificaciones activadas, también en el navegador. Las posiciones se preguntan cada 15 segundos mientras hay zonas.
      </p>
      {zones.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Zona</th>
                <th>Desde (x, z)</th>
                <th>Hasta (x, z)</th>
                <th>Avisar</th>
                <th>Ahora dentro</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id}>
                  <td>
                    <strong>{z.name}</strong>
                  </td>
                  <td className="mono">
                    {z.x1}, {z.z1}
                  </td>
                  <td className="mono">
                    {z.x2}, {z.z2}
                  </td>
                  <td>
                    <input type="checkbox" checked={z.notify} aria-label={`Avisar en ${z.name}`} disabled={busy} onChange={(e) => save(zones.map((x) => (x.id === z.id ? { ...x, notify: e.target.checked } : x)))} />
                  </td>
                  <td className="muted small">{online.filter(([, p]) => p.x >= z.x1 && p.x <= z.x2 && p.z >= z.z1 && p.z <= z.z2).map(([n]) => n).join(', ') || '—'}</td>
                  <td className="actions">
                    <button className="btn-sm btn-ghost" disabled={busy} onClick={() => save(zones.filter((x) => x.id !== z.id), 'Zona quitada')}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="row"
        style={{ alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          save([...zones, { ...form }], 'Zona agregada').then(() => setForm({ name: '', x1: '', z1: '', x2: '', z2: '', notify: true }));
        }}
      >
        <label className="field" style={{ minWidth: 160 }}>
          <span>Nombre</span>
          <input value={form.name} maxLength={40} required placeholder="La base de Juan" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        {['x1', 'z1', 'x2', 'z2'].map((k) => (
          <label key={k} className="field" style={{ width: 96 }}>
            <span>{k.toUpperCase()}</span>
            <input type="number" value={form[k]} required onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </label>
        ))}
        <button className="btn-go" disabled={busy}>
          Agregar zona
        </button>
      </form>
      {online.length > 0 && (
        <div className="row" style={{ gap: '0.4rem' }}>
          <span className="muted small">Usar la posición de:</span>
          {online.map(([n, p]) => (
            <button key={n} type="button" className="btn-sm" onClick={() => setForm({ ...form, name: form.name || `Donde está ${n}`, x1: p.x - R, z1: p.z - R, x2: p.x + R, z2: p.z + R })} title={`x ${p.x}, y ${p.y}, z ${p.z}`}>
              {n} ({p.x}, {p.z})
            </button>
          ))}
          <span className="faint small">(un cuadro de {R * 2} bloques alrededor)</span>
        </div>
      )}
    </section>
  );
}
