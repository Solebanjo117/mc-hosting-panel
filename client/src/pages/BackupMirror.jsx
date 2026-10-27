import { useEffect, useState } from 'react';
import { api, formatDate } from '../api.js';
import { useAction } from '../ui.jsx';

/** Copia de respaldos en la nube: una carpeta que OneDrive, Google Drive o Dropbox ya suben solos. */
export default function BackupMirror() {
  const [cfg, setCfg] = useState(null);
  const [value, setValue] = useState('');
  const [run, busy] = useAction();
  useEffect(() => {
    api('/system/backup-mirror')
      .then((c) => {
        setCfg(c);
        setValue(c.path);
      })
      .catch(() => {});
  }, []);
  if (!cfg) return null;
  const save = (p) => run(() => api('/system/backup-mirror', { method: 'PUT', body: { path: p } }).then((c) => (setCfg(c), setValue(c.path))), p ? 'Carpeta guardada' : 'Copia en la nube desactivada');
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Copia de respaldos en la nube</h2>
      <p className="muted small" style={{ maxWidth: '75ch' }}>
        Cada respaldo se copia también a la carpeta que elijas. Si es la de OneDrive, Google Drive, Dropbox o iCloud, su programa la sube solo y tus mundos
        quedan a salvo fuera de esta PC. La Revisión de cada servidor avisa si la copia se queda atrás.
      </p>
      {cfg.suggestions.length > 0 && (
        <div className="row" style={{ gap: '0.4rem' }}>
          <span className="muted small">Carpetas encontradas en esta PC:</span>
          {cfg.suggestions.map((s) => (
            <button key={s.path} type="button" className="btn-sm" disabled={busy} onClick={() => save(s.path)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          save(value);
        }}
      >
        <input className="grow mono" value={value} placeholder="C:\\Users\\tú\\OneDrive\\MC Hosting Panel" onChange={(e) => setValue(e.target.value)} />
        <button className="btn-go" disabled={busy}>
          Guardar
        </button>
        {cfg.path && (
          <button type="button" disabled={busy} onClick={() => save('')}>
            Desactivar
          </button>
        )}
      </form>
      {cfg.path && (
        <p className="faint small">
          Copiando a <span className="mono">{cfg.path}</span>
          {cfg.lastCopy ? `; última copia ${formatDate(cfg.lastCopy)}` : ''}.{cfg.lastError ? ` Último error: ${cfg.lastError}` : ''}
        </p>
      )}
    </section>
  );
}
