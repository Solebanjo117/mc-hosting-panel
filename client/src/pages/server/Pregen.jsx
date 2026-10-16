import { useEffect, useRef, useState } from 'react';
import { api, formatBytes } from '../../api.js';
import { Confirm, Progress, useAction } from '../../ui.jsx';

const DIM_LABEL = { overworld: 'Mundo normal', nether: 'Nether', end: 'End' };
const STATE_LABEL = {
  running: 'Pregenerando',
  paused: 'En pausa',
  interrupted: 'Interrumpida (el servidor se apagó)',
  done: 'Terminada',
  cancelled: 'Cancelada',
};
const PRESETS = [1000, 2500, 5000, 10000];
const formatNumber = (v) => Number(v || 0).toLocaleString('es-MX');

/** Pregenerar el mundo con Chunky, en la sección Mundos. */
export default function Pregen({ server, state }) {
  const [st, setSt] = useState(null);
  const [form, setForm] = useState({ radius: 2500, dimension: 'overworld', shape: 'square', center: 'spawn', x: 0, z: 0, border: false });
  const [est, setEst] = useState(null);
  const [ask, setAsk] = useState(null);
  const [run, busy] = useAction();
  const timer = useRef();
  const on = state === 'running';

  const load = () => api(`/servers/${server.id}/pregen`).then(setSt).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, state]);

  // Mientras pregenera, el avance llega cada pocos segundos.
  useEffect(() => {
    clearTimeout(timer.current);
    if (st?.task?.state === 'running') timer.current = setTimeout(load, 3000);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st]);

  useEffect(() => {
    const t = setTimeout(
      () =>
        api(`/servers/${server.id}/pregen/estimate?radius=${Number(form.radius) || 0}&shape=${form.shape}&dimension=${form.dimension}`)
          .then(setEst)
          .catch(() => {}),
      250
    );
    return () => clearTimeout(t);
  }, [server.id, form.radius, form.shape, form.dimension]);

  if (!st) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const act = (path, body, ok) =>
    run(async () => {
      const r = await api(`/servers/${server.id}/pregen/${path}`, { method: 'POST', body: body ?? undefined });
      setSt(r);
      return r;
    }, ok);
  const t = st.task;
  const active = t && ['running', 'paused', 'interrupted'].includes(t.state);

  return (
    <section className="panel stack" aria-labelledby={`pregen-${server.id}`}>
      <h2 id={`pregen-${server.id}`} style={{ margin: 0 }}>
        Pregenerar el mundo
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        Genera por adelantado el terreno alrededor del spawn con <strong>Chunky</strong>: explorar ya no da tirones y el mapa se puede dibujar entero. Usa
        mucho procesador mientras trabaja: hazlo cuando nadie esté jugando o páusalo.
      </p>

      {!st.supported ? (
        <p className="faint small">{st.reason}</p>
      ) : !st.installed ? (
        <div>
          <button disabled={busy || server.installState !== 'ready'} onClick={() => act('install', null, on ? 'Chunky instalado. Reinicia el servidor para usarlo.' : 'Chunky instalado')}>
            {busy ? 'Instalando…' : 'Instalar Chunky'}
          </button>
        </div>
      ) : (
        <>
          {st.needsRestart && <p className="note">Chunky se instaló con el servidor encendido: reinícialo para usarlo.</p>}
          {!on && !active && <p className="faint small">Enciende el servidor para pregenerar.</p>}

          {t && (
            <div className="stack" style={{ gap: '0.4rem' }} role="status" aria-live="polite">
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <strong className="grow">
                  {STATE_LABEL[t.state] || t.state} · {DIM_LABEL[t.dimension] || t.world}
                  {t.radius ? `, radio ${formatNumber(t.radius)} bloques` : ''}
                </strong>
                <span className="mono small">{(t.percent || 0).toFixed(1)} %</span>
              </div>
              <Progress value={(t.percent || 0) / 100} />
              <span className="faint small">
                {formatNumber(t.processed || 0)}
                {t.total ? ` de ${formatNumber(t.total)}` : ''} chunks
                {t.state === 'running' && t.rate ? ` · ${formatNumber(Math.round(t.rate))} por segundo` : ''}
                {t.state === 'running' && t.eta ? ` · faltan ${t.eta}` : ''}
                {t.state === 'done' && t.totalTime ? ` · tardó ${t.totalTime}` : ''}
              </span>
              <div className="row">
                {t.state === 'running' && (
                  <button className="btn-sm" disabled={busy} onClick={() => act('pause', null, 'En pausa')}>
                    Pausar
                  </button>
                )}
                {['paused', 'interrupted'].includes(t.state) && (
                  <button className="btn-sm btn-go" disabled={busy || !on} onClick={() => act('continue', null, 'Continuando')}>
                    Continuar
                  </button>
                )}
                {active && (
                  <button className="btn-sm btn-ghost" disabled={busy || !on} onClick={() => setAsk('cancel')}>
                    Cancelar
                  </button>
                )}
                {!active && (
                  <button className="btn-sm btn-ghost" disabled={busy} onClick={() => run(() => api(`/servers/${server.id}/pregen`, { method: 'DELETE' }).then(setSt))}>
                    Ocultar
                  </button>
                )}
              </div>
            </div>
          )}

          {!active && (
            <form
              className="stack"
              style={{ gap: '0.8rem' }}
              onSubmit={(e) => {
                e.preventDefault();
                act('start', { ...form, radius: Number(form.radius), x: Number(form.x), z: Number(form.z) }, 'Pregeneración iniciada');
              }}
            >
              <div className="grid-2">
                <div className="field">
                  <label htmlFor={`pregen-radius-${server.id}`}>Radio (bloques desde el centro)</label>
                  <input id={`pregen-radius-${server.id}`} type="number" min={16} max={st.maxRadius} value={form.radius} onChange={(e) => set('radius', e.target.value)} required />
                  <span className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                    {PRESETS.map((p) => (
                      <button key={p} type="button" className={`btn-sm ${Number(form.radius) === p ? '' : 'btn-ghost'}`} aria-pressed={Number(form.radius) === p} onClick={() => set('radius', p)}>
                        {formatNumber(p)}
                      </button>
                    ))}
                  </span>
                </div>
                <label className="field">
                  <span>Dimensión</span>
                  <select value={form.dimension} onChange={(e) => set('dimension', e.target.value)}>
                    {st.dimensions.map((d) => (
                      <option key={d} value={d}>
                        {DIM_LABEL[d]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Forma</span>
                  <select value={form.shape} onChange={(e) => set('shape', e.target.value)}>
                    <option value="square">Cuadrado (más rápido)</option>
                    <option value="circle">Círculo</option>
                  </select>
                </label>
                <label className="field">
                  <span>Centro</span>
                  <select value={form.center} onChange={(e) => set('center', e.target.value)}>
                    <option value="spawn">El spawn del mundo</option>
                    <option value="xz">Coordenadas…</option>
                  </select>
                </label>
                {form.center === 'xz' && (
                  <div className="row">
                    <label className="field grow">
                      <span>X</span>
                      <input type="number" value={form.x} onChange={(e) => set('x', e.target.value)} />
                    </label>
                    <label className="field grow">
                      <span>Z</span>
                      <input type="number" value={form.z} onChange={(e) => set('z', e.target.value)} />
                    </label>
                  </div>
                )}
              </div>
              {form.dimension === 'overworld' && (
                <label className="check">
                  <input type="checkbox" checked={form.border} onChange={(e) => set('border', e.target.checked)} />
                  <span>
                    Poner un borde del mundo del mismo tamaño
                    <span className="faint" style={{ display: 'block' }}>
                      Nadie podrá salir de la zona pregenerada, así el mundo no crece más.
                    </span>
                  </span>
                </label>
              )}
              {est && (
                <p className="faint small" style={{ margin: 0 }}>
                  Unos {formatNumber(est.chunks)} chunks, aproximadamente {formatBytes(est.diskMb * 1024 * 1024)} en disco. Chunky muestra cuánto falta mientras
                  trabaja.
                </p>
              )}
              <div>
                <button className="btn-go" disabled={busy || !on || st.needsRestart}>
                  Pregenerar
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {ask === 'cancel' && (
        <Confirm
          title="Cancelar la pregeneración"
          message="Lo ya generado se queda en el mundo; solo se deja de generar el resto."
          confirmLabel="Cancelar pregeneración"
          danger
          onClose={() => setAsk(null)}
          onConfirm={() => act('cancel', null, 'Pregeneración cancelada')}
        />
      )}
    </section>
  );
}
