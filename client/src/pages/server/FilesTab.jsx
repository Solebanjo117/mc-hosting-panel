import { useCallback, useEffect, useRef, useState } from 'react';
import { api, qs, formatBytes, formatDate } from '../../api.js';
import { Confirm, Modal, useAction, useToast } from '../../ui.jsx';

const join = (dir, name) => (dir ? `${dir}/${name}` : name);

export default function FilesTab({ server }) {
  const [path, setPath] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);
  const [run, busy] = useAction();
  const toast = useToast();
  const base = `/servers/${server.id}/files`;

  const load = useCallback(() => {
    setError('');
    return api(`${base}?${qs({ path })}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [base, path]);
  useEffect(() => {
    load();
  }, [load]);

  async function upload(files) {
    if (!files?.length) return;
    const form = new FormData();
    for (const f of files) form.append('files', f);
    setUploading(true);
    try {
      const r = await api(`${base}/upload?${qs({ path })}`, { method: 'POST', form });
      toast(`${r.saved.length} archivo(s) subido(s)`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  const crumbs = path ? path.split('/') : [];

  return (
    <div
      className="stack"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget) || setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
      style={dragging ? { outline: '2px dashed var(--prismarine)', outlineOffset: 6, borderRadius: 10 } : undefined}
    >
      <div className="row">
        <nav className="crumbs grow" aria-label="Ruta">
          <button onClick={() => setPath('')}>servidor</button>
          {crumbs.map((c, i) => (
            <span key={i} className="row" style={{ gap: '0.15rem' }}>
              <span className="faint">/</span>
              <button onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))}>{c}</button>
            </span>
          ))}
        </nav>
        <button
          onClick={() => {
            const name = prompt('Nombre de la carpeta nueva');
            if (name) run(() => api(`${base}/mkdir`, { method: 'POST', body: { path: join(path, name) } }).then(load));
          }}
        >
          Nueva carpeta
        </button>
        <button
          onClick={() => {
            const name = prompt('Nombre del archivo nuevo', 'nuevo.txt');
            if (name) setEditing({ path: join(path, name), content: '', isNew: true });
          }}
        >
          Nuevo archivo
        </button>
        <button className="btn-go" disabled={uploading} onClick={() => fileInput.current.click()}>
          {uploading ? 'Subiendo…' : 'Subir archivos'}
        </button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => upload(e.target.files).then(() => (e.target.value = ''))} />
      </div>
      <p className="faint small">Puedes arrastrar archivos aquí. Para subir un mundo, súbelo en .zip y usa “Extraer”.</p>

      {error && <div className="error-box">{error}</div>}

      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tamaño</th>
                <th>Modificado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {path && (
                <tr>
                  <td colSpan={4}>
                    <button className="btn-sm btn-ghost" onClick={() => setPath(crumbs.slice(0, -1).join('/'))}>
                      .. (subir un nivel)
                    </button>
                  </td>
                </tr>
              )}
              {data.entries.length === 0 && (
                <tr>
                  <td colSpan={4} className="faint">
                    Carpeta vacía.
                  </td>
                </tr>
              )}
              {data.entries.map((e) => {
                const p = join(path, e.name);
                return (
                  <tr key={e.name}>
                    <td>
                      {e.type === 'dir' ? (
                        <button className="btn-sm btn-ghost" style={{ fontWeight: 500 }} onClick={() => setPath(p)}>
                          ▸ {e.name}
                        </button>
                      ) : e.editable ? (
                        <button
                          className="btn-sm btn-ghost"
                          style={{ fontWeight: 400 }}
                          onClick={() =>
                            run(() => api(`${base}/content?${qs({ path: p })}`).then((r) => setEditing({ path: p, content: r.content })))
                          }
                        >
                          {e.name}
                        </button>
                      ) : (
                        <span style={{ paddingLeft: '0.6rem' }}>{e.name}</span>
                      )}
                    </td>
                    <td className="muted">{e.type === 'dir' ? '' : formatBytes(e.size)}</td>
                    <td className="muted">{formatDate(e.mtime)}</td>
                    <td className="actions">
                      {e.name.toLowerCase().endsWith('.zip') && (
                        <button
                          className="btn-sm"
                          disabled={busy}
                          onClick={() => run(() => api(`${base}/extract`, { method: 'POST', body: { path: p } }).then(load), 'Archivo extraído')}
                        >
                          Extraer
                        </button>
                      )}{' '}
                      <a className="btn btn-sm" href={`/api${base}/download?${qs({ path: p })}`}>
                        Descargar
                      </a>{' '}
                      <button
                        className="btn-sm"
                        onClick={() => {
                          const name = prompt('Nuevo nombre', e.name);
                          if (name && name !== e.name)
                            run(() => api(`${base}/rename`, { method: 'POST', body: { from: p, to: join(path, name) } }).then(load));
                        }}
                      >
                        Renombrar
                      </button>{' '}
                      <button className="btn-sm btn-stop" onClick={() => setConfirm({ path: p, name: e.name, dir: e.type === 'dir' })}>
                        Borrar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Editor
          file={editing}
          onClose={() => setEditing(null)}
          onSave={async (content) => {
            await api(`${base}/content`, { method: 'PUT', body: { path: editing.path, content } });
            toast('Archivo guardado');
            setEditing(null);
            load();
          }}
        />
      )}

      {confirm && (
        <Confirm
          title={`Borrar ${confirm.name}`}
          message={confirm.dir ? 'Se borrará la carpeta y todo su contenido. No se puede deshacer.' : 'Se borrará el archivo. No se puede deshacer.'}
          confirmLabel="Borrar"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => run(() => api(`${base}/delete`, { method: 'POST', body: { paths: [confirm.path] } }).then(load), `${confirm.name} borrado`)}
        />
      )}
    </div>
  );
}

function Editor({ file, onClose, onSave }) {
  const [content, setContent] = useState(file.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = content !== file.content || file.isNew;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(content);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={file.path} onClose={() => (!dirty || confirm('¿Descartar los cambios?')) && onClose()} wide>
      <textarea
        className="editor"
        value={content}
        spellCheck={false}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            save();
          }
        }}
      />
      {error && <div className="error-box">{error}</div>}
      <div className="row">
        <span className="faint small grow">Ctrl+S para guardar. Muchos cambios necesitan reiniciar el servidor.</span>
        <button onClick={onClose}>Cancelar</button>
        <button className="btn-go" disabled={saving || !dirty} onClick={save}>
          Guardar
        </button>
      </div>
    </Modal>
  );
}
